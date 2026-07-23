// Allotements Mews (« availability blocks ») pilotés depuis notre module Groupes.
//
// Jusqu'ici un groupe ne vivait QUE dans notre base : les chambres restaient en
// vente dans Mews et sur tous les canaux. Vérifié le 2026-07-23 — les deux
// mariages de 2027, pourtant des privatisations complètes, laissaient les 16
// chambres des Voiles vendables comme un mardi ordinaire.
//
// La certification a ouvert ce qu'il fallait :
//   · `availabilityBlocks/add`            créer le bloc (service + dates + tarif modèle)
//   · `availabilityBlocks/update`         nom, dates, date de libération, état
//   · `services/updateAvailability`       Y METTRE LES CHAMBRES (quantité par catégorie)
//   · `rates/updatePrice`                 le prix, PAR CATÉGORIE
//   · `availabilityBlocks/delete`         retirer le bloc
//
// ⚠️ ON NE PEUT PAS RELIRE : `availabilityBlocks/getAll` renvoie 0 même filtré par
// identifiant, et `availabilityAdjustments/getAll` est fermé (401). D'où deux
// partis pris : on MÉMORISE l'identifiant du bloc chez nous (groupes.mews_block_id)
// — c'est notre seule prise dessus — et on VÉRIFIE PAR L'EFFET, en relisant la
// disponibilité : si les chambres cessent d'être vendables, le bloc travaille.
//
// ⚠️ Mews CLONE le tarif modèle en un tarif propre au bloc (d'où « TemplateRateId »).
// Le prix se pose donc sur le tarif du bloc, jamais sur le modèle — sans quoi on
// écraserait le tarif de tous les autres groupes.

import { callMews } from '@/lib/mews';

// Service « Hébergement » des Voiles et tarif modèle « Groupe & Mariage » (privé,
// indépendant, non-défaut — créé exprès pour ça le 2026-07-23).
const SERVICE_ID = process.env.MEWS_STAY_SERVICE_ID || '9475cd2d-5fa3-4a8a-9abb-aaa9008717f2';
const TEMPLATE_RATE_ID = process.env.MEWS_GROUP_RATE_ID || '63b0a0e6-76c7-4436-a937-b49000c01fbc';

// Mews exige des bornes calées sur le DÉBUT d'une unité de temps, c'est-à-dire
// minuit à l'heure de l'hôtel exprimé en UTC (22:00Z la veille en été, 23:00Z en
// hiver). Une date « ronde » en UTC est refusée : « is not start of TimeUnit ».
export function minuitParis(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const h = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Paris', hour12: false, hour: '2-digit',
  }).format(new Date(guess)));
  return new Date(guess - (h % 24) * 3600e3).toISOString();
}

export type BlocCreation = {
  nom: string;
  arrivee: string;          // 'YYYY-MM-DD' — première nuit
  depart: string;           // 'YYYY-MM-DD' — jour du départ (donc dernière nuit = veille)
  dateLimite?: string | null;  // libération des chambres non réservées
};

export type BlocResult = { blockId: string; rateId: string | null };

export async function createBlock(b: BlocCreation): Promise<BlocResult> {
  // La dernière NUIT est la veille du départ : un séjour 25→27 occupe les nuits
  // du 25 et du 26. Se tromper ici bloquerait une nuit de trop, invendable.
  const derniereNuit = new Date(new Date(`${b.depart}T12:00:00Z`).getTime() - 864e5)
    .toISOString().slice(0, 10);

  const res = await callMews<{ AvailabilityBlocks?: { Id: string; RateId?: string }[] }>(
    'availabilityBlocks/add',
    {
      AvailabilityBlocks: [{
        ServiceId: SERVICE_ID,
        FirstTimeUnitStartUtc: minuitParis(b.arrivee),
        LastTimeUnitStartUtc: minuitParis(derniereNuit),
        TemplateRateId: TEMPLATE_RATE_ID,
        Name: b.nom,
        ...(b.dateLimite
          ? { ReleasedUtc: minuitParis(b.dateLimite), ReleaseStrategy: 'FixedRelease' }
          : {}),
      }],
    },
  );
  const bloc = (res.AvailabilityBlocks ?? [])[0];
  if (!bloc?.Id) throw new Error('Mews n’a pas renvoyé d’identifiant d’allotement');
  return { blockId: bloc.Id, rateId: bloc.RateId ?? null };
}

// Réserve des chambres pour le bloc. Le compte est passé en NÉGATIF : on retire
// ces unités de la vente générale pour les mettre de côté. Réenvoyer une valeur
// remplace la précédente (ce n'est pas un cumul) — donc pour ajuster un bloc de
// 6 à 8 chambres, on renvoie -8, pas -2.
export async function setBlockRooms(
  blockId: string,
  arrivee: string, derniereNuit: string,
  parCategorie: { categoryId: string; chambres: number }[],
): Promise<void> {
  // On n'écarte PAS les zéros : remettre une catégorie à 0 est justement ce qui
  // libère les chambres d'une catégorie retirée du bloc. Les filtrer laisserait
  // l'ancienne quantité en place — des chambres retenues pour un groupe qui n'en
  // veut plus, donc invendables et invisibles.
  const updates = parCategorie
    .filter((c) => c.chambres >= 0)
    .map((c) => ({
      FirstTimeUnitStartUtc: minuitParis(arrivee),
      LastTimeUnitStartUtc: minuitParis(derniereNuit),
      AvailabilityBlockId: blockId,
      ResourceCategoryId: c.categoryId,
      UnitCountAdjustment: { Value: -c.chambres },
    }));
  if (!updates.length) return;
  await callMews('services/updateAvailability', { ServiceId: SERVICE_ID, AvailabilityUpdates: updates });
}

// Prix du bloc, PAR CATÉGORIE. Sans `CategoryId` le prix vaudrait pour toutes les
// catégories — or une Individuelle et une Supérieure vue mer n'ont pas le même
// tarif de groupe. On écrit sur le tarif CLONÉ du bloc, jamais sur le modèle.
export async function setBlockPrices(
  rateId: string,
  arrivee: string, derniereNuit: string,
  parCategorie: { categoryId: string; prix: number }[],
): Promise<void> {
  const updates = parCategorie
    .filter((c) => c.prix > 0)
    .map((c) => ({
      CategoryId: c.categoryId,
      FirstTimeUnitStartUtc: minuitParis(arrivee),
      LastTimeUnitStartUtc: minuitParis(derniereNuit),
      Value: c.prix,
    }));
  if (!updates.length) return;
  await callMews('rates/updatePrice', { RateId: rateId, PriceUpdates: updates });
}

export async function deleteBlock(blockId: string): Promise<void> {
  await callMews('availabilityBlocks/delete', { AvailabilityBlockIds: [blockId] });
}

// Vérification PAR L'EFFET, faute de pouvoir relire les blocs : on demande à Mews
// combien de chambres restent vendables sur les nuits du bloc. Si le total a
// chuté du nombre de chambres allotées, le bloc travaille.
export async function chambresVendables(dateISO: string): Promise<number> {
  const u = minuitParis(dateISO);
  const av = await callMews<{ CategoryAvailabilities?: { Availabilities?: number[] }[] }>(
    'services/getAvailability',
    { ServiceId: SERVICE_ID, FirstTimeUnitStartUtc: u, LastTimeUnitStartUtc: u },
  );
  return (av.CategoryAvailabilities ?? []).reduce((s, c) => s + (c.Availabilities?.[0] ?? 0), 0);
}

// Nos chambres portent un NUMÉRO, Mews raisonne en CATÉGORIE : « 6 Confort » et non
// « la 21, la 22… ». Cette table de correspondance sert deux fois (les quantités ET
// les prix) : on la construit UNE fois, en un appel — la traverser chambre par
// chambre ferait un aller-retour Mews par chambre.
// Correspondance vérifiée le 2026-07-23 : 16/16 aux Voiles par le numéro.
// ⚠️ La chambre NE PORTE PAS sa catégorie : `resources/getAll` renvoie Id, Name,
// State… mais aucun `CategoryId`. Le lien vit dans un bloc séparé de la réponse,
// `ResourceCategoryAssignments`, qu'il faut demander par l'extent — sinon il
// revient vide et la correspondance échoue en silence (vécu le 2026-07-23 : un
// allotement créé sans aucune chambre dedans, donc sans effet).
// Le champ du lien s'appelle `CategoryId`, pas `ResourceCategoryId`.
export async function categorieParNumero(): Promise<Map<string, string>> {
  const res = await callMews<{
    Resources?: { Id: string; Name?: string }[];
    ResourceCategoryAssignments?: { ResourceId: string; CategoryId: string; IsActive?: boolean }[];
  }>('resources/getAll', {
    Extent: { Resources: true, ResourceCategories: true, ResourceCategoryAssignments: true },
    Limitation: { Count: 300 },
  });
  const nomDe = new Map((res.Resources ?? []).map((r) => [r.Id, String(r.Name ?? '').trim()]));
  const m = new Map<string, string>();
  for (const a of res.ResourceCategoryAssignments ?? []) {
    if (a.IsActive === false) continue;
    const nom = nomDe.get(a.ResourceId);
    if (nom) m.set(nom, a.CategoryId);
  }
  return m;
}

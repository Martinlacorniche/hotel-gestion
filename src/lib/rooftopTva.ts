// Moteur de TVA du POS Rooftop (Les Voiles).
//
// Les prix affichés/encaissés sont TTC. Pour la facture réglementaire on doit
// ventiler chaque ligne en base HT + TVA par taux :
//   • soft / food  → 10% plein (restauration & boissons sans alcool).
//   • alcool       → ventilation forfaitaire : 50% du TTC à 10%, 50% à 20%
//                    (clé convenue avec le comptable).
//
// On travaille en nombres bruts (non arrondis) et on n'arrondit qu'à
// l'agrégation finale, pour éviter les écarts de centime sur les totaux.

export type TvaType = "soft" | "alcool" | "food";

export type TvaBuckets = {
  ht10: number; // base HT au taux 10%
  ht20: number; // base HT au taux 20%
  tva10: number; // TVA collectée à 10%
  tva20: number; // TVA collectée à 20%
};

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

// Ventile un montant TTC (déjà multiplié par la quantité) selon son type.
export function ventileLine(ttc: number, type: TvaType): TvaBuckets {
  if (!ttc) return { ht10: 0, ht20: 0, tva10: 0, tva20: 0 };
  if (type === "alcool") {
    const half = ttc / 2;
    const ht10 = half / 1.1;
    const ht20 = half / 1.2;
    return { ht10, ht20, tva10: half - ht10, tva20: half - ht20 };
  }
  // soft / food → 10%
  const ht10 = ttc / 1.1;
  return { ht10, ht20: 0, tva10: ttc - ht10, tva20: 0 };
}

export function emptyBuckets(): TvaBuckets {
  return { ht10: 0, ht20: 0, tva10: 0, tva20: 0 };
}

export function addBuckets(a: TvaBuckets, b: TvaBuckets): TvaBuckets {
  return {
    ht10: a.ht10 + b.ht10,
    ht20: a.ht20 + b.ht20,
    tva10: a.tva10 + b.tva10,
    tva20: a.tva20 + b.tva20,
  };
}

// Agrège une liste de lignes {ttc, type} en un seul jeu de buckets (bruts).
export function ventileAll(lines: { ttc: number; type: TvaType }[]): TvaBuckets {
  return lines.reduce((acc, l) => addBuckets(acc, ventileLine(l.ttc, l.type)), emptyBuckets());
}

// Totaux arrondis prêts à afficher sur une facture / un récap.
export type TvaTotaux = {
  ht10: number; ht20: number; tva10: number; tva20: number;
  totalHt: number; totalTva: number; totalTtc: number;
};

export function totauxFromBuckets(b: TvaBuckets): TvaTotaux {
  const ht10 = round2(b.ht10), ht20 = round2(b.ht20);
  const tva10 = round2(b.tva10), tva20 = round2(b.tva20);
  const totalHt = round2(ht10 + ht20);
  const totalTva = round2(tva10 + tva20);
  return { ht10, ht20, tva10, tva20, totalHt, totalTva, totalTtc: round2(totalHt + totalTva) };
}

// Déduction du type de TVA d'une catégorie de boisson.
// Priorité : override explicite (config categories_tva) puis heuristique par nom.
const ALCOOL_RE =
  /(bi[eè]re|vin|ros[eé]|blanc|rouge|champ|cr[eé]mant|cocktail|spiritueux|rhum|whisky|gin|vodka|ap[eé]ri|digestif|alcool|pastis|punch|sangria|spritz|mojito|pi[nñ]a|magnum|bouteille|pichet|coupe|fl[uû]te|kir|porto|martini|t[eé]quila|liqueur|cave|bulles)/i;

export function tvaTypeForCategorie(
  categorie: string,
  override?: Record<string, string> | null,
): TvaType {
  const o = override?.[categorie];
  if (o === "soft" || o === "alcool") return o;
  return ALCOOL_RE.test(categorie || "") ? "alcool" : "soft";
}

export const TVA_LABEL: Record<TvaType, string> = {
  soft: "Soft (10%)",
  food: "Food (10%)",
  alcool: "Alcool (10/20%)",
};

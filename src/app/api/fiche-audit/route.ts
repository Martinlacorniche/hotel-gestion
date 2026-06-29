import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireRole } from '@/lib/apiAuth';

// POST /api/fiche-audit   Body: { leadId: string }
//
// Assistant dossier de la fiche de fonction : refetch TOUT le dossier (lead,
// salles réservées, devis, programme saisi, notes) et le donne à Claude qui
// rend (1) une synthèse A→Z, (2) la liste des oublis/incohérences — dont la
// facturation finale —, (3) des lignes de programme à proposer. Sortie 100 %
// structurée (json_schema). Généré à LA DEMANDE (clic), jamais en auto.
//
// L'IA NE clôture rien et NE bloque rien : c'est un conseiller. La barrière de
// clôture reste la checklist déterministe côté UI.

const FICHE_AUDIT_SCHEMA = {
  type: 'object',
  properties: {
    synthese: {
      type: 'string',
      description: "Résumé clair de l'événement de A à Z, 2-4 phrases, ton de collègue, factuel.",
    },
    manques: {
      type: 'array',
      description: 'Oublis, incohérences et points à vérifier détectés dans le dossier.',
      items: {
        type: 'object',
        properties: {
          severite: { type: 'string', enum: ['critique', 'important', 'mineur'] },
          texte: { type: 'string' },
        },
        required: ['severite', 'texte'],
        additionalProperties: false,
      },
    },
    suggestions_programme: {
      type: 'array',
      description: 'Lignes de programme à proposer (déduites du devis + dates + salles). Vide si le programme est déjà complet.',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD' },
          heure: { type: 'string', description: 'HH:MM' },
          type: { type: 'string', enum: ['seminaire', 'repas', 'pause', 'autre'] },
          label: { type: 'string' },
          salle: { type: 'string' },
        },
        required: ['date', 'heure', 'type', 'label', 'salle'],
        additionalProperties: false,
      },
    },
    checklist_amont: {
      type: 'array',
      description: "Points de préparation AMONT à valider AVANT l'événement, pertinents POUR CE DOSSIER précis (2 à 6). N'inclure QUE ce qui s'applique : restauration seulement s'il y a de la food, hébergement seulement si chambres/séjour résidentiel, navette/transport si mentionné, matériel AV si demandé, etc. Ne PAS inclure les salles réservées (géré automatiquement) ni la facturation finale (phase clôture séparée).",
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Identifiant stable en minuscules sans espaces ni accents (ex: restauration, hebergement, navette, materiel_av). Sert à mémoriser la case cochée.' },
          label: { type: 'string', description: 'Libellé court de l’action (ex: "Hébergement confirmé").' },
          hint: { type: 'string', description: 'Précision courte spécifique au dossier (ex: "8 chambres BB, séjour 30/06→01/07").' },
        },
        required: ['key', 'label', 'hint'],
        additionalProperties: false,
      },
    },
  },
  required: ['synthese', 'manques', 'suggestions_programme', 'checklist_amont'],
  additionalProperties: false,
} as const;

const SYSTEM = `Tu es l'assistant d'un coordinateur événementiel d'hôtel (français, tutoiement, ton de collègue efficace).
On te donne TOUT le dossier d'un événement (séminaire/groupe) : le lead, les salles réservées, le devis, le programme déjà saisi et les notes des équipes.
Ta mission : aider à ce que RIEN ne soit oublié dans le déroulé de A à Z.

Rends exactement 3 choses :
1. "synthese" : 1 à 2 phrases MAX, télégraphiques (qui / quoi / quand / où / nb pers / prestations clés). C'est LA description lue en un coup d'œil — l'essentiel, zéro remplissage.
2. "manques" : oublis / incohérences / points à vérifier. UNE phrase courte chacun (~20 mots max), orientée action — jamais un paragraphe. Croise les sources. Exemples : facturation finale non émise sur événement passé (CRITIQUE) ; journée sans déjeuner/pause au programme ; nb de couverts > capacité salle ; horaires programme ≠ horaires réservation ; hébergement mentionné sans chambres ; presta facturée absente du programme. Classe en "critique" / "important" / "mineur". N'invente RIEN ("à confirmer" si l'info manque). Dossier nickel → liste vide.
3. "suggestions_programme" : lignes de programme manquantes (déjeuner, pause, début/fin séminaire) déduites du devis/dates/salles, horaires plausibles. NE re-propose PAS ce qui est déjà au programme. Vide si complet.
4. "checklist_amont" : 2 à 6 points de préparation à valider AVANT l'événement, pertinents pour CE dossier (resto si food, hébergement si chambres, navette si transport, AV si demandé...). PAS les salles (auto) ni la facturation (clôture).

"reponses_equipe" = infos déjà données par l'équipe en réponse à des points soulevés : NE les re-soulève PAS dans "manques", et INTÈGRE-les à la synthèse.
Le champ "aujourd_hui" est la référence temporelle. N'utilise que les données fournies.`;

export async function POST(req: Request) {
  const auth = await requireRole(req, ['superadmin', 'admin', 'user']);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ ok: false, error: 'ANTHROPIC_API_KEY manquante' }, { status: 500 });
  }

  let body: { leadId?: string; mode?: 'auto' | 'force' };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON invalide' }, { status: 400 });
  }
  const leadId = body.leadId;
  // 'auto' (défaut) = sert le cache si le dossier n'a pas changé ; 'force' = ré-analyse.
  const mode = body.mode === 'force' ? 'force' : 'auto';
  if (!leadId) return NextResponse.json({ ok: false, error: 'leadId requis' }, { status: 400 });

  // Refetch serveur du dossier complet (service_role, on ne fait pas confiance au client).
  const { data: lead } = await supabaseAdmin
    .from('suivi_commercial')
    .select('*')
    .eq('id', leadId)
    .single();
  if (!lead) return NextResponse.json({ ok: false, error: 'Dossier introuvable' }, { status: 404 });

  const [{ data: resa }, { data: quote }, { data: fiche }] = await Promise.all([
    supabaseAdmin
      .from('seminar_reservations')
      .select('start_date, end_date, start_time, end_time, seminar_rooms(name, capacity)')
      .eq('lead_id', leadId),
    supabaseAdmin
      .from('quotes')
      .select('numero, quote_items(label, description, quantity, unit_price_ttc, tva_rate, date)')
      .eq('lead_id', leadId)
      .maybeSingle(),
    supabaseAdmin
      .from('fiches_fonctions')
      .select('id, programme, notes_generales, notes_gaetan, notes_facturation, checklist, audit')
      .eq('lead_id', leadId)
      .maybeSingle(),
  ]);

  let programme: unknown = [];
  try {
    if (fiche?.programme) programme = JSON.parse(fiche.programme);
  } catch {}

  const ctx = {
    aujourd_hui: new Date().toISOString().slice(0, 10),
    evenement: {
      client: lead.nom_client,
      societe: lead.societe,
      titre: lead.titre_demande,
      date_debut: lead.date_evenement,
      date_fin: lead.date_fin_evenement,
      statut: lead.statut,
      etat_paiement: lead.etat_paiement,
      budget_estime: lead.budget_estime,
      montant_paye: lead.montant_paye,
      besoin_gaetan: lead.besoin_gaetan,
      commentaires: lead.commentaires,
    },
    salles_reservees: (resa ?? []).map((r) => {
      const room = r.seminar_rooms as { name?: string; capacity?: number } | null;
      return {
        salle: room?.name ?? null,
        capacite: room?.capacity ?? null,
        date_debut: r.start_date,
        date_fin: r.end_date,
        heure_debut: r.start_time,
        heure_fin: r.end_time,
      };
    }),
    devis: {
      numero: quote?.numero ?? null,
      lignes: (quote?.quote_items ?? []).map((i) => ({
        label: i.label,
        detail: i.description,
        quantite: i.quantity,
        prix_ttc: i.unit_price_ttc,
        date: i.date,
      })),
    },
    programme_actuel: programme,
    notes: {
      generales: fiche?.notes_generales ?? null,
      gaetan: fiche?.notes_gaetan ?? null,
      facturation: fiche?.notes_facturation ?? null,
    },
    // Réponses déjà données par l'équipe aux points soulevés (boucle "outil vivant").
    reponses_equipe: (((fiche?.checklist as { manques_reponses?: { reponse?: string }[] } | null)?.manques_reponses) ?? [])
      .map((r) => r.reponse).filter(Boolean),
  };

  // Empreinte du dossier = tout ce que l'IA lit, SAUF aujourd_hui (changer de jour
  // ne périme pas l'analyse). Les réponses de l'équipe SONT dans l'empreinte : une
  // nouvelle réponse doit déclencher une ré-analyse (Junior en tient compte).
  const { aujourd_hui: _aj, ...hashInput } = ctx;
  const signature = createHash('sha256').update(JSON.stringify(hashInput)).digest('hex');

  // Cache : si le dossier n'a pas bougé depuis la dernière analyse, on la ressert
  // sans appeler le modèle (0 coût). 'force' court-circuite le cache.
  const cached = fiche?.audit as { result?: unknown; signature?: string; generated_at?: string } | null;
  if (mode === 'auto' && cached?.result && cached.signature === signature) {
    return NextResponse.json({ ok: true, audit: cached.result, cached: true, generated_at: cached.generated_at ?? null });
  }

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      // Sonnet : l'audit croise plusieurs sources (devis ↔ programme ↔ salles ↔
      // dates) et raisonne sur ce qui manque — Haiku rate ces recoupements.
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      system: SYSTEM,
      output_config: {
        format: {
          type: 'json_schema',
          schema: FICHE_AUDIT_SCHEMA as unknown as Record<string, unknown>,
        },
      },
      messages: [{ role: 'user', content: JSON.stringify(ctx) }],
    });

    if (response.stop_reason === 'refusal') {
      return NextResponse.json({ ok: false, error: 'Analyse impossible' }, { status: 422 });
    }
    const block = response.content.find((b) => b.type === 'text');
    if (!block || block.type !== 'text') {
      return NextResponse.json({ ok: false, error: 'Réponse vide du modèle' }, { status: 502 });
    }
    const parsed = JSON.parse(block.text) as {
      synthese: string;
      manques: { severite: string; texte: string }[];
      suggestions_programme: { date: string; heure: string; type: string; label: string; salle: string }[];
    };

    // Anti-pollution : on retire les suggestions dont le libellé correspond déjà
    // à une ligne du programme (normalisation : minuscules, sans parenthèses,
    // sans chiffres/ponctuation). Le modèle re-propose parfois une ligne
    // existante juste pour y ajouter une heure — inutile, ça doublonne.
    const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-zà-ÿ]+/g, ' ').trim();
    const existing = new Set((Array.isArray(programme) ? programme : []).map((r) => norm((r as { label?: string })?.label)).filter(Boolean));
    if (Array.isArray(parsed.suggestions_programme)) {
      parsed.suggestions_programme = parsed.suggestions_programme.filter((s) => !existing.has(norm(s.label)));
    }

    // Mise en cache (si la fiche existe déjà en base) : résultat + empreinte du
    // dossier analysé. La prochaine ouverture compare l'empreinte et évite un
    // appel si rien n'a changé.
    const generated_at = new Date().toISOString();
    if (fiche?.id) {
      await supabaseAdmin
        .from('fiches_fonctions')
        .update({ audit: { result: parsed, signature, generated_at } })
        .eq('id', fiche.id);
    }
    return NextResponse.json({ ok: true, audit: parsed, cached: false, generated_at });
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      console.error('fiche-audit: erreur API Anthropic', err.status, err.message);
      return NextResponse.json({ ok: false, error: 'Analyse indisponible, réessaie' }, { status: 502 });
    }
    console.error('fiche-audit: erreur inattendue', err);
    return NextResponse.json({ ok: false, error: 'Erreur interne' }, { status: 500 });
  }
}

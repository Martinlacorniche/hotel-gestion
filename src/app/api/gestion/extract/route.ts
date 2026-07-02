import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { requireRole } from '@/lib/apiAuth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { listSupplierInvoicesRange, downloadPdfBase64, num } from '@/lib/pennylane';
import { posteForLabel, fournisseurFromLabel, isAvoirLabel, moisRattachement } from '@/lib/gestion';

// Extraction des factures fournisseurs ciblées (PDJ/Cowork/Resto) : lecture
// Pennylane → PDF → Claude (lignes + prix) → stockage. ADMIN only.
// 1 facture par appel (l'extraction Claude peut prendre ~25s ; le client boucle
// jusqu'à `remaining` = 0). maxDuration = borne Netlify.
export const maxDuration = 26;

const SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    fournisseur: { type: 'string' },
    date: { type: 'string' },
    total_ht: { type: 'number' },
    lignes: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          produit: { type: 'string' },
          produit_ref: { type: 'string' },
          quantite: { type: 'number' },
          unite: { type: 'string' },
          prix_unitaire: { type: 'number' },
          montant_ht: { type: 'number' },
          hors_poste: { type: 'boolean' },
        },
        required: ['produit', 'produit_ref', 'quantite', 'unite', 'prix_unitaire', 'montant_ht', 'hors_poste'],
      },
    },
  },
  required: ['fournisseur', 'date', 'total_ht', 'lignes'],
} as const;

const PROMPT = `Facture fournisseur d'un hôtel. Extrais : fournisseur, date, total HT, et TOUTES les lignes d'articles.
Pour chaque ligne :
- produit : le libellé tel qu'écrit sur la facture ;
- produit_ref : un nom CANONIQUE court et normalisé du produit, stable d'une facture à l'autre (même produit → même produit_ref), pour suivre son prix dans le temps (ex. "Café Tivolo grains", "Lait demi-écrémé 50cl") ;
- quantite, unite, prix_unitaire (HT), montant_ht ;
- hors_poste = true si la ligne n'est visiblement pas de la marchandise du poste (frais de port, consigne, écocontribution, matériel isolé…).
Si une valeur manque, mets 0 ou "".`;

function jsonError(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export async function POST(req: Request) {
  const auth = await requireRole(req, ['admin', 'superadmin']);
  if (!auth.ok) return jsonError(auth.status, auth.error);

  let body: { since?: string; until?: string; poste?: string } = {};
  try { body = await req.json(); } catch { /* défauts */ }
  const posteFilter = ['pdj', 'cowork', 'resto'].includes(String(body.poste)) ? String(body.poste) : null;
  const until = body.until || new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
  const since = body.since || (() => { const d = new Date(); d.setDate(d.getDate() - 45); return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(d); })();

  let invoices;
  try {
    invoices = await listSupplierInvoicesRange(since, until);
  } catch (e) {
    return jsonError(502, e instanceof Error ? e.message : 'Erreur Pennylane');
  }

  // Fournisseurs suivis + dédoublonnage par n° de facture.
  // Fournisseurs suivis. Certaines factures existent EN DOUBLE chez Pennylane
  // (une réelle + une à 0 €). On dédoublonne par n° en gardant celle au montant
  // le plus élevé (la vraie), pas la première rencontrée.
  const eligible = invoices.filter((i) => { const p = posteForLabel(i.label); return p && (!posteFilter || p === posteFilter); });
  const val = (i: typeof eligible[number]) => Math.abs(num(i.currency_amount_before_tax) || num(i.amount));
  const best = new Map<string, typeof eligible[number]>();
  for (const i of eligible) {
    const k = i.invoice_number || String(i.id);
    const cur = best.get(k);
    if (!cur || val(i) > val(cur)) best.set(k, i);
  }
  const matched = [...best.values()];

  // On saute les factures déjà extraites (par pennylane_id).
  const ids = matched.map((i) => i.id);
  const { data: existing } = ids.length
    ? await supabaseAdmin.from('gestion_achats').select('pennylane_id').in('pennylane_id', ids)
    : { data: [] as { pennylane_id: number }[] };
  const doneIds = new Set((existing || []).map((r) => r.pennylane_id));
  const pending = matched.filter((i) => !doneIds.has(i.id));

  if (pending.length === 0) {
    return NextResponse.json({ ok: true, matched: matched.length, pending: 0, processed: 0, remaining: 0, results: [] });
  }

  // On traite UNE facture par appel (latence Claude).
  const inv = pending[0];
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const poste = posteForLabel(inv.label);
  const isAvoir = isAvoirLabel(inv.label);
  const sign = isAvoir ? -1 : 1;
  // Total HT = montant HT de l'API Pennylane, avec repli sur le TTC si le HT est
  // absent (certains fournisseurs sans ventilation TVA). Claude ne sert qu'aux lignes.
  const totalHtApi = sign * Math.abs(num(inv.currency_amount_before_tax) || num(inv.amount));

  // Auto-réparation : on retire une éventuelle version antérieure de CETTE facture
  // (ex. le doublon Pennylane à 0 € enregistré lors d'un run précédent).
  if (inv.invoice_number) {
    await supabaseAdmin.from('gestion_achats').delete().eq('invoice_number', inv.invoice_number);
  }

  // 1) On enregistre la FACTURE d'abord (toujours) → même si l'extraction des
  //    lignes échoue, elle est marquée traitée et la boucle avance (pas de blocage).
  const { data: achat, error: aErr } = await supabaseAdmin.from('gestion_achats').insert({
    pennylane_id: inv.id,
    invoice_number: inv.invoice_number || null,
    fournisseur: fournisseurFromLabel(inv.label),
    poste,
    is_avoir: isAvoir,
    date_facture: inv.date || null,
    mois_rattachement: moisRattachement(inv.date),
    total_ht: totalHtApi,
  }).select('id').single();
  if (aErr) return jsonError(500, aErr.message);

  // 2) Extraction des lignes par Claude — best-effort (une facture qui tronque
  //    ne bloque pas le reste ; ses lignes pourront être refaites plus tard).
  let nbLignes = 0;
  let note: string | null = null;
  try {
    const b64 = await downloadPdfBase64(inv.public_file_url!);
    const res = await anthropic.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 16000,
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } },
        { type: 'text', text: PROMPT },
      ] }],
    } as Anthropic.MessageCreateParamsNonStreaming);
    if (res.stop_reason === 'max_tokens') throw new Error('sortie tronquée (max_tokens)');
    const textBlock = res.content.find((b) => b.type === 'text') as { text?: string } | undefined;
    const out = JSON.parse(textBlock?.text || '{}');

    const lignes = (Array.isArray(out.lignes) ? out.lignes : []).map((l: Record<string, unknown>) => ({
      achat_id: achat.id,
      produit: String(l.produit || ''),
      produit_ref: String(l.produit_ref || l.produit || ''),
      quantite: sign * Math.abs(Number(l.quantite) || 0),
      unite: String(l.unite || ''),
      prix_unitaire: Number(l.prix_unitaire) || 0,
      montant_ht: sign * Math.abs(Number(l.montant_ht) || 0),
      hors_poste: !!l.hors_poste,
      poste: l.hors_poste ? null : poste,
    }));
    if (lignes.length) {
      const { error: lErr } = await supabaseAdmin.from('gestion_achats_lignes').insert(lignes);
      if (lErr) throw new Error(lErr.message);
    }
    nbLignes = lignes.length;
    // Si l'API n'avait pas de HT, on retombe sur celui de Claude.
    if (!totalHtApi && out.total_ht) {
      await supabaseAdmin.from('gestion_achats').update({ total_ht: sign * Math.abs(Number(out.total_ht)) }).eq('id', achat.id);
    }
  } catch (e) {
    note = e instanceof Error ? e.message : 'extraction lignes échouée';
  }

  return NextResponse.json({
    ok: true,
    matched: matched.length,
    pending: pending.length,
    processed: 1,
    remaining: pending.length - 1,
    last: { fournisseur: fournisseurFromLabel(inv.label), poste, lignes: nbLignes, date: inv.date, note },
  });
}

import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/apiAuth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

// Écritures cockpit gestion. ADMIN only.
//  - action 'revenu' : upsert le CA (et quantité) d'un mois/poste.
//  - action 'mois'   : change le mois de rattachement d'une facture.
export async function POST(req: Request) {
  const auth = await requireRole(req, ['admin', 'superadmin']);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }); }

  if (body.action === 'revenu') {
    const mois = String(body.mois || '');
    const poste = String(body.poste || '');
    if (!/^\d{4}-\d{2}$/.test(mois) || !poste) return NextResponse.json({ error: 'mois/poste requis' }, { status: 400 });
    const { error } = await supabaseAdmin.from('gestion_revenus').upsert({
      mois, poste,
      ca_ht: Number(body.ca_ht) || 0,
      quantite: body.quantite === '' || body.quantite == null ? null : Number(body.quantite),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'mois,poste' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'mois') {
    const id = String(body.achat_id || '');
    const mois = String(body.mois_rattachement || '');
    if (!id || !/^\d{4}-\d{2}$/.test(mois)) return NextResponse.json({ error: 'achat_id/mois invalide' }, { status: 400 });
    const { error } = await supabaseAdmin.from('gestion_achats').update({ mois_rattachement: mois }).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'ligne_delete') {
    const id = String(body.id || '');
    if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });
    const { error } = await supabaseAdmin.from('gestion_achats_lignes').delete().eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'ligne_patch') {
    const id = String(body.id || '');
    if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });
    const patch: Record<string, unknown> = {};
    if ('hors_poste' in body) patch.hors_poste = !!body.hors_poste;
    if ('poste' in body) patch.poste = body.poste ? String(body.poste) : null;
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'rien à modifier' }, { status: 400 });
    const { error } = await supabaseAdmin.from('gestion_achats_lignes').update(patch).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'produit') {
    const ref = String(body.produit_ref || '');
    if (!ref) return NextResponse.json({ error: 'produit_ref requis' }, { status: 400 });
    const row: Record<string, unknown> = { produit_ref: ref, updated_at: new Date().toISOString() };
    if ('unite_conso' in body) row.unite_conso = body.unite_conso ? String(body.unite_conso) : null;
    if ('unite_achat' in body) row.unite_achat = body.unite_achat ? String(body.unite_achat) : null;
    if ('poste' in body) row.poste = body.poste ? String(body.poste) : null;
    if ('facteur' in body) row.facteur = body.facteur === '' || body.facteur == null ? null : Number(body.facteur);
    const { error } = await supabaseAdmin.from('gestion_produits').upsert(row, { onConflict: 'produit_ref' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'action inconnue' }, { status: 400 });
}

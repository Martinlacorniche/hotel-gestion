import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/apiAuth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

// Suivi de prix à la demande. ADMIN only.
//  - sans ?ref : liste des produits (produit_ref distincts) pour le sélecteur.
//  - avec ?ref=... : historique de prix du produit (toutes dates), pour la courbe.
export async function GET(req: Request) {
  const auth = await requireRole(req, ['admin', 'superadmin']);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const ref = new URL(req.url).searchParams.get('ref');

  if (!ref) {
    const { data } = await supabaseAdmin.from('gestion_achats_lignes').select('produit_ref').not('produit_ref', 'is', null);
    const refs = [...new Set(((data || []) as { produit_ref: string }[]).map((r) => r.produit_ref).filter(Boolean))].sort();
    return NextResponse.json({ refs });
  }

  const { data } = await supabaseAdmin.from('gestion_achats_lignes')
    .select('prix_unitaire,unite,quantite,gestion_achats(date_facture,fournisseur)')
    .eq('produit_ref', ref);
  const history = ((data || []) as { prix_unitaire: number; unite: string | null; gestion_achats?: { date_facture?: string; fournisseur?: string } }[])
    .map((r) => ({ date: r.gestion_achats?.date_facture || '', prix: Number(r.prix_unitaire), unite: r.unite || '', fournisseur: r.gestion_achats?.fournisseur || '' }))
    .filter((r) => r.date && r.prix)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  return NextResponse.json({ ref, history });
}

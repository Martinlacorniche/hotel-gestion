import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/apiAuth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

// Données du cockpit gestion pour un mois de rattachement donné. ADMIN only.
// Renvoie : factures du mois, lignes (avec fournisseur/date), revenus saisis, et
// l'historique de prix (toutes dates) des produits vus ce mois (suivi de prix).
export async function GET(req: Request) {
  const auth = await requireRole(req, ['admin', 'superadmin']);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const mois = new URL(req.url).searchParams.get('mois')
    || new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit' }).format(new Date());

  const { data: achats } = await supabaseAdmin
    .from('gestion_achats').select('*').eq('mois_rattachement', mois).order('date_facture', { ascending: true });

  const ids = (achats || []).map((a) => a.id);
  const { data: lignes } = ids.length
    ? await supabaseAdmin.from('gestion_achats_lignes')
        .select('*, gestion_achats(fournisseur,date_facture,poste)').in('achat_id', ids)
    : { data: [] as unknown[] };

  const { data: revenus } = await supabaseAdmin.from('gestion_revenus').select('*').eq('mois', mois);

  const refs = [...new Set(((lignes || []) as { produit_ref?: string }[]).map((l) => l.produit_ref).filter(Boolean))];
  const { data: prix } = refs.length
    ? await supabaseAdmin.from('gestion_achats_lignes')
        .select('produit_ref,prix_unitaire,unite,gestion_achats(date_facture,fournisseur)')
        .in('produit_ref', refs as string[])
    : { data: [] as unknown[] };

  return NextResponse.json({ mois, achats: achats || [], lignes: lignes || [], revenus: revenus || [], prix: prix || [] });
}

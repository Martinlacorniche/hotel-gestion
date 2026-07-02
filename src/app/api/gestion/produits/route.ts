import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/apiAuth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

// Référentiel produit : liste des produits (produit_ref distincts vus dans les
// factures) fusionnée avec le référentiel saisi (unité de conso + facteur). ADMIN.
export async function GET(req: Request) {
  const auth = await requireRole(req, ['admin', 'superadmin']);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { data: lignes } = await supabaseAdmin.from('gestion_achats_lignes')
    .select('produit_ref,unite,poste').not('produit_ref', 'is', null);
  const { data: refDef } = await supabaseAdmin.from('gestion_produits').select('*');

  // Agrège l'unité d'achat + poste les plus fréquents par produit.
  const agg = new Map<string, { uniteCount: Record<string, number>; posteCount: Record<string, number>; n: number }>();
  for (const l of (lignes || []) as { produit_ref: string; unite: string | null; poste: string | null }[]) {
    const r = l.produit_ref; if (!r) continue;
    const a = agg.get(r) || { uniteCount: {}, posteCount: {}, n: 0 };
    if (l.unite) a.uniteCount[l.unite] = (a.uniteCount[l.unite] || 0) + 1;
    if (l.poste) a.posteCount[l.poste] = (a.posteCount[l.poste] || 0) + 1;
    a.n++; agg.set(r, a);
  }
  const top = (m: Record<string, number>) => Object.entries(m).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  const defBy = new Map((refDef || []).map((d: { produit_ref: string }) => [d.produit_ref, d]));

  const produits = [...agg.entries()].map(([produit_ref, a]) => {
    const def = defBy.get(produit_ref) as { poste?: string; unite_conso?: string; facteur?: number } | undefined;
    return {
      produit_ref,
      n: a.n,
      unite_achat: top(a.uniteCount),
      poste: def?.poste || top(a.posteCount),
      unite_conso: def?.unite_conso || '',
      facteur: def?.facteur ?? null,
    };
  }).sort((a, b) => a.produit_ref.localeCompare(b.produit_ref));

  return NextResponse.json({ produits });
}

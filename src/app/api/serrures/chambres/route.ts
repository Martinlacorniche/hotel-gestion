import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireRole } from '@/lib/apiAuth';

// Liste les chambres avec leur séjour actif (si présent), pour la grille UI.

export async function GET(req: Request) {
  const auth = await requireRole(req, ['superadmin', 'admin', 'user']);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const { data: chambres, error: errC } = await supabaseAdmin
    .from('chambres')
    .select('id, hotel_id, numero, tthotel_lock_id, tthotel_lock_alias, ordre')
    .order('ordre', { ascending: true })
    .order('numero', { ascending: true });
  if (errC) return NextResponse.json({ ok: false, error: errC.message }, { status: 500 });

  // Expiration paresseuse : un séjour dont le checkout est passé libère la chambre
  // (le code/la carte expirent d'eux-mêmes sur la serrure à `fin`). On inclut
  // 'pending' : un encodage raté laissait sinon la chambre occupée indéfiniment.
  const nowIso = new Date().toISOString();
  await supabaseAdmin
    .from('sejours')
    .update({ statut: 'expire', updated_at: nowIso })
    .in('statut', ['actif', 'pending'])
    .lt('fin', nowIso);

  const { data: sejours, error: errS } = await supabaseAdmin
    .from('sejours')
    .select('*')
    .in('statut', ['actif', 'pending']);
  if (errS) return NextResponse.json({ ok: false, error: errS.message }, { status: 500 });

  // Un séjour reste 'pending' tant qu'aucun job d'encodage n'a réussi. On joint le
  // dernier job pour que l'UI puisse distinguer « ça encode » de « ça a échoué »
  // et offrir une sortie (réessayer / annuler) au lieu d'un spinner sans fin.
  const pendings = (sejours ?? []).filter((s) => s.statut === 'pending');
  const jobBySejour = new Map<string, { statut: string; error: string | null; created_at: string }>();
  if (pendings.length > 0) {
    const headIds = [...new Set(pendings.map((s) => s.parent_sejour_id ?? s.id))];
    const { data: jobs } = await supabaseAdmin
      .from('jobs_encodeur')
      .select('sejour_id, statut, resultat, created_at')
      .in('sejour_id', headIds)
      .eq('action', 'write_card')
      .order('created_at', { ascending: true }); // le dernier écrase : on garde le plus récent
    for (const j of jobs ?? []) {
      const res = j.resultat as Record<string, unknown> | null;
      jobBySejour.set(j.sejour_id as string, {
        statut: j.statut as string,
        error: res && typeof res.error === 'string' ? (res.error as string) : null,
        created_at: j.created_at as string,
      });
    }
  }

  const byChambre = new Map<string, typeof sejours[number]>();
  for (const s of sejours ?? []) byChambre.set(s.chambre_id, s);

  return NextResponse.json({
    ok: true,
    chambres: (chambres ?? []).map((c) => {
      const s = byChambre.get(c.id) ?? null;
      return {
        ...c,
        sejour:
          s && s.statut === 'pending'
            ? { ...s, job: jobBySejour.get(s.parent_sejour_id ?? s.id) ?? null }
            : s,
      };
    }),
  });
}

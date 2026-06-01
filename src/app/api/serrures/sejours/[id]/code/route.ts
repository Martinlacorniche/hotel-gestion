import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { generatePasscode, pushPasscode, deletePasscode } from '@/lib/tthotel';
import { sejourActiveCardNos } from '@/lib/serruresLocks';
import { requireRole } from '@/lib/apiAuth';

// POST   /api/serrures/sejours/:id/code  → ajoute un code à un séjour existant
// DELETE /api/serrures/sejours/:id/code  → révoque le code du séjour

type Ctx = { params: Promise<{ id: string }> };
const OPS = ['superadmin', 'admin', 'user'] as const;

async function loadSejour(id: string) {
  const { data, error } = await supabaseAdmin
    .from('sejours')
    .select('*, chambres(numero, tthotel_lock_id)')
    .eq('id', id)
    .single();
  if (error || !data) throw new Error(error?.message ?? 'séjour introuvable');
  return data as typeof data & { chambres: { numero: string; tthotel_lock_id: number } };
}

export async function POST(req: Request, ctx: Ctx) {
  const auth = await requireRole(req, [...OPS]);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const { id } = await ctx.params;
  let sejour;
  try {
    sejour = await loadSejour(id);
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 404 });
  }
  if (sejour.statut !== 'actif' && sejour.statut !== 'pending') {
    return NextResponse.json({ ok: false, error: 'séjour clos' }, { status: 409 });
  }
  if (sejour.tthotel_passcode_id) {
    return NextResponse.json({ ok: false, error: 'ce séjour a déjà un code' }, { status: 409 });
  }

  const code = generatePasscode();
  let keyboardPwdId: number;
  try {
    keyboardPwdId = await pushPasscode(
      sejour.chambres.tthotel_lock_id,
      code,
      new Date(sejour.debut).getTime(),
      new Date(sejour.fin).getTime(),
      `Chambre ${sejour.chambres.numero}`,
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }

  const { error } = await supabaseAdmin
    .from('sejours')
    .update({ code, tthotel_passcode_id: keyboardPwdId, statut: 'actif', updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, code });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const auth = await requireRole(req, [...OPS]);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const { id } = await ctx.params;
  let sejour;
  try {
    sejour = await loadSejour(id);
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 404 });
  }
  if (!sejour.tthotel_passcode_id) {
    return NextResponse.json({ ok: false, error: 'aucun code sur ce séjour' }, { status: 409 });
  }

  // Un code multi-chambres = 1 séjour par chambre liés par parent_sejour_id, même
  // code. Révoquer = révoquer TOUT le groupe (sur chaque serrure).
  const rootId = (sejour as { parent_sejour_id: string | null }).parent_sejour_id ?? sejour.id;
  const { data: group, error: eG } = await supabaseAdmin
    .from('sejours')
    .select('id, tthotel_passcode_id, chambres(numero, tthotel_lock_id)')
    .or(`id.eq.${rootId},parent_sejour_id.eq.${rootId}`)
    .not('tthotel_passcode_id', 'is', null)
    .in('statut', ['actif', 'pending']);
  if (eG) return NextResponse.json({ ok: false, error: eG.message }, { status: 500 });

  const now = new Date().toISOString();
  const results: { numero: string; ok: boolean; error?: string }[] = [];
  for (const m of group ?? []) {
    const ch = (m as unknown as { chambres: { numero: string; tthotel_lock_id: number } | null }).chambres;
    const pwdId = (m as { tthotel_passcode_id: number | null }).tthotel_passcode_id;
    if (!ch || !pwdId) continue;
    let ok = true;
    let error: string | undefined;
    try {
      await deletePasscode(ch.tthotel_lock_id, pwdId);
    } catch (err) {
      ok = false;
      error = err instanceof Error ? err.message : String(err);
    }
    if (ok) {
      const hasCard = (await sejourActiveCardNos(m.id)).length > 0;
      const update: Record<string, unknown> = { code: null, tthotel_passcode_id: null, updated_at: now };
      if (!hasCard) update.statut = 'revoque';
      await supabaseAdmin.from('sejours').update(update).eq('id', m.id);
    }
    results.push({ numero: ch.numero, ok, error });
  }

  return NextResponse.json({ ok: results.every((r) => r.ok), results });
}

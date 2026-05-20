import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { changePasscodePeriod, deletePasscode } from '@/lib/tthotel';
import { requireRole } from '@/lib/apiAuth';

// PATCH /api/serrures/sejours/:id   body { fin: ISO } → prolonge
// DELETE /api/serrures/sejours/:id                    → révoque

type Ctx = { params: Promise<{ id: string }> };

const OPS_ROLES = ['superadmin', 'admin', 'user'] as const;

async function loadSejour(id: string) {
  const { data, error } = await supabaseAdmin
    .from('sejours')
    .select('*, chambres(tthotel_lock_id)')
    .eq('id', id)
    .single();
  if (error || !data) throw new Error(error?.message ?? 'séjour introuvable');
  return data as typeof data & { chambres: { tthotel_lock_id: number } };
}

export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await requireRole(req, [...OPS_ROLES]);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const { id } = await ctx.params;
  const body = (await req.json()) as { fin?: string };
  if (!body.fin) {
    return NextResponse.json({ ok: false, error: 'fin (ISO) requise' }, { status: 400 });
  }
  let sejour;
  try {
    sejour = await loadSejour(id);
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 404 });
  }
  if (sejour.statut !== 'actif') {
    return NextResponse.json({ ok: false, error: 'séjour non actif' }, { status: 409 });
  }

  const newFin = new Date(body.fin);
  const debut = new Date(sejour.debut);

  if (sejour.methode === 'code' && sejour.tthotel_passcode_id) {
    try {
      await changePasscodePeriod(
        sejour.chambres.tthotel_lock_id,
        sejour.tthotel_passcode_id,
        debut.getTime(),
        newFin.getTime(),
      );
    } catch (err) {
      return NextResponse.json(
        { ok: false, error: err instanceof Error ? err.message : String(err) },
        { status: 502 },
      );
    }
  }
  // Pour carte : il faudra re-encoder. Pas géré dans le PoC, on update juste la DB.

  const { data: updated, error } = await supabaseAdmin
    .from('sejours')
    .update({ fin: newFin.toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, sejour: updated });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const auth = await requireRole(req, [...OPS_ROLES]);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const { id } = await ctx.params;
  let sejour;
  try {
    sejour = await loadSejour(id);
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 404 });
  }
  if (sejour.statut !== 'actif' && sejour.statut !== 'pending') {
    return NextResponse.json({ ok: false, error: 'séjour déjà clos' }, { status: 409 });
  }

  if (sejour.methode === 'code' && sejour.tthotel_passcode_id) {
    try {
      await deletePasscode(sejour.chambres.tthotel_lock_id, sejour.tthotel_passcode_id);
    } catch (err) {
      // On poursuit malgré l'erreur TTHotel (le code va expirer naturellement à `fin`)
      console.warn('[revoke] deletePasscode failed:', err);
    }
  }

  const { error } = await supabaseAdmin
    .from('sejours')
    .update({ statut: 'revoque', updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

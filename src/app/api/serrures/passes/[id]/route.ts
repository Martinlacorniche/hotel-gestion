import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

// DELETE /api/serrures/passes/:id  → retire le pass de la liste.
// NB : sans gateway, ça ne révoque PAS la carte physique (elle expire à `fin`).
// Quand les gateways seront posés, on ajoutera ici la suppression côté serrure.

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const { error } = await supabaseAdmin.from('passes').delete().eq('id', id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

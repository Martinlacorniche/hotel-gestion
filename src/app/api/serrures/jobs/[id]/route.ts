import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

// GET /api/serrures/jobs/:id  → état du job (polling depuis l'UI carte)

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const { data, error } = await supabaseAdmin
    .from('jobs_encodeur')
    .select('id, statut, resultat, action, created_at, updated_at')
    .eq('id', id)
    .single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 404 });
  return NextResponse.json({ ok: true, job: data });
}

import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/apiAuth';
import { hotelConfig } from '@/lib/mailAssistant';
import { getModes, setMode, CATEGORY_MODES, type ActionMode } from '@/lib/mailActions';

// Gestionnaire de mails — MODES par catégorie (off | suggest | auto), par hôtel (superadmin).
//   GET /api/mail-assistant/config?hotel=voiles          -> { modes: {category: mode} }
//   PUT /api/mail-assistant/config?hotel=voiles          -> body { category, mode }

export const dynamic = 'force-dynamic';

const VALID: ActionMode[] = ['off', 'suggest', 'auto'];

export async function GET(req: Request) {
  const auth = await requireRole(req, ['superadmin']);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const cfg = hotelConfig(new URL(req.url).searchParams.get('hotel') || '');
  if (!cfg) return NextResponse.json({ ok: false, error: 'hotel invalide' }, { status: 400 });
  const modes = await getModes(cfg.key);
  return NextResponse.json({ ok: true, modes });
}

export async function PUT(req: Request) {
  const auth = await requireRole(req, ['superadmin']);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const cfg = hotelConfig(new URL(req.url).searchParams.get('hotel') || '');
  if (!cfg) return NextResponse.json({ ok: false, error: 'hotel invalide' }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const category = String(body.category || '');
  const mode = String(body.mode || '') as ActionMode;
  if (!CATEGORY_MODES.includes(category as never) || !VALID.includes(mode)) {
    return NextResponse.json({ ok: false, error: 'category/mode invalide' }, { status: 400 });
  }
  await setMode(cfg.key, category, mode);
  return NextResponse.json({ ok: true });
}

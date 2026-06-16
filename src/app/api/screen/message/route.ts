import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireRole } from '@/lib/apiAuth';

// API écran SmallTV — réservé au superadmin.
//
// POST /api/screen/message
//   Body: { text: string, duration?: number }
//   Crée un message 'pending' dans screen_messages. Le worker Python sur le LAN
//   le consommera pour l'afficher sur l'écran.
//
// GET /api/screen/message
//   Renvoie l'historique récent (10 derniers) + le dernier message.
//
// La table screen_messages est en RLS deny : seul ce service_role y accède.

const MAX_TEXT_LEN = 200;
const DEFAULT_DURATION = 10;
const MIN_DURATION = 1;
const MAX_DURATION = 3600;

export async function POST(req: Request) {
  const auth = await requireRole(req, ['superadmin']);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON invalide' }, { status: 400 });
  }

  // Validation du texte (1..200 caractères, contrainte RAM ESP8266).
  const rawText = typeof body.text === 'string' ? body.text.trim() : '';
  if (!rawText) {
    return NextResponse.json({ ok: false, error: 'Texte requis' }, { status: 400 });
  }
  if (rawText.length > MAX_TEXT_LEN) {
    return NextResponse.json(
      { ok: false, error: `Texte trop long (max ${MAX_TEXT_LEN} caractères)` },
      { status: 400 },
    );
  }

  // Durée : bornée [1, 3600] s, défaut 10 s.
  let duration = DEFAULT_DURATION;
  if (body.duration !== undefined && body.duration !== null) {
    const n = Number(body.duration);
    if (!Number.isFinite(n)) {
      return NextResponse.json({ ok: false, error: 'Durée invalide' }, { status: 400 });
    }
    duration = Math.min(MAX_DURATION, Math.max(MIN_DURATION, Math.round(n)));
  }

  // Nom de l'auteur pour l'historique (best effort).
  const { data: pu } = await supabaseAdmin
    .from('users')
    .select('name')
    .eq('id_auth', auth.userId)
    .single();

  const { data, error } = await supabaseAdmin
    .from('screen_messages')
    .insert({
      text: rawText,
      duration_sec: duration,
      status: 'pending',
      created_by: auth.userId,
      created_by_name: pu?.name ?? null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, message: data });
}

export async function GET(req: Request) {
  const auth = await requireRole(req, ['superadmin']);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const { data, error } = await supabaseAdmin
    .from('screen_messages')
    .select('id, text, duration_sec, status, error, created_by_name, created_at, sent_at')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, messages: data ?? [], current: data?.[0] ?? null });
}

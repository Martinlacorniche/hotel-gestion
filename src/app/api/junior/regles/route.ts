import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireRole } from '@/lib/apiAuth';

// Ce que Junior sait du métier — lisible et modifiable sans développeur.
//
//   GET    /api/junior/regles
//   POST   /api/junior/regles        { hotel_key?, titre, regle, portee?, origine? }
//   PATCH  /api/junior/regles        { id, ...champs }
//
// Ces règles sont lues par le classifieur quand il trie ET par l'agent quand il
// enquête (table `junior_regles`, migration 104). Les écrire ici, c'est apprendre
// quelque chose à Junior sans toucher au code ni attendre un déploiement.
//
// ⚠️ `origine` compte autant que la règle : sans le pourquoi, quelqu'un la
// « corrige » plus tard en croyant bien faire. C'est ce qui est arrivé à la règle
// Provence Méditerranée, posée le 13/07 et annulée le 23.

export const dynamic = 'force-dynamic';

const CHAMPS = 'id, hotel_key, titre, regle, portee, actif, origine, updated_at, updated_by';

export async function GET(req: Request) {
  const auth = await requireRole(req, ['superadmin']);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const { data, error } = await supabaseAdmin
    .from('junior_regles').select(CHAMPS)
    .order('actif', { ascending: false })
    .order('hotel_key', { ascending: true, nullsFirst: true })
    .order('titre');
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, regles: data ?? [] });
}

async function quiEcrit(userId: string | undefined) {
  if (!userId) return null;
  const { data } = await supabaseAdmin.from('users').select('name').eq('id_auth', userId).maybeSingle();
  return (data?.name as string) || null;
}

export async function POST(req: Request) {
  const auth = await requireRole(req, ['superadmin']);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const b = await req.json().catch(() => ({}));
  const titre = String(b.titre || '').trim();
  const regle = String(b.regle || '').trim();
  if (!titre || !regle) {
    return NextResponse.json({ ok: false, error: 'Il faut un titre et une règle.' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin.from('junior_regles').insert({
    hotel_key: b.hotel_key === 'voiles' || b.hotel_key === 'corniche' ? b.hotel_key : null,
    titre, regle,
    portee: ['redaction', 'agent', 'les_deux'].includes(b.portee) ? b.portee : 'les_deux',
    origine: String(b.origine || '').trim() || null,
    updated_by: await quiEcrit(auth.userId),
  }).select(CHAMPS).single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, regle: data });
}

export async function PATCH(req: Request) {
  const auth = await requireRole(req, ['superadmin']);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const b = await req.json().catch(() => ({}));
  const id = String(b.id || '');
  if (!id) return NextResponse.json({ ok: false, error: 'id requis' }, { status: 400 });

  // On ne met à jour que ce qui est fourni : désactiver une règle ne doit pas
  // effacer son texte, et corriger un texte ne doit pas la réactiver au passage.
  const maj: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: await quiEcrit(auth.userId) };
  if (typeof b.titre === 'string') maj.titre = b.titre.trim();
  if (typeof b.regle === 'string') maj.regle = b.regle.trim();
  if (typeof b.origine === 'string') maj.origine = b.origine.trim() || null;
  if (typeof b.actif === 'boolean') maj.actif = b.actif;
  if (['redaction', 'agent', 'les_deux'].includes(b.portee)) maj.portee = b.portee;
  if (b.hotel_key === null || b.hotel_key === 'voiles' || b.hotel_key === 'corniche') maj.hotel_key = b.hotel_key;

  const { data, error } = await supabaseAdmin
    .from('junior_regles').update(maj).eq('id', id).select(CHAMPS).single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, regle: data });
}

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { addRandomPasscode, getHotelLocksMap } from '@/lib/tthotel';
import { parseTime, tomorrowAtLocalTime } from '@/lib/checkout';

// POST /api/serrures/sejours
// Body: {
//   chambre_ids: uuid[],   // 1 ou plusieurs chambres
//   methode: 'code' | 'carte',
//   nuits: number,          // entier ≥ 1, défaut 1
//   nb_cartes?: number,     // requis si methode='carte', défaut 1
// }
//
// Cas typiques:
//  - 1 chambre + 'code' + nuits=1                → 1 séjour, code aléatoire affiché
//  - 1 chambre + 'carte' + nb_cartes=2 + nuits=3 → 1 séjour, 2 jobs encodage (mêmes droits)
//  - 3 chambres + 'carte' + nb_cartes=1 + nuits=3 → 3 séjours liés, 1 job encodage avec [3 lockIds]
//                                                  (= "carte famille / pass" qui ouvre les 3)
//  - 3 chambres + 'code' → refusé (un code TTHotel n'est lié qu'à 1 serrure)

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON invalide' }, { status: 400 });
  }

  const {
    chambre_ids,
    methode,
    nuits: nuitsRaw,
    nb_cartes: nbCartesRaw,
    checkout_hour: checkoutHourRaw,
    checkout_min: checkoutMinRaw,
  } = body as {
    chambre_ids?: string[];
    methode?: 'code' | 'carte';
    nuits?: number;
    nb_cartes?: number;
    checkout_hour?: number;
    checkout_min?: number;
  };

  if (!Array.isArray(chambre_ids) || chambre_ids.length === 0) {
    return NextResponse.json({ ok: false, error: 'chambre_ids non vide requis' }, { status: 400 });
  }
  if (!methode || !['code', 'carte'].includes(methode)) {
    return NextResponse.json({ ok: false, error: 'methode requise (code|carte)' }, { status: 400 });
  }
  if (methode === 'code' && chambre_ids.length > 1) {
    return NextResponse.json(
      { ok: false, error: 'Un code ne peut être lié qu’à une seule chambre' },
      { status: 400 },
    );
  }

  const nuits = Math.max(1, Math.min(30, Math.floor(nuitsRaw ?? 1)));
  const nbCartes = Math.max(1, Math.min(10, Math.floor(nbCartesRaw ?? 1)));

  // Charge les chambres et l'hôtel (on assume qu'elles sont du même hôtel)
  const { data: chambres, error: eC } = await supabaseAdmin
    .from('chambres')
    .select('id, hotel_id, numero, tthotel_lock_id, hotels(default_checkout_time)')
    .in('id', chambre_ids);
  if (eC || !chambres || chambres.length === 0) {
    return NextResponse.json({ ok: false, error: eC?.message ?? 'chambres introuvables' }, { status: 404 });
  }
  if (chambres.length !== chambre_ids.length) {
    return NextResponse.json({ ok: false, error: 'certaines chambres introuvables' }, { status: 404 });
  }
  const hotelIds = new Set(chambres.map((c) => c.hotel_id));
  if (hotelIds.size > 1) {
    return NextResponse.json(
      { ok: false, error: 'Les chambres doivent appartenir au même hôtel' },
      { status: 400 },
    );
  }
  const hotelId = chambres[0].hotel_id;

  // Vérifie qu'aucune chambre n'a déjà un séjour actif/pending
  const { data: existants } = await supabaseAdmin
    .from('sejours')
    .select('chambre_id')
    .in('chambre_id', chambre_ids)
    .in('statut', ['actif', 'pending']);
  if (existants && existants.length > 0) {
    const chambresOccupees = new Set(existants.map((e) => e.chambre_id));
    return NextResponse.json(
      { ok: false, error: `${chambresOccupees.size} chambre(s) déjà occupée(s)` },
      { status: 409 },
    );
  }

  // Calcule debut/fin. checkout_hour/min override l'heure par défaut de l'hôtel.
  const hotelCheckout = (chambres[0] as unknown as { hotels: { default_checkout_time: string | null } }).hotels
    ?.default_checkout_time;
  const { hh: defaultHh, mm: defaultMm } = parseTime(hotelCheckout ?? '11:00');
  const hh =
    checkoutHourRaw !== undefined && Number.isFinite(checkoutHourRaw)
      ? Math.max(0, Math.min(23, Math.floor(checkoutHourRaw)))
      : defaultHh;
  const mm =
    checkoutMinRaw !== undefined && Number.isFinite(checkoutMinRaw)
      ? Math.max(0, Math.min(59, Math.floor(checkoutMinRaw)))
      : defaultMm;
  const debut = new Date();
  const fin = tomorrowAtLocalTime(hh, mm, undefined, nuits);

  // ─── Branche 'code' ───────────────────────────────────────────────────────
  if (methode === 'code') {
    const chambre = chambres[0]; // garanti taille 1 par la check ci-dessus
    let passcode: { keyboardPwdId: number; keyboardPwd: string };
    try {
      passcode = await addRandomPasscode(
        chambre.tthotel_lock_id,
        debut.getTime(),
        fin.getTime(),
        `Chambre ${chambre.numero}`,
      );
    } catch (err) {
      return NextResponse.json(
        { ok: false, error: err instanceof Error ? err.message : String(err) },
        { status: 502 },
      );
    }

    const { data: sejour, error: eS } = await supabaseAdmin
      .from('sejours')
      .insert({
        chambre_id: chambre.id,
        debut: debut.toISOString(),
        fin: fin.toISOString(),
        methode: 'code',
        code: passcode.keyboardPwd,
        tthotel_passcode_id: passcode.keyboardPwdId,
        statut: 'actif',
      })
      .select()
      .single();
    if (eS) return NextResponse.json({ ok: false, error: eS.message }, { status: 500 });
    return NextResponse.json({ ok: true, sejours: [sejour], jobs: [] });
  }

  // ─── Branche 'carte' ──────────────────────────────────────────────────────
  // 1) Crée N séjours (1 par chambre), liés entre eux par parent_sejour_id
  const sejoursToInsert = chambres.map((c, i) => ({
    chambre_id: c.id,
    debut: debut.toISOString(),
    fin: fin.toISOString(),
    methode: 'carte' as const,
    statut: 'pending' as const,
    parent_sejour_id: null as string | null, // patché juste après
    // on garde le premier sejour comme "racine", les autres pointeront vers lui
    _rank: i,
  }));
  // On insère le premier seul pour avoir son id, puis les autres avec parent_sejour_id
  const head = sejoursToInsert[0];
  const { data: headSejour, error: eHead } = await supabaseAdmin
    .from('sejours')
    .insert({
      chambre_id: head.chambre_id,
      debut: head.debut,
      fin: head.fin,
      methode: head.methode,
      statut: head.statut,
    })
    .select()
    .single();
  if (eHead || !headSejour) {
    return NextResponse.json({ ok: false, error: eHead?.message ?? 'insert sejour' }, { status: 500 });
  }
  let sejours = [headSejour];
  if (sejoursToInsert.length > 1) {
    const rest = sejoursToInsert.slice(1).map((s) => ({
      chambre_id: s.chambre_id,
      debut: s.debut,
      fin: s.fin,
      methode: s.methode,
      statut: s.statut,
      parent_sejour_id: headSejour.id,
    }));
    const { data: restRows, error: eRest } = await supabaseAdmin.from('sejours').insert(rest).select();
    if (eRest || !restRows) {
      return NextResponse.json({ ok: false, error: eRest?.message ?? 'insert sejours' }, { status: 500 });
    }
    sejours = [headSejour, ...restRows];
  }

  // 2) Récupère les infos d'hôtel (mac, building, floor) pour chaque serrure.
  //    L'agent encodeur en a besoin pour appeler CE_WriteCard du DLL.
  let locksMeta: Array<{ lockId: number; mac: string; buildNo: number; floorNo: number }> = [];
  try {
    const map = await getHotelLocksMap();
    locksMeta = chambres.map((c) => {
      const info = map.get(c.tthotel_lock_id);
      if (!info || info.buildingNumber === undefined || info.floorNumber === undefined || !info.lockMac) {
        throw new Error(`Infos hôtel manquantes pour lockId ${c.tthotel_lock_id} (${c.numero})`);
      }
      return {
        lockId: c.tthotel_lock_id,
        mac: info.lockMac,
        buildNo: info.buildingNumber,
        floorNo: info.floorNumber,
      };
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }

  const lockIds = locksMeta.map((l) => l.lockId);
  const sejourIds = sejours.map((s) => s.id);
  const jobRows = Array.from({ length: nbCartes }).map((_, idx) => ({
    hotel_id: hotelId,
    sejour_id: headSejour.id,
    action: 'write_card' as const,
    statut: 'queued' as const,
    payload: {
      lockIds,
      locks: locksMeta, // ← l'agent utilise ce tableau pour CE_WriteCard
      sejourIds,
      debut: debut.toISOString(),
      fin: fin.toISOString(),
      carte_index: idx + 1,
      total_cartes: nbCartes,
    },
  }));
  const { data: jobs, error: eJ } = await supabaseAdmin
    .from('jobs_encodeur')
    .insert(jobRows)
    .select();
  if (eJ) return NextResponse.json({ ok: false, error: eJ.message }, { status: 500 });

  return NextResponse.json({ ok: true, sejours, jobs });
}

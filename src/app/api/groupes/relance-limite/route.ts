import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { senderFor } from '@/lib/stripe';

// Cron d'échéance « Groupes & mariages » : quand la date limite d'inscription d'un
// groupe est atteinte, on prévient l'équipe de CHAQUE hôtel concerné par le bloc
// pour qu'elle relâche l'option (allotement) dans le PMS — les chambres du bloc
// restées NON réservées repartent à la vente.
//
// Pourquoi un mail et pas un appel PMS : côté Mews l'objet « bloc d'option »
// (resourceBlocks) est en scope fermé (401), et La Corniche (Hotsoft) n'a aucune
// API. La libération reste donc un geste humain, déclenché par ce mail.
//
// Anti-doublon : `groupes.alerte_limite_envoyee_at` (migration 59) — un seul envoi
// par groupe. Auth : header `x-cron-secret` (repli `x-mews-poll-secret`).

export const dynamic = 'force-dynamic';

// Destinataire de l'équipe par hôtel, par ordre de priorité :
//   1. hotels.email_equipe (source unique, éditable en base)
//   2. TEAM_EMAIL_VOILES / TEAM_EMAIL_CORNICHE (repli par hôtel)
//   3. GROUPES_ALERT_EMAIL / ALERT_EMAIL (repli partagé)
// Si rien ne se résout → null : on N'envoie PAS (mieux vaut une alerte
// non partie et retentée qu'un mail interne dans une boîte au hasard).
function teamEmailFor(hotelNom: string, emailEquipe: string | null): string | null {
  if (emailEquipe) return emailEquipe;
  const n = (hotelNom || '').toLowerCase();
  const perHotel = n.includes('voiles')
    ? process.env.TEAM_EMAIL_VOILES
    : n.includes('corniche')
      ? process.env.TEAM_EMAIL_CORNICHE
      : undefined;
  return perHotel || process.env.GROUPES_ALERT_EMAIL || process.env.ALERT_EMAIL || null;
}

function parisToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function fmt(d: string): string {
  try {
    return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
      .format(new Date(d + 'T00:00:00'));
  } catch { return d; }
}

type Chambre = {
  id: string;
  hotel_id: string;
  tarif_nuit: number | null;
  chambre_id: string;
};
type Resa = { groupe_chambre_id: string; statut: string };
type Groupe = {
  id: string;
  nom: string;
  date_arrivee: string;
  date_depart: string;
  date_limite: string;
  contact_nom: string | null;
  groupe_chambres: Chambre[];
  groupe_reservations: Resa[];
};

export async function POST(req: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET || process.env.MEWS_POLL_SECRET;
    const provided = req.headers.get('x-cron-secret') || req.headers.get('x-mews-poll-secret');
    if (!secret || provided !== secret) {
      return NextResponse.json({ ok: false, error: 'Non autorisé' }, { status: 401 });
    }

    const today = parisToday();

    // Groupes actifs dont la date limite est atteinte, événement pas encore terminé,
    // et mail pas encore envoyé.
    const { data, error } = await supabaseAdmin
      .from('groupes')
      .select(
        'id, nom, date_arrivee, date_depart, date_limite, contact_nom,' +
        ' groupe_chambres(id, hotel_id, tarif_nuit, chambre_id),' +
        ' groupe_reservations(groupe_chambre_id, statut)',
      )
      .eq('statut', 'actif')
      .lte('date_limite', today)
      .gte('date_depart', today)
      .is('alerte_limite_envoyee_at', null);

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    const groupes = (data || []) as unknown as Groupe[];
    if (!groupes.length) return NextResponse.json({ ok: true, groupes: 0, mails: 0 });

    // Noms d'hôtels (pour le routage du destinataire + l'affichage).
    const hotelIds = [...new Set(groupes.flatMap(g => (g.groupe_chambres || []).map(c => c.hotel_id)))];
    const { data: hotelsData } = await supabaseAdmin.from('hotels').select('id, nom, email_equipe').in('id', hotelIds);
    const hotelRow = (id: string) => (hotelsData || []).find(h => h.id === id);
    const hotelName = (id: string) => hotelRow(id)?.nom || 'Hôtel';

    // Numéros de chambre (room_units) — chargés à part pour ne pas dépendre d'un embed.
    const chambreIds = [...new Set(groupes.flatMap(g => (g.groupe_chambres || []).map(c => c.chambre_id)))];
    const { data: unitsData } = await supabaseAdmin.from('room_units').select('id, numero').in('id', chambreIds);
    const numeroOf = (chambreId: string) => (unitsData || []).find(u => u.id === chambreId)?.numero || '—';

    const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

    let mails = 0;
    const treated: string[] = [];

    for (const g of groupes) {
      // Chambres du bloc SANS réservation confirmée = à relâcher.
      const reservedChambreIds = new Set(
        (g.groupe_reservations || []).filter(r => r.statut === 'confirmee').map(r => r.groupe_chambre_id),
      );
      const aRelacher = (g.groupe_chambres || []).filter(c => !reservedChambreIds.has(c.id));

      // Regroupe les chambres à relâcher par hôtel (un mail par hôtel du bloc).
      const parHotel = new Map<string, Chambre[]>();
      for (const c of g.groupe_chambres || []) {
        if (!parHotel.has(c.hotel_id)) parHotel.set(c.hotel_id, []);
      }
      for (const c of aRelacher) parHotel.get(c.hotel_id)!.push(c);

      let allSent = true;
      for (const [hid, chambres] of parHotel.entries()) {
        const nom = hotelName(hid);
        const to = teamEmailFor(nom, hotelRow(hid)?.email_equipe ?? null);
        if (!to) {
          allSent = false;
          console.error('relance-limite: aucune adresse équipe pour', g.id, hid, nom);
          continue;
        }
        const numeros = chambres
          .map(c => numeroOf(c.chambre_id))
          .filter(n => n && n !== '—')
          .sort((a, b) => String(a).localeCompare(String(b), 'fr', { numeric: true }));

        const listeHtml = numeros.length
          ? `<p style="margin:0 0 6px"><strong>${numeros.length} chambre(s) à relâcher</strong> dans le PMS :</p>
             <p style="margin:0 0 16px;font-size:16px;color:#e11d48;font-weight:700">${numeros.join(' · ')}</p>`
          : `<p style="margin:0 0 16px;color:#059669;font-weight:600">✅ Toutes les chambres du bloc ont été réservées — rien à relâcher, tu peux clôturer le bloc.</p>`;

        const html = `
          <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">
            <div style="background:#e11d48;color:#fff;padding:14px 18px;border-radius:12px 12px 0 0">
              <div style="font-size:13px;opacity:.9">${nom} — Groupes &amp; mariages</div>
              <div style="font-size:18px;font-weight:800">Date limite atteinte — libérer l'option</div>
            </div>
            <div style="border:1px solid #fecdd3;border-top:none;border-radius:0 0 12px 12px;padding:18px">
              <p style="margin:0 0 10px">La date limite d'inscription du groupe <strong>« ${g.nom} »</strong> est atteinte
                (limite : <strong>${fmt(g.date_limite)}</strong>).</p>
              <p style="margin:0 0 16px;color:#475569">Séjour : ${fmt(g.date_arrivee)} → ${fmt(g.date_depart)}${g.contact_nom ? ` · Contact : ${g.contact_nom}` : ''}</p>
              ${listeHtml}
              <p style="margin:0;font-size:12px;color:#94a3b8">Message automatique — pense à retirer l'allotement restant dans le PMS.</p>
            </div>
          </div>`;

        if (!resend) { allSent = false; continue; }
        const { error: mailErr } = await resend.emails.send({
          from: senderFor(hid),
          to,
          subject: `⏰ ${nom} — libérer l'option « ${g.nom} » (date limite atteinte)`,
          html,
        });
        if (mailErr) { allSent = false; console.error('relance-limite mail', g.id, hid, mailErr); }
        else mails++;
      }

      // On ne marque « envoyé » que si tous les mails du groupe sont partis
      // (sinon on retentera au prochain passage plutôt que d'oublier l'alerte).
      if (allSent) treated.push(g.id);
    }

    if (treated.length) {
      await supabaseAdmin
        .from('groupes')
        .update({ alerte_limite_envoyee_at: new Date().toISOString() })
        .in('id', treated);
    }

    return NextResponse.json({ ok: true, groupes: groupes.length, traites: treated.length, mails });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

// GET = même traitement (pratique pour un déclenchement manuel/cron simple).
export async function GET(req: NextRequest) {
  return POST(req);
}

import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { dutyWindow, SHIFT_MARGIN_MIN, type PlanningEntryLite } from '@/lib/shift';

// « Qui tient la réception en ce moment ? » — pour appeler la personne par son prénom au lieu
// d'un « Bonjour » anonyme (Martin 2026-07-10 : « tu t'adresses toujours pas à la personne en
// shift »). Les réponses CLIENT sont signées par cette personne ; les récaps INTERNES restent
// signés « Junior », mais leur salutation s'adresse à elle (cf reference_signature_htbm).

// Les postes qui tiennent le desk. « Night » est bien de la réception (réception de nuit).
const RECEPTION_SHIFTS = ['Réception matin', 'Réception soir', 'Night'];

export type OnDuty = { name: string; shift: string };

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function receptionOnDuty(hotelId: string, at: Date = new Date()): Promise<OnDuty | null> {
  const veille = new Date(at.getTime() - 86_400_000);

  // La veille est nécessaire : un shift Night commencé hier couvre encore l'instant présent.
  const { data } = await supabaseAdmin
    .from('planning_entries')
    .select('date, shift, start_time, end_time, user_id')
    .eq('hotel_id', hotelId)
    .eq('status', 'published')            // le brouillon de planning ne fait pas foi
    .in('date', [ymd(veille), ymd(at)])
    .in('shift', RECEPTION_SHIFTS);

  const entries = (data || []) as (PlanningEntryLite & { user_id: string })[];

  // 1) Quelqu'un est-il VRAIMENT au desk (sans marge) ? C'est le cas nominal.
  let pick = entries.find((e) => {
    const w = dutyWindow(e, 0);
    return w && at >= w.start && at <= w.end;
  });

  // 2) Sinon (creux entre deux shifts), on retient la marge de 2 h et on prend le shift qui
  //    COMMENCE le plus tard : entre celui qui vient de finir et celui qui va prendre le poste,
  //    c'est le second qui lira le mail.
  if (!pick) {
    const proches = entries
      .filter((e) => {
        const w = dutyWindow(e, SHIFT_MARGIN_MIN);
        return w && at >= w.start && at <= w.end;
      })
      .sort((a, b) => (dutyWindow(a, 0)!.start.getTime() - dutyWindow(b, 0)!.start.getTime()));
    pick = proches[proches.length - 1];
  }
  if (!pick) return null;

  const { data: u } = await supabaseAdmin
    .from('users')
    .select('name, active')
    .eq('id_auth', pick.user_id)
    .maybeSingle();

  // `users.name` porte le prénom (pas de colonne prenom/nom séparée).
  if (!u?.name || u.active === false) return null;
  return { name: u.name, shift: pick.shift || '' };
}

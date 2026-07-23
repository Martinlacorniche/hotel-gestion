import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { listInbox, listAttachmentNames } from '@/lib/graphMailbox';
import { classifyMail, hotelConfig } from '@/lib/mailAssistant';

// Logique du tri DRY-RUN, partagée entre le cron (secret) et l'API journal (superadmin).
// Scopé à UN hôtel : lit sa boîte, classe, journalise dans `assistant_mail_log`.
// Ne supprime/n'envoie RIEN (Phase 1). Mews (déjà venu/tarif) réservé à Voiles (cfg.mews).

export type DryRunResult = {
  hotel: string;
  mailbox: string;
  mews: boolean;
  logged: number;
  reconciled: number;
  summary: Record<string, number>;
};

export async function runDryRun(hotelKey: string): Promise<DryRunResult> {
  const cfg = hotelConfig(hotelKey);
  if (!cfg) throw new Error(`hotel invalide: ${hotelKey}`);

  const messages = await listInbox(cfg.mailbox, 30);

  // Réconciliation : le journal doit refléter la boîte ACTUELLE. On retire les
  // lignes dont le mail n'est plus dans l'inbox (classé/supprimé/déplacé entre-temps),
  // sinon le journal reste figé sur un état périmé.
  const currentIds = new Set(messages.map((m) => m.id));
  const { data: existing } = await supabaseAdmin
    .from('assistant_mail_log')
    .select('message_id')
    .eq('mailbox', cfg.mailbox);
  const stale = (existing ?? []).map((r) => r.message_id as string).filter((id) => !currentIds.has(id));
  if (stale.length) {
    await supabaseAdmin.from('assistant_mail_log').delete().eq('mailbox', cfg.mailbox).in('message_id', stale);
  }

  const summary: Record<string, number> = {};
  let logged = 0;

  for (const m of messages) {
    const attachmentNames = m.hasAttachments ? await listAttachmentNames(cfg.mailbox, m.id).catch(() => []) : [];
    const c = classifyMail({
      fromAddr: m.fromAddr, fromName: m.fromName, subject: m.subject,
      preview: m.preview, hasAttachments: m.hasAttachments, attachmentNames,
    });
    const mewsEnrich = cfg.mews && (c.category === 'resa_ota' || c.category === 'resa_swile');
    summary[c.category] = (summary[c.category] || 0) + 1;

    const { data: ins, error } = await supabaseAdmin
      .from('assistant_mail_log')
      .upsert({
        mailbox: cfg.mailbox,
        message_id: m.id,
        from_addr: m.fromAddr,
        from_name: m.fromName,
        subject: m.subject,
        received_at: m.received || null,
        category: c.category,
        proposed_action: c.action,
        reason: c.reason,
        detail: { ...c.detail, attachmentNames, hotel: cfg.key, mewsEnrich },
        status: 'proposed',
        dry_run: true,
      }, { onConflict: 'mailbox,message_id', ignoreDuplicates: true })
      .select('id');
    // ⚠️ `ignoreDuplicates` n'est PAS une erreur : un mail déjà journalisé passe
    // silencieusement. Compter « pas d'erreur » revenait donc à compter les mails
    // VUS, pas les nouveaux — l'écran annonçait « 1 mail classé » sans qu'aucune
    // ligne n'apparaisse. Seules les lignes réellement insérées comptent.
    if (!error && ins?.length) logged += ins.length;

    // 🔁 RECLASSEMENT DES LIGNES EN ATTENTE. `ignoreDuplicates` protège les lignes
    // déjà décidées, mais il figeait AUSSI le verdict des lignes encore en attente :
    // corriger une règle ne changeait rien à l'écran tant qu'on n'avait pas supprimé
    // la ligne à la main. Or c'est précisément quand une règle vient d'être corrigée
    // qu'on veut voir le nouveau verdict. On ne touche QUE le statut `proposed` :
    // une ligne validée ou ignorée garde sa trace, c'est de l'historique.
    if (!ins?.length) {
      await supabaseAdmin
        .from('assistant_mail_log')
        .update({
          category: c.category, proposed_action: c.action, reason: c.reason,
          detail: { ...c.detail, attachmentNames, hotel: cfg.key, mewsEnrich },
        })
        .eq('mailbox', cfg.mailbox).eq('message_id', m.id).eq('status', 'proposed');
    }
  }

  return { hotel: cfg.key, mailbox: cfg.mailbox, mews: cfg.mews, logged, reconciled: stale.length, summary };
}

import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { listInbox, listAttachmentNames, getMessageText } from '@/lib/graphMailbox';
import { classifyMail, hotelConfig, type HotelMailConfig } from '@/lib/mailAssistant';
import { classifyWithLlm, recentCorrections } from '@/lib/mailClassifierLlm';
import { executeRow, getModes, type LogRow, type ExecOutcome } from '@/lib/mailActions';

// Logique du tri DRY-RUN, partagée entre le cron (secret) et l'API journal (superadmin).
// Scopé à UN hôtel : lit sa boîte, classe, journalise dans `assistant_mail_log`.
// Ne supprime/n'envoie RIEN (Phase 1). Mews (déjà venu/tarif) réservé à Voiles (cfg.mews).

export type DryRunResult = {
  hotel: string;
  mailbox: string;
  mews: boolean;
  logged: number;
  reconciled: number;
  /** Mails relus par le classifieur faute de règle sûre (le reste est gratuit). */
  relus: number;
  /** Actions exécutées sans clic, sur les familles passées en « Je fais seul ». */
  autonomes: number;
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
  let relus = 0;

  // Les corrections de l'équipe sont chargées UNE fois pour tout le run : elles
  // sont identiques pour tous les mails, et c'est ce qui permet au classifieur
  // d'apprendre sans repasser par une session avec moi.
  const corrections = await recentCorrections().catch(() => '');

  for (const m of messages) {
    const attachmentNames = m.hasAttachments ? await listAttachmentNames(cfg.mailbox, m.id).catch(() => []) : [];
    let c = classifyMail({
      fromAddr: m.fromAddr, fromName: m.fromName, subject: m.subject,
      preview: m.preview, hasAttachments: m.hasAttachments, attachmentNames,
    });

    // 🆕 ARBITRAGE PAR LECTURE (2026-07-24). Une règle SÛRE (canal reconnu à son
    // expéditeur technique) tranche seule : elle est fiable et gratuite. Une règle
    // FAIBLE (un mot dans le sujet) ou l'absence de règle passe la main au
    // classifieur, qui lit le mail EN ENTIER — et non les ~255 caractères du
    // `bodyPreview` de Graph, dont la troncature est la cause de la moitié des
    // ratés (le lien de désinscription et le type d'événement des demandes BW
    // sont toujours plus bas).
    if (c.weak) {
      const body = await getMessageText(cfg.mailbox, m.id).catch(() => m.preview || '');
      const verdict = await classifyWithLlm({
        hotelName: cfg.nom, fromAddr: m.fromAddr, fromName: m.fromName,
        subject: m.subject, body, attachmentNames, receivedAt: m.received,
        hint: c,
      }, corrections);
      if (verdict) { c = verdict; relus++; }
    }

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

  const autonomes = await executerLesAutonomes(cfg);

  return { hotel: cfg.key, mailbox: cfg.mailbox, mews: cfg.mews, logged, reconciled: stale.length, relus, autonomes, summary };
}

// ── « Je fais seul » ────────────────────────────────────────────────────────
//
// Le réglage par famille (`assistant_mail_config`) existait, l'écran l'affichait,
// Martin l'avait posé sur 4 familles le 23/07… et RIEN NE L'EXÉCUTAIT :
// `executeRow` n'était appelé que par le bouton « Valider » et par une correction.
// Une famille en autonomie attendait donc un clic exactement comme les autres —
// l'écran promettait ce que le code ne faisait pas (« pourquoi il n'a pas traité
// le spam ? », Martin 2026-07-24). C'est ce que ces lignes réparent.
//
// Le tri s'appelle encore « dry run » pour des raisons d'histoire, mais une
// famille passée en autonomie est une décision explicite de Martin : à partir de
// là, ses mails sont VRAIMENT traités (un `delete` supprime pour de bon).
// Les familles restées en « Je te demande » ne bougent pas d'un pouce.
async function executerLesAutonomes(cfg: HotelMailConfig): Promise<number> {
  const modes = await getModes(cfg.key);
  const auto = Object.entries(modes).filter(([, m]) => m === 'auto').map(([c]) => c);
  if (!auto.length) return 0;

  const { data: lignes } = await supabaseAdmin
    .from('assistant_mail_log')
    .select('id, mailbox, message_id, from_addr, from_name, subject, category, proposed_action, detail, status')
    .eq('mailbox', cfg.mailbox)
    .eq('status', 'proposed')
    .in('category', auto);
  if (!lignes?.length) return 0;

  let faits = 0;
  for (const ligne of lignes) {
    const stamp = { decided_at: new Date().toISOString(), processed_at: new Date().toISOString() };
    const outcome = await executeRow(cfg, ligne as LogRow).catch(
      (e): ExecOutcome => ({ status: 'blocked', error: e instanceof Error ? e.message : 'erreur inattendue' }),
    );

    // Une action qui bute reste EN ATTENTE, avec son motif : c'est précisément le
    // cas où un humain doit regarder (résa absente de l'app, dossier introuvable…).
    if (outcome.status === 'blocked') {
      await supabaseAdmin.from('assistant_mail_log')
        .update({ action_error: outcome.error || 'action non exécutée', ...stamp })
        .eq('id', ligne.id);
      continue;
    }

    // `decided_by` reste nul : personne n'a cliqué. `result.auto` le dit en clair
    // pour qu'on distingue, dans l'historique, ce que Junior a fait tout seul.
    await supabaseAdmin.from('assistant_mail_log')
      .update({ status: 'executed', dry_run: false, result: { ...(outcome.result || {}), auto: true }, action_error: null, ...stamp })
      .eq('id', ligne.id);
    faits++;
  }
  return faits;
}

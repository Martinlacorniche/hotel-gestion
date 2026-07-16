// Client Microsoft Graph MULTI-BOÎTE (gestionnaire de mails Voiles + Corniche).
// `graphMail.ts` est câblé sur une seule boîte (GRAPH_MAILBOX) ; ici la boîte est un
// paramètre, pour traiter contact-lesvoiles@ ET contact-corniche@ avec le même token.
// Secrets partagés : GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET.

const GRAPH = 'https://graph.microsoft.com/v1.0';

function creds() {
  const t = process.env.GRAPH_TENANT_ID;
  const c = process.env.GRAPH_CLIENT_ID;
  const s = process.env.GRAPH_CLIENT_SECRET;
  if (!t || !c || !s) throw new Error('GRAPH_TENANT_ID/CLIENT_ID/CLIENT_SECRET manquants en environnement');
  return { t, c, s };
}

let cachedToken: { value: string; exp: number } | null = null;
async function token(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.exp) return cachedToken.value;
  const { t, c, s } = creds();
  const body = new URLSearchParams({
    client_id: c, client_secret: s, grant_type: 'client_credentials',
    scope: 'https://graph.microsoft.com/.default',
  });
  const res = await fetch(`https://login.microsoftonline.com/${t}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`Graph token ${res.status}: ${j.error_description || ''}`);
  cachedToken = { value: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 };
  return cachedToken.value;
}

async function gm<T>(mailbox: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${GRAPH}/users/${encodeURIComponent(mailbox)}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  if (res.status === 204 || res.status === 202) return {} as T;
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Graph ${mailbox}${path} ${res.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return j as T;
}

export type InboxMessage = {
  id: string;
  fromAddr: string;
  fromName: string;
  subject: string;
  preview: string;
  received: string;
  isRead: boolean;
  hasAttachments: boolean;
};

export async function listInbox(mailbox: string, top = 30): Promise<InboxMessage[]> {
  const j = await gm<{ value: Record<string, unknown>[] }>(
    mailbox,
    `/mailFolders/inbox/messages?$top=${top}&$orderby=receivedDateTime desc` +
    `&$select=id,subject,from,receivedDateTime,isRead,bodyPreview,hasAttachments`,
  );
  return (j.value || []).map((m) => {
    const ea = (m.from as { emailAddress?: { address?: string; name?: string } })?.emailAddress;
    return {
      id: String(m.id),
      fromAddr: ea?.address || '',
      fromName: ea?.name || '',
      subject: String(m.subject || '(sans objet)'),
      preview: String(m.bodyPreview || '').replace(/\s+/g, ' ').slice(0, 400),
      received: String(m.receivedDateTime || ''),
      isRead: !!m.isRead,
      hasAttachments: !!m.hasAttachments,
    };
  });
}

// Cherche dans TOUTE la boîte (inbox, archive, dossiers de rangement) — pas seulement
// l'inbox. Sert à retrouver le mail de RÉSERVATION INITIALE depuis une annulation : le
// délai d'annulation n'est jamais dans le mail d'annulation (D-Edge écrit « Voir
// conditions d'annulation Booking.com »), mais il est dans la résa d'origine.
// ⚠️ `$search` interdit `$orderby` chez Graph → on trie côté client.
export async function searchMessages(mailbox: string, query: string, top = 10): Promise<InboxMessage[]> {
  const j = await gm<{ value: Record<string, unknown>[] }>(
    mailbox,
    `/messages?$search=${encodeURIComponent(`"${query}"`)}&$top=${top}` +
    `&$select=id,subject,from,receivedDateTime,isRead,bodyPreview,hasAttachments`,
  );
  return (j.value || []).map((m) => {
    const ea = (m.from as { emailAddress?: { address?: string; name?: string } })?.emailAddress;
    return {
      id: String(m.id),
      fromAddr: ea?.address || '',
      fromName: ea?.name || '',
      subject: String(m.subject || ''),
      preview: String(m.bodyPreview || ''),
      received: String(m.receivedDateTime || ''),
      isRead: !!m.isRead,
      hasAttachments: !!m.hasAttachments,
    };
  }).sort((a, b) => b.received.localeCompare(a.received));
}

export async function listAttachmentNames(mailbox: string, id: string): Promise<string[]> {
  const j = await gm<{ value: { name?: string }[] }>(
    mailbox, `/messages/${id}/attachments?$select=name,size`,
  );
  return (j.value || []).map((a) => a.name || '').filter(Boolean);
}

// Corps du mail en TEXTE (balises retirées), pour parsing D-Edge / lecture LLM.
export async function getMessageText(mailbox: string, id: string): Promise<string> {
  const m = await gm<{ body?: { content?: string } }>(mailbox, `/messages/${id}?$select=body`);
  const raw = m.body?.content || '';
  return raw
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
}

// HTML BRUT du corps (getMessageText efface les balises → perd les href). Nécessaire quand on
// doit récupérer un LIEN dans le mail (ex. bouton « confirmer la réception » CDS).
export async function getMessageHtml(mailbox: string, id: string): Promise<string> {
  const m = await gm<{ body?: { content?: string } }>(mailbox, `/messages/${id}?$select=body`);
  return m.body?.content || '';
}

// Déplacer un mail : destination = dossier bien connu ('deleteditems','archive','junkemail') ou id de dossier.
export async function moveMessage(mailbox: string, id: string, destination: string): Promise<void> {
  await gm(mailbox, `/messages/${id}/move`, { method: 'POST', body: JSON.stringify({ destinationId: destination }) });
}

// Suppression DÉFINITIVE (ne passe pas par les Éléments supprimés → libère vraiment le stockage).
// Réservé à la purge indésirables/corbeille : irréversible, jamais sur la boîte de réception.
export async function permanentDeleteMessage(mailbox: string, id: string): Promise<void> {
  await gm(mailbox, `/messages/${id}/permanentDelete`, { method: 'POST' });
}

// Idem, mais par paquets de 20 via le endpoint $batch de Graph : une purge de plusieurs milliers
// de mails ferait autant d'allers-retours HTTP et dépasserait le timeout de la route Netlify.
// Renvoie les ids qui ont ÉCHOUÉ (l'appelant les mémorise pour ne pas boucler dessus).
export const GRAPH_BATCH_MAX = 20;

export async function permanentDeleteBatch(mailbox: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const failed: string[] = [];

  for (let i = 0; i < ids.length; i += GRAPH_BATCH_MAX) {
    const chunk = ids.slice(i, i + GRAPH_BATCH_MAX);
    const res = await fetch(`${GRAPH}/$batch`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: chunk.map((id, n) => ({
          id: String(n),
          method: 'POST',
          url: `/users/${encodeURIComponent(mailbox)}/messages/${id}/permanentDelete`,
        })),
      }),
    });
    if (!res.ok) { failed.push(...chunk); continue; }   // batch entier KO
    const j = (await res.json()) as { responses?: { id: string; status: number }[] };
    // $batch renvoie 200 même si des sous-requêtes échouent : c'est leur `status` qui compte.
    for (const r of j.responses || []) {
      if (r.status >= 300) failed.push(chunk[Number(r.id)]);
    }
  }
  return failed;
}

// Ids + date des messages d'un dossier reçus AVANT `beforeIso`. On ne sélectionne QUE l'id et la
// date : ni sujet, ni expéditeur, ni corps — la purge des indésirables ne doit rien lire.
export async function listFolderIdsBefore(
  mailbox: string, folder: string, beforeIso: string, top = 50,
): Promise<{ id: string; received: string }[]> {
  const j = await gm<{ value: Record<string, unknown>[] }>(
    mailbox,
    `/mailFolders/${folder}/messages?$top=${top}&$select=id,receivedDateTime` +
    `&$filter=receivedDateTime lt ${beforeIso}&$orderby=receivedDateTime asc`,
  );
  return (j.value || []).map((m) => ({ id: String(m.id), received: String(m.receivedDateTime || '') }));
}

// Id d'un dossier MAISON de la boîte de réception (« Hotsoft », « Clients »…), par son nom.
// Les dossiers bien connus ('inbox', 'archive'…) s'adressent par leur nom Graph ; les dossiers
// créés par l'équipe, eux, n'existent que sous forme d'id. Renvoie null si le dossier n'existe
// pas (ex. « Hotsoft » n'existe qu'à La Corniche) : l'appelant décide quoi en faire.
export async function findInboxFolderId(mailbox: string, displayName: string): Promise<string | null> {
  const j = await gm<{ value: { id: string; displayName: string }[] }>(
    mailbox, `/mailFolders/inbox/childFolders?$top=100&$select=id,displayName`,
  );
  const hit = (j.value || []).find((f) => f.displayName.toLowerCase() === displayName.toLowerCase());
  return hit?.id ?? null;
}

export type FileAttachment = { id: string; name: string; contentType: string; size: number; contentBytes: string };

// Pièces jointes FICHIER (avec contenu base64), pour lecture PDF / routage compta.
export async function listFileAttachments(mailbox: string, id: string): Promise<FileAttachment[]> {
  const j = await gm<{ value: Record<string, unknown>[] }>(mailbox, `/messages/${id}/attachments`);
  return (j.value || [])
    .filter((a) => a['@odata.type'] === '#microsoft.graph.fileAttachment')
    .map((a) => ({
      id: String(a.id), name: String(a.name || ''), contentType: String(a.contentType || ''),
      size: Number(a.size || 0), contentBytes: String(a.contentBytes || ''),
    }));
}

// Transférer un mail (garde les PJ) à un destinataire — ENVOI IMMÉDIAT.
export async function forwardMessage(mailbox: string, id: string, to: string, comment: string): Promise<void> {
  await gm(mailbox, `/messages/${id}/forward`, {
    method: 'POST',
    body: JSON.stringify({ comment, toRecipients: [{ emailAddress: { address: to } }] }),
  });
}

// Créer un BROUILLON de réponse (reste dans Brouillons — RIEN n'est envoyé).
// On préfixe notre texte au fil cité renvoyé par Graph. Renvoie l'id + le lien web du brouillon.
export async function createReplyDraft(
  mailbox: string, id: string, htmlPrepend: string,
): Promise<{ draftId: string; webLink: string }> {
  const draft = await gm<{ id: string; webLink?: string; body?: { content?: string } }>(
    mailbox, `/messages/${id}/createReply`, { method: 'POST' },
  );
  const quoted = draft.body?.content || '';
  await gm(mailbox, `/messages/${draft.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ body: { contentType: 'HTML', content: `${htmlPrepend}${quoted}` } }),
  });
  return { draftId: draft.id, webLink: draft.webLink || '' };
}

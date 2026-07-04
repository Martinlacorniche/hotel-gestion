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

export async function listAttachmentNames(mailbox: string, id: string): Promise<string[]> {
  const j = await gm<{ value: { name?: string }[] }>(
    mailbox, `/messages/${id}/attachments?$select=name,size`,
  );
  return (j.value || []).map((a) => a.name || '').filter(Boolean);
}

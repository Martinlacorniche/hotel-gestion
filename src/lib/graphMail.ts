// Client Microsoft Graph — boîte mail Les Voiles (contact-lesvoiles@htbm.fr).
// App-only (client credentials). Lecture + envoi + déplacement de mails.
// Secrets: GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET / GRAPH_MAILBOX.
// ⚠️ Accès APP-ONLY non scopé pour l'instant : à restreindre à la seule boîte
// Voiles via Application Access Policy (cf. project_assistant_mails_voiles).

const GRAPH = 'https://graph.microsoft.com/v1.0';

function env() {
  const t = process.env.GRAPH_TENANT_ID;
  const c = process.env.GRAPH_CLIENT_ID;
  const s = process.env.GRAPH_CLIENT_SECRET;
  const mb = process.env.GRAPH_MAILBOX;
  if (!t || !c || !s || !mb) throw new Error('GRAPH_TENANT_ID/CLIENT_ID/CLIENT_SECRET/MAILBOX manquants en environnement');
  return { t, c, s, mb };
}

let cachedToken: { value: string; exp: number } | null = null;
async function token(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.exp) return cachedToken.value;
  const { t, c, s } = env();
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

async function g<T>(path: string, init?: RequestInit): Promise<T> {
  const { mb } = env();
  const res = await fetch(`${GRAPH}/users/${encodeURIComponent(mb)}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  if (res.status === 204 || res.status === 202) return {} as T;
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Graph ${path} ${res.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return j as T;
}

function stripHtml(raw: string): string {
  return raw.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ').trim();
}

export type MailSummary = { id: string; from: string; subject: string; received: string; isRead: boolean; preview: string };

export async function listMessages(folder = 'inbox', top = 25): Promise<MailSummary[]> {
  const j = await g<{ value: Record<string, unknown>[] }>(
    `/mailFolders/${folder}/messages?$top=${top}&$select=id,subject,from,receivedDateTime,isRead,bodyPreview`,
  );
  return (j.value || []).map((m) => ({
    id: String(m.id),
    from: (m.from as { emailAddress?: { address?: string } })?.emailAddress?.address || '?',
    subject: String(m.subject || '(sans objet)'),
    received: String(m.receivedDateTime || ''),
    isRead: !!m.isRead,
    preview: String(m.bodyPreview || '').replace(/\s+/g, ' ').slice(0, 300),
  }));
}

export async function getMessage(id: string): Promise<{ from: string; subject: string; received: string; body: string }> {
  const m = await g<Record<string, unknown>>(`/messages/${id}?$select=subject,from,receivedDateTime,body`);
  const raw = (m.body as { content?: string })?.content || '';
  return {
    from: (m.from as { emailAddress?: { address?: string } })?.emailAddress?.address || '?',
    subject: String(m.subject || ''),
    received: String(m.receivedDateTime || ''),
    body: stripHtml(raw).slice(0, 4000),
  };
}

// Renvoie le corps HTML brut converti en lignes (pour le parseur D-EDGE).
export async function getMessageLines(id: string): Promise<string[]> {
  const m = await g<Record<string, unknown>>(`/messages/${id}?$select=body`);
  const raw = (m.body as { content?: string })?.content || '';
  const txt = raw.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  return txt.split('\n').map((l) => l.trim()).filter(Boolean);
}

export async function sendMail(to: string, subject: string, html: string): Promise<void> {
  await g('/sendMail', {
    method: 'POST',
    body: JSON.stringify({
      message: { subject, body: { contentType: 'HTML', content: html }, toRecipients: [{ emailAddress: { address: to } }] },
      saveToSentItems: true,
    }),
  });
}

// destination = dossier bien connu ('deleteditems', 'archive', 'junkemail') ou un id de dossier.
export async function moveMessage(id: string, destination: string): Promise<void> {
  await g(`/messages/${id}/move`, { method: 'POST', body: JSON.stringify({ destinationId: destination }) });
}

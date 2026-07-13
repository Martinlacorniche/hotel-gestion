// Socle commun aux sondes de certification Mews (lecture et écriture).
//
// Mews ne fait pas de visio : ils relisent les logs d'appels de la démo et
// retrouvent les nôtres par le champ `Client`. Tout ce qui passe ici est donc
// une pièce du dossier de certification.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const BASE = process.env.MEWS_BASE || '';
export const CREDS = {
  ClientToken: process.env.MEWS_CLIENT_TOKEN,
  AccessToken: process.env.MEWS_ACCESS_TOKEN,
  Client: process.env.MEWS_CLIENT_NAME,
};

// Garde-fou : ces sondes écrivent. Elles ne doivent JAMAIS toucher l'hôtel réel.
export function requireDemo(script) {
  if (!/mews-demo\.com/.test(BASE)) {
    console.error(`REFUS : MEWS_BASE doit pointer la démo, reçu « ${BASE || 'vide'} ».`);
    console.error(`Lancer avec : node --env-file=.env.mews-demo scripts/mews-certif/${script}`);
    process.exit(1);
  }
  if (!CREDS.ClientToken || !CREDS.AccessToken || !CREDS.Client) {
    console.error('REFUS : MEWS_CLIENT_TOKEN / MEWS_ACCESS_TOKEN / MEWS_CLIENT_NAME manquants.');
    process.exit(1);
  }
}

export const DUMPS = join('scripts', 'mews-certif', 'dumps');

export const now = Date.now();
export const iso = (ms) => new Date(ms).toISOString();
export const days = (n) => now + n * 864e5;
// Mews veut des bornes de nuitée à midi UTC : on ancre proprement.
export const midnight = (n) => {
  const d = new Date(now + n * 864e5);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
};

export const results = [];

// Un appel + sa trace. `module` sert à regrouper dans la matrice finale, qui
// alimentera le formulaire de certification.
//
// `retries` : la démo est un environnement partagé, et Mews travaille en
// concurrence optimiste (« Someone else just changed this bill »). Un échec de
// ce type n'est pas une incapacité de l'API — on rejoue. Seule la dernière
// tentative est consignée dans la matrice.
export async function call(op, body, { module = 'divers', label = '', dump = false, retries = 0 } = {}) {
  let res, text, json;
  const t0 = Date.now();
  for (let attempt = 0; ; attempt++) {
    res = await fetch(`${BASE}/${op}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...CREDS, ...body }),
    });
    text = await res.text();
    try { json = JSON.parse(text); } catch { json = text; }
    if (res.ok || attempt >= retries) break;
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }

  const msg = res.ok ? '' : (json?.Message || String(json).slice(0, 110));
  results.push({ op, module, label, ok: res.ok, status: res.status, ms: Date.now() - t0, msg });

  if (dump) {
    await mkdir(DUMPS, { recursive: true });
    await writeFile(join(DUMPS, `${op.replace(/\//g, '.')}.json`), JSON.stringify(json, null, 2));
  }

  const tag = res.ok ? 'OK  ' : `KO ${res.status}`;
  console.log(`  ${tag}  ${op.padEnd(30)} ${label}${msg ? `  → ${msg}` : ''}`);
  await new Promise((r) => setTimeout(r, 300)); // on ne bouscule pas leur débit
  return res.ok ? json : null;
}

export function section(title) {
  console.log(`\n— ${title} —`);
}

// La matrice : spec de connecteur ET inventaire pour le formulaire de certif.
export async function writeMatrix(file, title, labels) {
  const byModule = {};
  for (const r of results) (byModule[r.module] ??= []).push(r);

  let md = `# ${title}\n\nBalayage du Connector API sur la **démo publique** (\`api.mews-demo.com\`), client \`${CREDS.Client}\`.\n\n`;
  for (const [mod, rows] of Object.entries(byModule)) {
    md += `## ${labels[mod] || mod}\n\n| Opération | Étape | Verdict | Détail |\n|---|---|---|---|\n`;
    for (const r of rows) {
      md += `| \`${r.op}\` | ${r.label || '—'} | ${r.ok ? 'OK' : `KO (${r.status})`} | ${r.msg.replace(/\|/g, '/').slice(0, 90) || '—'} |\n`;
    }
    md += '\n';
  }
  const ok = results.filter((r) => r.ok).length;
  md += `_${ok}/${results.length} appels en succès._\n`;
  await writeFile(join('docs', file), md);
  console.log(`\n${ok}/${results.length} OK → docs/${file}`);
}

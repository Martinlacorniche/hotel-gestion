// Socle commun aux sondes HotSoft (bac à sable de certification).
//
// À la différence des sondes Mews, celles-ci n'exercent QUE de la lecture :
// tant que le périmètre accordé à notre protocole n'est pas connu, on ne pose
// rien dans un PMS — fût-il de démo, il est partagé avec d'autres candidats.
//
// Les sondes importent le vrai client `src/lib/hotsoft.ts`, transpilé par
// `run.sh` dans `.build/` : ce qui est validé ici est exactement ce qui
// tournera en production, décalages horaires et pagination compris. Surtout
// pas une copie — la logique de dates est trop piégeuse pour exister en double.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { callHotsoft, isHotsoftDemo } from './.build/hotsoft.js';

// Garde-fou : même en lecture, ces sondes ne visent que le bac à sable.
export function requireDemo(script) {
  if (!isHotsoftDemo()) {
    console.error(`REFUS : HOTSOFT_BASE doit pointer le bac à sable, reçu « ${process.env.HOTSOFT_BASE || 'vide'} ».`);
    console.error(`Lancer avec : bash scripts/hotsoft-certif/run.sh ${script}`);
    process.exit(1);
  }
}

export const DUMPS = join('scripts', 'hotsoft-certif', 'dumps');
export const results = [];

/**
 * Un appel + sa trace dans la matrice de couverture.
 *
 * `count` extrait le volume renvoyé : sur cette API un appel peut réussir
 * (HTTP 200, `Response: 0`) tout en ne renvoyant rien, et « OK » sans volume
 * ne prouve pas que l'endpoint est réellement ouvert à notre protocole.
 */
export async function probe(path, body = {}, { module = 'divers', label = '', count = null, dump = false } = {}) {
  const t0 = Date.now();
  let ok = true;
  let detail = '';
  let json = null;

  try {
    json = await callHotsoft(path, body);
    // `Response: 2` = échec métier malgré un HTTP 200. Le distinguer d'un vrai
    // succès évite de compter comme « couvert » un endpoint qui refuse.
    if (json && typeof json === 'object' && json.Response === 2) {
      ok = false;
      detail = messagesOf(json) || 'Response=2';
    } else {
      const n = count ? count(json) : null;
      detail = n === null ? '' : `${n} ligne(s)`;
      const warn = json?.Response === 1 ? messagesOf(json) : '';
      if (warn) detail += detail ? ` — ${warn}` : warn;
    }
  } catch (e) {
    ok = false;
    detail = String(e.message || e).replace(/^HotSoft \S+ → /, '');
  }

  results.push({ path, module, label, ok, ms: Date.now() - t0, detail });

  if (dump && json) {
    await mkdir(DUMPS, { recursive: true });
    await writeFile(join(DUMPS, `${path.replace(/[/=]/g, '.')}.json`), JSON.stringify(json, null, 2));
  }

  console.log(`  ${ok ? 'OK  ' : 'KO  '}${path.padEnd(34)} ${label}${detail ? `  → ${detail}` : ''}`);
  await new Promise((r) => setTimeout(r, 200)); // on ne bouscule pas leur débit
  return ok ? json : null;
}

function messagesOf(json) {
  const list = json?.Messages || (json?.Message ? [json.Message] : []);
  return list.map((m) => (typeof m === 'string' ? m : m?.Message)).filter(Boolean).join(' / ').slice(0, 110);
}

export function section(title) {
  console.log(`\n— ${title} —`);
}

/** La matrice : inventaire de couverture ET pièce du dossier de certification. */
export async function writeMatrix(file, title, labels, preamble = '') {
  const byModule = {};
  for (const r of results) (byModule[r.module] ??= []).push(r);

  let md = `# ${title}\n\n`;
  md += `Balayage **en lecture seule** du HotSoft 8 Open API sur le bac à sable de certification `;
  md += `(\`${process.env.HOTSOFT_BASE}\`).\n\nRégénérer avec :\n\n`;
  md += '```bash\nbash scripts/hotsoft-certif/run.sh sweep-read.mjs\n```\n\n';
  if (preamble) md += `${preamble}\n\n`;

  for (const [mod, rows] of Object.entries(byModule)) {
    md += `## ${labels[mod] || mod}\n\n| Endpoint | Ce qu'on en attend | Verdict | Détail |\n|---|---|---|---|\n`;
    for (const r of rows) {
      md += `| \`${r.path}\` | ${r.label || '—'} | ${r.ok ? 'OK' : 'KO'} | ${(r.detail || '—').replace(/\|/g, '/').slice(0, 100)} |\n`;
    }
    md += '\n';
  }

  const ok = results.filter((r) => r.ok).length;
  md += `_${ok}/${results.length} endpoints en succès._\n`;
  await mkdir('docs', { recursive: true });
  await writeFile(join('docs', file), md);
  console.log(`\n${ok}/${results.length} OK → docs/${file}`);
}

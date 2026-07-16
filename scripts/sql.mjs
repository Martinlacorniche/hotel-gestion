#!/usr/bin/env node
// Exécute du SQL sur la base Supabase de prod via l'API Management.
// C'est le SQL editor du dashboard, en ligne de commande.
//
//   node scripts/sql.mjs "select 1"           → une requête inline
//   node scripts/sql.mjs -f db/migrations/57_x.sql  → un fichier
//   node scripts/sql.mjs -f x.sql --dry       → affiche sans exécuter
//
// Jeton : SUPABASE_ACCESS_TOKEN dans .env.local (gitignoré).
// ⚠️ Rôle `postgres` = accès total. Rien n'est transactionnel ici : l'API
// exécute le script tel quel. Encadrer soi-même par begin/commit si besoin.
import { readFileSync } from 'node:fs';

const env = {};
try {
  for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* pas de .env.local */ }

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN;
const REF = process.env.SUPABASE_PROJECT_REF || env.SUPABASE_PROJECT_REF || 'drdlcohzfjdogyquglcs';
if (!TOKEN) {
  console.error('SUPABASE_ACCESS_TOKEN manquant (.env.local)');
  process.exit(1);
}

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const fi = args.indexOf('-f');
const query = fi !== -1
  ? readFileSync(args[fi + 1], 'utf8')
  : args.filter(a => !a.startsWith('--')).join(' ');

if (!query.trim()) { console.error('Rien à exécuter.'); process.exit(1); }

if (dry) {
  console.log('--- DRY RUN, rien n’est exécuté ---\n');
  console.log(query);
  process.exit(0);
}

const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query }),
});
const text = await res.text();
let json; try { json = JSON.parse(text); } catch { json = text; }

if (!res.ok) {
  console.error(`❌ HTTP ${res.status}`);
  console.error(typeof json === 'string' ? json : JSON.stringify(json, null, 2));
  process.exit(1);
}
console.log(`✅ HTTP ${res.status}`);
console.log(typeof json === 'string' ? json : JSON.stringify(json, null, 2));

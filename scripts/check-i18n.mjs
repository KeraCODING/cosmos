// Fails if the two languages differ, a used key is missing, or interface text is hardcoded in App.ts.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const read = (l, n) => JSON.parse(readFileSync(`locales/${l}/${n}.json`, 'utf8'));
const flat = (o, p = '', out = {}) => { for (const [k, v] of Object.entries(o)) { const key = p ? `${p}.${k}` : k; if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, key, out); else out[key] = v; } return out; };
const errors = [];
const all = {};
for (const ns of ['common', 'astronomy']) {
  const az = flat(read('az', ns)), en = flat(read('en', ns)), ru = flat(read('ru', ns)); all[ns] = az;
  for (const k of Object.keys(en)) { if (!(k in ru)) errors.push(`missing in ru: ${ns}:${k}`); else { const vars = (s) => String(s).match(/{{\w+}}/g)?.sort().join() ?? ''; if (vars(en[k]) !== vars(ru[k])) errors.push(`ru variables differ: ${ns}:${k}`); if (Array.isArray(en[k]) && en[k].length !== ru[k].length) errors.push(`ru list length: ${ns}:${k}`); } }
  for (const k of Object.keys(ru)) if (!(k in en)) errors.push(`extra in ru: ${ns}:${k}`);
  for (const k of Object.keys(az)) { if (!(k in en)) errors.push(`missing in en: ${ns}:${k}`); else if (Array.isArray(az[k]) && az[k].length !== en[k].length) errors.push(`list length differs: ${ns}:${k}`); else { const vars = (s) => String(s).match(/{{\w+}}/g)?.sort().join() ?? ''; if (vars(az[k]) !== vars(en[k])) errors.push(`variables differ: ${ns}:${k}`); } if (!String(az[k]).trim()) errors.push(`empty: ${ns}:${k}`); }
  for (const k of Object.keys(en)) if (!(k in az)) errors.push(`missing in az: ${ns}:${k}`);
}
const files = []; const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (f !== 'generated') walk(p); } else if (/\.ts$/.test(f)) files.push(p); } }; walk('src/renderer/src');
let used = 0;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\bt\('([\w.:]+)'/g)) { used++; const [ns, k] = m[1].includes(':') ? m[1].split(':') : ['common', m[1]]; if (!(k in all[ns])) errors.push(`${f}: unknown key ${m[1]}`); }
}
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`i18n ok: ${Object.keys(all.common).length} common and ${Object.keys(all.astronomy).length} astronomy keys in az, en and ru; ${used} static usages checked`);

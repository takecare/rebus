/**
 * The puzzle bank must not reach the phone.
 *
 * `shared/` is one module graph, and the client imports CONFIG and the wire types
 * from its barrel — which also re-exports the bank. Nothing but `sideEffects: false`
 * in shared/package.json stops Rollup keeping it, and a single `import { PUZZLES }`
 * in client code would put all 220 answers back in the bundle where any player can
 * read them. SPEC §4.4 is about payloads; this is the same guarantee for the build.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const assets = join(root, 'client/dist/assets');

let files;
try {
  files = readdirSync(assets).filter((f) => f.endsWith('.js'));
} catch {
  console.error(`no built client at ${assets} — run \`npm run build\` first.`);
  process.exit(1);
}
if (files.length === 0) {
  console.error(`no .js files in ${assets} — run \`npm run build\` first.`);
  process.exit(1);
}

const { PUZZLE_BANK } = await import('../shared/src/puzzles.data.ts');
const bundles = files.map((f) => ({ name: f, text: readFileSync(join(assets, f), 'utf8') }));

const leaks = [];
for (const { name, text } of bundles) {
  // Puzzle ids and the bank's own field names are unambiguous: nothing else in a
  // React bundle spells "film-lion-king" or "categoryFull". Titles are not safe to
  // match on their own — minified React really does contain `return"Portal"`, and
  // "Up" hides inside `forceUpdate` — so only long, distinctive ones are checked,
  // and only as whole quoted strings. If the bank ever ships, every one of these
  // fires at once, so the narrower rule loses no detection.
  for (const p of PUZZLE_BANK) {
    if (text.includes(p.id)) leaks.push(`${name}: puzzle id "${p.id}"`);
  }
  for (const field of ['categoryFull', 'renderRisk']) {
    if (text.includes(field)) leaks.push(`${name}: bank field "${field}"`);
  }
  for (const p of PUZZLE_BANK) {
    if (p.title.length < 10) continue;
    for (const quoted of [`"${p.title}"`, `'${p.title}'`, `\`${p.title}\``]) {
      if (text.includes(quoted)) leaks.push(`${name}: answer ${quoted} (${p.id})`);
    }
  }
}

if (leaks.length > 0) {
  console.error(`the client bundle leaks the puzzle bank (${leaks.length} findings):`);
  for (const l of leaks.slice(0, 15)) console.error(`  ${l}`);
  if (leaks.length > 15) console.error(`  ...and ${leaks.length - 15} more`);
  console.error('\nSomething in client/src now pulls the bank in. Import what you need from');
  console.error('a narrow path rather than the barrel, and keep sideEffects:false in shared/.');
  process.exit(1);
}

console.log(`ok: ${PUZZLE_BANK.length} answers absent from ${files.length} bundle file(s)`);

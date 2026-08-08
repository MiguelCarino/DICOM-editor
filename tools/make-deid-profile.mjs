// Regenerates ../deid-profile.js. Run from the repo root:
//
//   curl -sL https://raw.githubusercontent.com/innolitics/dicom-standard/master/standard/confidentiality_profile_attributes.json -o /tmp/conf.json
//   node tools/make-deid-profile.mjs /tmp/conf.json deid-profile.js > /tmp/new.js && mv /tmp/new.js deid-profile.js
//
// TWO INPUTS, and the second one is not optional. Innolitics is the only
// machine-readable source for the OPTIONAL profile columns, and it is the reason
// this script exists — but its extract tracks an older edition of Annex E than
// the Basic Profile column in deid-profile.js does. Regenerating from Innolitics
// alone silently dropped 38 attributes, among them the whole
// (0010,0011)-(0010,0047) pronoun and gender-identity block, the four diagnosis
// code sequences and two SR observer names. Thirty-five of them are X. Nothing
// failed; Anonymize simply stopped removing them.
//
// So the existing file is read back in as the authority on the Basic Profile,
// and Innolitics may only ADD to it. A row it does not have survives. A row it
// disagrees with is reported and the existing action wins. That makes a
// regeneration monotonic: this table can gain attributes and can never lose one.
//
// Out-of-band on purpose: nothing at runtime touches the network, and the table
// only changes when NEMA revises Annex E. Node only — never loaded by the page.
import { readFileSync } from 'node:fs';

const rows = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const HEX = /^[0-9A-Fa-f]{8}$/;

if (!process.argv[3]) {
  console.error('usage: node tools/make-deid-profile.mjs <innolitics.json> <existing deid-profile.js>');
  process.exit(2);
}
// Evaluated rather than parsed: the file assigns onto window, so give it one.
const prevSrc = readFileSync(process.argv[3], 'utf8');
const prevWin = {};
new Function('window', prevSrc)(prevWin);
const PREV = prevWin.DEID_PROFILE || {};
if (Object.keys(PREV).length < 100) {
  console.error(`refusing to regenerate: ${process.argv[3]} yielded only ${Object.keys(PREV).length} attributes`);
  process.exit(2);
}

// Options in the order PS3.15 Table E.1-1 prints them.
const OPTS = [
  'rtnSafePrivOpt', 'rtnUIDsOpt', 'rtnDevIdOpt', 'rtnInstIdOpt', 'rtnPatCharsOpt',
  'rtnLongFullDatesOpt', 'rtnLongModifDatesOpt', 'cleanDescOpt', 'cleanStructContOpt',
  'cleanGraphOpt',
];

// Five per line, as the previous generation shipped — a fixed count rather than
// a fill-to-width, so one value growing a character does not reflow the file.
function fill(pairs, indent = '  ', per = 5) {
  const out = [];
  for (let i = 0; i < pairs.length; i += per) {
    const chunk = pairs.slice(i, i + per);
    out.push(indent + chunk.join(', ') + (i + per < pairs.length ? ',' : ''));
  }
  return out.join('\n');
}

// Start from what is already there, then let Innolitics add.
const merged = new Map(Object.entries(PREV));
const added = [], disagreed = [];
for (const r of rows) {
  if (!HEX.test(r.id)) continue;
  const id = r.id.toUpperCase();
  if (!merged.has(id)) { merged.set(id, r.basicProfile); added.push(id); continue; }
  if (merged.get(id) !== r.basicProfile) disagreed.push(`${id}: keeping ${merged.get(id)}, upstream says ${r.basicProfile}`);
}
// (0002,0013) Implementation Version Name is not in Table E.1-1 — it is file-meta,
// not a dataset attribute — but it names the software that produced the object and
// so is worth replacing. Hand-added; a regeneration that drops it changes behaviour.
if (!merged.has('00020013')) merged.set('00020013', 'D');

const missingUpstream = [...merged.keys()].filter(id => !rows.some(r => HEX.test(r.id) && r.id.toUpperCase() === id));
console.error(`base: ${Object.keys(PREV).length} kept, ${added.length} added by upstream, ${merged.size} total`);
if (added.length) console.error(`  added: ${added.join(' ')}`);
if (missingUpstream.length) console.error(`  upstream does not carry (kept anyway): ${missingUpstream.length} — ${missingUpstream.join(' ')}`);
if (disagreed.length) console.error(`  DISAGREEMENTS, existing action wins:\n    ${disagreed.join('\n    ')}`);

const basic = [...merged.entries()];
basic.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);

const optMaps = OPTS.map(o => {
  const rs = rows.filter(r => HEX.test(r.id) && r[o]).map(r => [r.id.toUpperCase(), r[o]]);
  rs.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  return [o, rs];
});

const kept = o => optMaps.find(([n]) => n === o)[1].filter(([, v]) => v === 'K').length;

let out = `/* =====================================================================
   DICOM PS3.15 Table E.1-1 — Basic Application Level Confidentiality Profile,
   with the optional profiles that share the table.
   DO NOT hand-edit; regenerate with tools/make-deid-profile.mjs.

   The Basic Profile column is Annex E as published (2026c). The optional-profile
   columns come from the Innolitics dicom-standard machine-readable extract,
   which tracks an older edition and is short 38 of these attributes — so the
   generator merges rather than replaces, and the table can only ever grow. See
   the note at the top of tools/make-deid-profile.mjs for what was lost the one
   time it did replace.

   window.DEID_PROFILE maps a tag id (8-char UPPERCASE hex, no group/element
   punctuation) to its Basic Profile action code:
     X       remove the attribute entirely
     Z       replace with a zero-length (empty) value
     D       replace with a non-zero dummy value
     U       replace UID with an internally-consistent remapped UID
     Z/D     Z or D  (this tool: Z / empty)
     X/Z     X or Z  (this tool: Z / empty — never drops a maybe-required attr)
     X/D     X or D  (this tool: D / dummy)
     X/Z/D   any of the three (this tool: Z / empty)
     X/Z/U*  keep & recurse so nested UIDs get remapped (preserves references)

   window.DEID_OPTIONS carries one sub-map per optional profile, holding ONLY the
   tags that option overrides. Its values are the standard's own two:
     K       keep the attribute unmodified
     C       "clean" — replace with a value of similar meaning known not to
             contain identifying information. That is content-aware free-text /
             graphics / date editing; this tool does not do it and does not
             pretend to. index.html honours K and falls back to the Basic Profile
             action for C, which is the conservative direction (more is removed
             than the option promises, never less). See README.md.

   ${basic.length} concrete attributes below. Repeating-group attributes are handled in
   code (not here): Curve Data (50xx,xxxx) and Overlay Data/Comments (60xx,3000 /
   60xx,4000) are removed; Private Attributes (odd groups) are removed by remPrivate().
   Those rows are also most of what two of the options cover: three of Clean
   Graphics' four upstream rows are Curve Data and the two Overlay ones, and Retain
   Safe Private's single row IS the odd-group one — which is why cleanGraphOpt holds
   one attribute here and rtnSafePrivOpt holds none.
   ===================================================================== */
window.DEID_PROFILE = {
${fill(basic.map(([k, v]) => `"${k}":"${v}"`))}
};
window.DEID_OPTIONS = {
`;

for (const [name, rs] of optMaps) {
  const k = rs.filter(([, v]) => v === 'K').length;
  const c = rs.length - k;
  out += `  // ${name}: ${rs.length} attribute${rs.length === 1 ? '' : 's'} (${k} K, ${c} C)\n`;
  out += `  ${name}: {${rs.length ? '\n' + fill(rs.map(([kk, v]) => `"${kk}":"${v}"`), '    ') + '\n  ' : ''}},\n`;
}

out += `};
window.DEID_PROFILE_META = {
  attributes: ${basic.length},
  standard: "DICOM PS3.15 Table E.1-1 (Basic Profile)",
  options: {
${fill(OPTS.map(o => `${o}: ${optMaps.find(([n]) => n === o)[1].length}`), '    ', 3)}
  },
};
`;
process.stdout.write(out);

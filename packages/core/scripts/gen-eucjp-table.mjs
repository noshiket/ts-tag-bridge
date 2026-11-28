// src/util/eucJpTable.ts を作る（EUC-JP の 2 バイト → 文字の表）。Node の TextDecoder で引く:
//   node scripts/gen-eucjp-table.mjs > src/util/eucJpTable.ts
const d = new TextDecoder('euc-jp', { fatal: true });
let s = '';
for (let r = 0xa1; r <= 0xfe; r++) for (let c = 0xa1; c <= 0xfe; c++) {
  try { s += d.decode(Uint8Array.from([r, c])); } catch { s += '￿'; }
}
console.log('// node scripts/gen-eucjp-table.mjs で作った表（手で直さない）。94×94、無い所は U+FFFF');
console.log(`export const EUC_JP_TABLE = ${JSON.stringify(s)};`);

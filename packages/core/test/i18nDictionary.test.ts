/// <reference types="node" />
// 辞書のファイルを読むので Node の型を使う（src では使わないので、このテストだけで読み込む）
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { JA } from '../src';

// 辞書の決まりを確かめる: 英語の辞書（言語アドオンの見本）と同じキー・同じ差し込み、使っていないキーが無い、ファイルは 200 行以下
const ROOT = join(__dirname, '..', '..', '..');
// 英語の辞書は ts-tag-bridge の server/addon/lang_en（このフォルダの1つ上）
const EN_DIR = join(ROOT, '..', 'server', 'addon', 'lang_en', 'messages');
const JA_DIR = join(__dirname, '..', 'src', 'i18n', 'ja');
/** キーを組み立てて引く所（trLabel の名前・テンプレート）の頭 */
const DYNAMIC = ['state.rec.', 'state.recStatus.', 'state.enc.', 'state.recStep.', 'epg.genre.', 'library.musicSort.', 'library.music.tab.', 'view.', 'fmt.', 'date.'];

const walk = (dir: string, re: RegExp): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p, re) : re.test(n) ? [p] : [];
});
const en: Record<string, unknown> = Object.assign({}, ...readdirSync(EN_DIR).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(readFileSync(join(EN_DIR, n), 'utf8'))));
const vars = (m: unknown) => [...JSON.stringify(m).matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().filter((v, i, a) => a.indexOf(v) === i);

describe('表示言語の辞書', () => {
  it('英語の辞書が日本語と同じキーを持つ', () => {
    expect(Object.keys(en).filter((k) => !(k in JA))).toEqual([]);
    expect(Object.keys(JA).filter((k) => !(k in en))).toEqual([]);
  });
  it('差し込む名前（{n} など）が日本語と英語で同じ', () => {
    expect(Object.entries(JA).filter(([k, v]) => k in en && vars(v).join() !== vars(en[k]).join()).map(([k]) => k)).toEqual([]);
  });
  it('使っていないキーが無い', () => {
    const src = [join(ROOT, 'apps', 'app', 'src'), join(__dirname, '..', 'src')]
      .flatMap((d) => walk(d, /\.tsx?$/)).filter((f) => !f.includes(`${join('src', 'i18n')}`))
      .map((f) => readFileSync(f, 'utf8')).join('\n');
    const unused = Object.keys(JA).filter((k) => !DYNAMIC.some((p) => k.startsWith(p)) && !src.includes(`'${k}'`));
    expect(unused).toEqual([]);
  });
  it('日本語の辞書のファイルは 200 行以下', () => {
    expect(walk(JA_DIR, /\.ts$/).filter((f) => readFileSync(f, 'utf8').split('\n').length > 200)).toEqual([]);
  });
});

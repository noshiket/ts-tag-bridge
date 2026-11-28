import { describe, expect, it } from 'vitest';

import { PATH_VAR_GROUPS, expandPathExample } from '../src';

describe('ファイル名の決め方の変数', () => {
  it('設定の既定の書き方を例の値で展開する', () => {
    expect(expandPathExample('{$encode_dir}/{$folder}/[{$service_name}]{$title}_#{$episode_number}_{$setting}{$start_time}{$ext}'))
      .toBe('/mnt/encoded1/星のかけら/[QZX総合]星のかけら 第2期_#03_[字][再]20251122-2300.mp4');
  });
  it('$名前 でも書け、知らない変数は残す。title は解析した値が勝つ', () => {
    expect(expandPathExample('$folder/{$nope}/$title')).toBe('星のかけら/{$nope}/星のかけら 第2期');
  });
  it('パスに使う変数の名前は重ならない（パターンの中だけのものを除く）', () => {
    const keys = PATH_VAR_GROUPS.filter((g) => !g.patternOnly).flatMap((g) => g.vars.map((v) => v.key));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

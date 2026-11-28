import { describe, expect, it } from 'vitest';

import { EucJpDecoder } from '../src/util/eucJpDecoder';

describe('EucJpDecoder', () => {
  const native = new TextDecoder('euc-jp', { fatal: true });
  const mine = new EucJpDecoder(true);

  it('2 バイトの文字はどれも Node の TextDecoder と同じに読む（無い所は同じく投げる）', () => {
    for (let r = 0xa1; r <= 0xfe; r++) for (let c = 0xa1; c <= 0xfe; c++) {
      const bytes = Uint8Array.from([r, c]);
      let want: string | null = null;
      try { want = native.decode(bytes); } catch { /* 無い文字 */ }
      if (want == null) expect(() => mine.decode(bytes)).toThrow();
      else expect(mine.decode(bytes)).toBe(want);
    }
  });

  it('ASCII・半角カナ・漢字が混ざっても読む', () => {
    const bytes = Uint8Array.from([0x41, 0xb4, 0xc1, 0xbb, 0xfa, 0x8e, 0xb1, 0x31]);
    expect(mine.decode(bytes)).toBe(native.decode(bytes));
    expect(mine.decode(bytes)).toBe('A漢字ｱ1');
  });

  it('fatal でなければ読めない所は Node と同じく置き換え文字にする', () => {
    const loose = new TextDecoder('euc-jp');
    for (const b of [[0xa9, 0xa1, 0x41], [0xa1, 0x41], [0xa1], [0x8e, 0x41]]) {
      expect(new EucJpDecoder().decode(Uint8Array.from(b))).toBe(loose.decode(Uint8Array.from(b)));
    }
  });
});

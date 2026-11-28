// iOS の JS（Hermes）の TextDecoder は UTF-8 しか読めない。字幕の解析(aribb24.js)は読み込む時に
// EUC-JP で JIS の文字表を作り、使わない部分（B36 形式）でも Shift_JIS の TextDecoder を作る。
// EUC-JP は読めるようにし、他の読めない文字コードは作る所では落とさず、読む時に落とす（Web は元から全部読める）
import { EUC_JP_TABLE } from './eucJpTable';

const MISSING = 0xffff;

/** EUC-JP（ASCII・JIS X 0208 の 2 バイト・半角カナ）を読む。補助漢字の 3 バイトは扱わない */
export class EucJpDecoder {
  readonly encoding = 'euc-jp';
  constructor(private readonly fatal = false) {}

  decode(input?: ArrayBuffer | ArrayBufferView): string {
    const b = input == null ? new Uint8Array(0)
      : input instanceof ArrayBuffer ? new Uint8Array(input)
      : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    let out = '';
    for (let i = 0; i < b.length; i++) {
      const c = b[i]!;
      if (c < 0x80) { out += String.fromCharCode(c); continue; }
      const n = b[i + 1];
      // 2 バイト目が範囲内なら、表に無くても 2 バイトで 1 文字として進む（WHATWG の決まり）
      const pair = n !== undefined && n >= 0xa1 && n <= 0xfe && (c === 0x8e || (c >= 0xa1 && c <= 0xfe));
      let code = MISSING;
      if (pair && c === 0x8e) code = n <= 0xdf ? 0xff61 + (n - 0xa1) : MISSING;
      else if (pair) code = EUC_JP_TABLE.charCodeAt((c - 0xa1) * 94 + (n - 0xa1));
      if (pair) i++;
      if (code === MISSING) {
        if (this.fatal) throw new TypeError('The encoded data was not valid for encoding euc-jp');
        out += '�';
        continue;
      }
      out += String.fromCharCode(code);
    }
    return out;
  }
}

const isEucJp = (label: string) => /^(euc-?jp|x-euc-jp)$/i.test(label.trim());

const Native = globalThis.TextDecoder;
let supported = false;
try { new Native('euc-jp'); supported = true; } catch { /* Hermes */ }
if (!supported) {
  class TextDecoderOnHermes {
    constructor(label = 'utf-8', options?: { fatal?: boolean }) {
      if (isEucJp(label)) return new EucJpDecoder(!!options?.fatal) as TextDecoderOnHermes;
      try {
        return new Native(label, options) as TextDecoderOnHermes;
      } catch (e) {
        return { encoding: label, decode: () => { throw e; } } as TextDecoderOnHermes;
      }
    }
  }
  (globalThis as { TextDecoder: unknown }).TextDecoder = TextDecoderOnHermes;
}

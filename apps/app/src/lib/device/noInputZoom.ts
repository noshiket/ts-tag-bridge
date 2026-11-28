// iPhone・iPad の Safari は、文字が 16px 未満の入力欄を触るたびにページを拡大する。
// viewport に maximum-scale=1 を足すとそれが止まる（iOS の Safari は指でつまむ拡大はそのまま効く）。
// Android の Chrome では指の拡大まで止まるので、iPhone・iPad の時だけ足す
import { isIOSBrowser } from './iosBrowser';

if (isIOSBrowser && typeof document !== 'undefined') {
  const meta = document.querySelector('meta[name="viewport"]');
  const content = meta?.getAttribute('content') ?? 'width=device-width, initial-scale=1';
  if (meta && !/maximum-scale/.test(content)) meta.setAttribute('content', `${content}, maximum-scale=1`);
}
export {};

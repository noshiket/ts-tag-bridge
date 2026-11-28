// 音楽の波形とスペクトラム（元の stream.jsx と同じ読み方）。サーバーが前もって解析した値を、再生位置に合わせて描く。
// 再生中に音を解析すると、iOS が裏で音を止めるため（音の通り道には触らない）

/** GET /api/videos/<id>/audioviz を読んだもの */
export interface AudioViz {
  /** シークバーに敷く波形（0〜255） */
  peaks: Uint8Array;
  /** スペクトラム（コマごとに nb 本。0〜255） */
  bands: Uint8Array;
  /** 1コマの本数 */
  nb: number;
  /** 1秒あたりのコマ数 */
  fps: number;
  /** コマの数 */
  cols: number;
}

/** 先頭4バイト=見出しの長さ、見出し(JSON)、波形 peak_count バイト、残りがスペクトラム */
export function parseAudioViz(buf: ArrayBuffer): AudioViz {
  const dv = new DataView(buf);
  const hlen = dv.getUint32(0, true);
  const raw = new Uint8Array(buf, 4, hlen);
  // 見出しは英数字だけの JSON。TextDecoder の無い環境（iOS の JS）でも読めるよう1文字ずつ直す
  let text = '';
  for (let i = 0; i < raw.length; i++) text += String.fromCharCode(raw[i]!);
  const head = JSON.parse(text) as { peak_count: number; bands: number; fps: number };
  const off = 4 + hlen;
  const peaks = new Uint8Array(buf, off, head.peak_count);
  const bands = new Uint8Array(buf, off + head.peak_count);
  return { peaks, bands, nb: head.bands, fps: head.fps, cols: Math.floor(bands.length / head.bands) };
}

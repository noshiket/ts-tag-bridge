import { captionSvg, danmakuTop, danmakuX, visibleDanmaku, type DanmakuLayout, type ScreenGroup } from '@tstag/core';

import type { GrabbedFrame } from './surface';

/**
 * キャプチャの絵: 写したコマに、画面と同じ弾幕（同じ透過）と字幕を重ねて JPEG にする（Web だけ。元と同じ）。
 * 弾幕と字幕は映像を出している枠（stage）の座標なので、映像が収まっている所を切り出して重ねる
 */
export async function composeCapture(frame: GrabbedFrame, stage: { width: number; height: number }, layers: {
  danmaku: { layout: DanmakuLayout; opacity: number } | null;
  captions: ScreenGroup[] | null;
}): Promise<string> {
  const { canvas, time } = frame;
  const W = canvas.width;
  const H = canvas.height;
  const ctx = canvas.getContext('2d')!;
  // 枠の中で映像が収まっている所（contain）
  const fit = Math.min(stage.width / W, stage.height / H);
  const ox = (stage.width - W * fit) / 2;
  const oy = (stage.height - H * fit) / 2;

  if (layers.danmaku) {
    const { layout, opacity } = layers.danmaku;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.scale(1 / fit, 1 / fit);
    ctx.translate(-ox, -oy);
    // 画面の DanmakuOverlay と同じ: 太さ 600・黒い影
    ctx.font = `600 ${layout.fontSize}px sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 3 / fit;
    for (const it of visibleDanmaku(layout, time)) {
      ctx.fillStyle = it.color;
      ctx.fillText(it.text, danmakuX(layout, it, time), danmakuTop(layout, it) + layout.lineHeight / 2);
    }
    ctx.restore();
  }

  const svg = layers.captions ? captionSvg(layers.captions, time, new Map()) : null;
  if (svg) {
    // 字幕は画面全体の座標なので、映像と同じ大きさに伸ばして重ねる
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg.replace('<svg', `<svg width="${W}" height="${H}" preserveAspectRatio="none"`)], { type: 'image/svg+xml' }));
    try {
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
      ctx.drawImage(img, 0, 0, W, H);
    } catch { /* 字幕だけ重ねられなくても絵は残す */ } finally {
      URL.revokeObjectURL(url);
    }
  }
  return canvas.toDataURL('image/jpeg', 0.9);
}

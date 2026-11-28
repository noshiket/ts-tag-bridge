import type { PendingAutoAdd } from '@tstag/core';
import { router } from 'expo-router';

// 他の画面（番組検索・番組表のシート）から自動予約のルールを作る時に、条件を新規の編集画面へ渡す（元の pendingAutoAdd）。
// 画面の URL に印（from）を付け、同じ印で読めば何度でも同じ条件を返す。開いた直後に画面が作り直されることがあり、
// 「1回読んだら消す」だと最初の画面が使い切って、表示される方の画面には条件が届かなかった。次に開く時に入れ替わる
let slot: { from: string; p: PendingAutoAdd } | null = null;

/** 条件を持たせて、そのサーバーの新規ルールの編集を開く */
export function openNewAutoAdd(p: PendingAutoAdd | null, node: string | null) {
  const from = String(Date.now());
  slot = p ? { from, p } : null;
  router.push({ pathname: '/autoadd/[id]', params: { id: 'new', ...(p ? { from } : {}), ...(node ? { node } : {}) } });
}

/** 新規の編集画面が、URL の印で引き継ぎの条件を受け取る（印が違えば無し） */
export function pendingAutoAdd(from: string | undefined): PendingAutoAdd | null {
  return from && slot?.from === from ? slot.p : null;
}

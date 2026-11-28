import type { Api as TSTagApi } from '@tstag/core';

import { backend } from './backend';

/**
 * 保存に、ライブラリのカードの中身（card.json）と tag.json 丸ごと（tag.json）を添える。
 * 通信の無い時も一覧のカードと再生画面のタブを同じに出すため。取れなくても保存そのものはそのまま（後で再生・一覧を開いた時に添える）
 */
export async function fetchExtras(api: TSTagApi, ck: string, id: number, node: string | null) {
  await Promise.all([
    api.library.videoCards([id], node).then(([c]) => (c ? backend.saveJson(ck, 'card', c) : undefined)).catch(() => {}),
    api.videoActions.tag(id, node).then((r) => (r.exists && r.tag ? backend.saveJson(ck, 'tag', r.tag) : undefined)).catch(() => {}),
  ]);
}

import type { ApiClient } from '../http/client';
import { nodePath } from '../http/node';
import { adaptAddonAutoAdd, adaptAutoAdd, type AddonRuleRaw, type AddonSearchInfo, type AutoAddRaw, type ManuAddRaw } from './autoAdd';

/** アドオンの一覧の1件（使う所だけ） */
export interface AddonInfo { name: string; label?: string; enabled?: boolean; records_guide?: boolean; target?: string;
  /** target='cm_analysis' が結果に書き足す鍵の出し方（分割画面はこれだけで描く） */
  marks?: import('../split/cm').CmMarkDecl[]; error?: string | null }
/** 番組表アドオンのその日の局（live_url がある局だけ録画できる） */
export interface AddonGuide { channels: { id: string; name: string; short?: string; live_url?: string | null; logo_url?: string | null }[] }

export const autoAddApi = (c: ApiClient) => {
  const addons = (target: string, node?: string | null) =>
    c.get<AddonInfo[]>(nodePath(node, `/api/addons?target=${encodeURIComponent(target)}`));
  const fire = <T>(name: string, body: unknown, node?: string | null) =>
    c.post<{ ok?: boolean; result?: T }>(nodePath(node, `/api/addons/${encodeURIComponent(name)}/fire`), body ?? {});
  /** 配信の予約録画を受け持つ録画アドオン（無ければ null） */
  const recorder = async (node?: string | null) => (await addons('event', node)).find((a) => a.records_guide) ?? null;
  return {
    addons,
    recorder,
    /** アドオンを動かす（録画アドオンへの予約など。中身はアドオンが決める） */
    fire,
    guide: (name: string, date: string, node?: string | null) =>
      c.get<AddonGuide & import('../epg/addonGuide').AddonGuideDay>(nodePath(node, `/api/addons/${encodeURIComponent(name)}/guide?date=${encodeURIComponent(date)}`)),
    /** EDCB のルールに、録画アドオンが持つ配信のルールを足した一覧（配信のルールが取れなくても EDCB のものは出す） */
    /**
     * 予約の元になった自動予約ルールの候補（予約詳細の案内）。決まっていればそれ、無ければ EDCB の予約の comment と検索条件で引く。
     * 候補が1つならサーバーが覚える（auto_add_id）。0 は「自動予約ではない」と確かめ済み
     */
    candidates: async (ruleId: number, node?: string | null) => {
      const r = await c.get<{ candidates?: AutoAddRaw[]; saved?: boolean; auto_add_id?: number | null }>(nodePath(node, `/api/rules/${ruleId}/auto_add_candidates`));
      return { candidates: (r.candidates ?? []).map(adaptAutoAdd), saved: !!r.saved, autoAddId: r.auto_add_id ?? null };
    },
    list: async (node?: string | null) => {
      const rules = (await c.get<AutoAddRaw[]>(nodePath(node, '/api/auto_add'))).map(adaptAutoAdd);
      try {
        const rec = await recorder(node);
        if (rec) {
          const r = await fire<{ rules?: Record<string, AddonRuleRaw> }>(rec.name, { event: 'auto_rules' }, node);
          Object.entries(r.result?.rules ?? {}).filter(([, v]) => v?.search_info)
            .forEach(([id, v]) => rules.push(adaptAddonAutoAdd(Number(id), v, rec.name)));
        }
      } catch { /* 配信のルールは無くても一覧は出す */ }
      return rules;
    },
    add: (body: Record<string, unknown>, node?: string | null) => c.post<unknown>(nodePath(node, '/api/auto_add'), body),
    update: (id: number, body: Record<string, unknown>, node?: string | null) => c.patch<unknown>(nodePath(node, `/api/auto_add/${id}`), body),
    remove: (id: number, node?: string | null) => c.delete<unknown>(nodePath(node, `/api/auto_add/${id}`)),
    /** 配信のルールを保存する（id 無しで新規。局が空なら消える） */
    saveAddonRule: (addon: string, payload: { id: number | null; search_info?: AddonSearchInfo; channels: string[]; enabled?: boolean; note?: string }, node?: string | null) =>
      fire<unknown>(addon, { event: 'auto_rule_set', payload }, node),
    /** 編集中の条件で配信の番組を探す（予約はしない） */
    addonPreview: (addon: string, payload: { channels: string[]; days: number; search_info: AddonSearchInfo }, node?: string | null) =>
      fire<{ programs?: { title: string; ch_name: string; start_time: string; end_time: string; duration_sec?: number; dup?: boolean }[] }>(
        addon, { event: 'auto_preview', payload }, node),
    manu: {
      list: (node?: string | null) => c.get<ManuAddRaw[]>(nodePath(node, '/api/manu_add')),
      add: (body: Record<string, unknown>, node?: string | null) => c.post<unknown>(nodePath(node, '/api/manu_add'), body),
      update: (id: number, body: Record<string, unknown>, node?: string | null) => c.patch<unknown>(nodePath(node, `/api/manu_add/${id}`), body),
      remove: (id: number, node?: string | null) => c.delete<unknown>(nodePath(node, `/api/manu_add/${id}`)),
    },
  };
};

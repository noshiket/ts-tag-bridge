import {
  addonSearchInfo, autoAddBody, initAutoAddForm, initRecSetting, normalizeContentList, type AutoAddForm, type AutoAddRule, type PendingAutoAdd,
} from '@tstag/core';
import { useApi, useReserves, useServices } from '@tstag/core/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import type { GuideChannel } from './GuideChannelPicker';
import { useT } from '../../../ui/i18n/I18n';

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * EPG キーワード自動予約の編集の状態: 条件と録画設定、局・予約・録画設定の候補・チューナー、
 * 配信の局（録画アドオンと番組表アドオンの今日の局）、保存・削除（終わったら一覧へ）
 */
export function useAutoAddEditor(item: AutoAddRule | null, pending: PendingAutoAdd | null, node: string | null, back: () => void) {
  const { t: tx } = useT();
  const api = useApi();
  const qc = useQueryClient();
  const [form, setForm] = useState<AutoAddForm>(() => initAutoAddForm(item, pending));
  const set = <K extends keyof AutoAddForm>(k: K, v: AutoAddForm[K]) => setForm((p) => ({ ...p, [k]: v }));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const services = useServices(node);
  const reserves = useReserves(node);
  const recOpts = useQuery({ queryKey: ['recSettingOptions', node ?? ''], queryFn: () => api.recSetting.options(node) });
  const tuners = useQuery({ queryKey: ['tuners', node ?? ''], queryFn: () => api.recSetting.tuners(node) });
  // 配信の局: 配信の予約録画を受け持つ録画アドオンと、番組表アドオンの今日の局（録画できる局だけ）
  const recorder = useQuery({ queryKey: ['addons', node ?? '', 'recorder'], queryFn: () => api.autoAdd.recorder(node) });
  const guideChans = useQuery({
    queryKey: ['addons', node ?? '', 'guideChannels'],
    queryFn: async () => {
      const out: GuideChannel[] = [];
      for (const g of await api.autoAdd.addons('guide', node)) {
        try {
          const guide = await api.autoAdd.guide(g.name, ymd(new Date()), node);
          // 短い名前は同じものが並んで見分けられないので、局の名前で出す
          guide.channels.filter((c) => c.live_url).forEach((c) => out.push({ key: `${g.name}/${c.id}`, name: c.name, guideLabel: g.label || g.name }));
        } catch { /* 取れない番組表は出さない */ }
      }
      return out;
    },
  });
  const [addonChs, setAddonChs] = useState<string[]>(() => item?.channels ?? []);
  const addonMode = addonChs.length > 0;
  const addonName = item?.addon || recorder.data?.name;

  // 新規で局を1つも選んでいなければ全局を選ぶ（空のまま保存すると、どの局にも当たらず EMWUI の一覧も読めなくなる）
  useEffect(() => {
    if (!item && services.data) setForm((p) => (p.serviceList.length ? p : { ...p, serviceList: services.data.map((s) => `${s.onid}-${s.tsid}-${s.sid}`) }));
  }, [services.data]); // eslint-disable-line react-hooks/exhaustive-deps
  // 新規（録画設定の引き継ぎも無い時）は、EDCB の既定のプリセット（0）を録画設定の始めの値にする
  useEffect(() => {
    const presets = recOpts.data?.presets ?? [];
    if (item || pending?.recSetting || !presets.length) return;
    const def = presets.find((p) => Number(p.value) === 0) ?? presets[0];
    if (def?.rec_setting) setForm((p) => ({ ...p, ...initRecSetting(def.rec_setting), presetID: String(def.value) }));
  }, [recOpts.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const done = async () => { await qc.invalidateQueries({ queryKey: ['autoAdd', node ?? ''] }); back(); };
  const save = async () => {
    setSaving(true);
    setErr(null);
    const contentList = normalizeContentList(form.contentList);
    try {
      // EDCB のルールを配信の局へ変えた（またはその逆）時は、移した先で作って元を消す
      if (addonMode) {
        await api.autoAdd.saveAddonRule(addonName!, {
          id: item?.addon ? item.id : null, search_info: addonSearchInfo(form, contentList), channels: addonChs, enabled: !form.disableFlag, note: form.note || '',
        }, node);
        if (item && !item.addon) await api.autoAdd.remove(item.id, node);
      } else {
        const body = autoAddBody(form);
        if (item && !item.addon) await api.autoAdd.update(item.id, body, node);
        else await api.autoAdd.add(body, node);
        if (item?.addon) await api.autoAdd.saveAddonRule(item.addon, { id: item.id, channels: [] }, node);
      }
      await done();
    } catch (e) {
      setErr(e instanceof Error ? e.message : tx('common.couldntSave2'));
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    if (!item) return;
    try {
      if (item.addon) await api.autoAdd.saveAddonRule(item.addon, { id: item.id, channels: [] }, node);
      else await api.autoAdd.remove(item.id, node);
      await done();
    } catch (e) {
      setErr(e instanceof Error ? e.message : tx('common.couldntDelete'));
    }
  };

  return {
    form, setForm, set, saving, err, save, remove,
    services, reserves, recOpts, tuners, recorder, guideChans, addonChs, setAddonChs, addonMode, addonName,
  };
}

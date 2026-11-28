import { canSubmitManualReserve, initManualReserve, manualReserveBody, type ManualReserveForm } from '@tstag/core';
import { useApi, useServices } from '@tstag/core/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

/**
 * 手動予約の入力と送信（このサーバーに入れる。元と同じ）: 局・チューナー・録画設定の候補を読み、
 * 局は読めたら先頭の局にしておく。入れたら少し待って done（予約一覧へ戻る）
 */
export function useManualReserve(done: () => void) {
  const api = useApi();
  const qc = useQueryClient();
  const [form, setForm] = useState<ManualReserveForm>(() => initManualReserve());
  const set = <K extends keyof ManualReserveForm>(k: K, v: ManualReserveForm[K]) => setForm((p) => ({ ...p, [k]: v }));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const services = useServices(null);
  const tuners = useQuery({ queryKey: ['tuners', ''], queryFn: () => api.recSetting.tuners(null) });
  const recOpts = useQuery({ queryKey: ['recSettingOptions', ''], queryFn: () => api.recSetting.options(null) });

  useEffect(() => {
    const s = services.data?.[0];
    if (s) setForm((p) => (p.service ? p : { ...p, service: `${s.onid}-${s.tsid}-${s.sid}` }));
  }, [services.data]);

  const valid = canSubmitManualReserve(form);
  const submit = async () => {
    setError(null);
    try {
      await api.reserves.addManual(manualReserveBody(form));
      void qc.invalidateQueries({ queryKey: ['reserves', ''] });
      setSaved(true);
      setTimeout(() => { setSaved(false); done(); }, 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return { form, set, saved, error, valid, submit, services: services.data, tuners: tuners.data, o: recOpts.data };
}

export type ManualReserve = ReturnType<typeof useManualReserve>;

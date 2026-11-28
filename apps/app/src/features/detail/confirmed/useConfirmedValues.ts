import {
  LIST_SEP, applyPresentTp, confirmedSaveBody, editConfirmed, initConfirmedValues, listColsOf, resolveFields, type ConfirmedKind, type ConfirmedValues,
} from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useEffect, useMemo, useState } from 'react';

import type { ConfirmedTarget } from './ConfirmedEditor';
import { useT } from '../../../ui/i18n/I18n';

/**
 * 確定値の編集の状態: 値（届いた確定値が変わったら戻す）・手で直したか（is_tp）・保存・
 * 解析結果を反映して保存・出力パスの解決
 */
export function useConfirmedValues(target: ConfirmedTarget, confirmed: Record<string, unknown> | null, tpData: Record<string, unknown>, node: string | null, onSaved?: () => void) {
  const { t: tx } = useT();
  const api = useApi();
  const kind: ConfirmedKind = target.kind;
  const lists = useMemo(() => listColsOf(kind), [kind]);
  const [vals, setVals] = useState<ConfirmedValues>(() => initConfirmedValues(confirmed, kind));
  const [manual, setManual] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [msg, setMsg] = useState('');
  const confirmedKey = JSON.stringify(confirmed);
  useEffect(() => { setVals(initConfirmedValues(confirmed, kind)); setManual(false); setMsg(''); }, [confirmedKey, kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const change = (key: string, value: string) => { setVals((v) => editConfirmed(v, key, value)); setManual(true); };
  const doSave = async (v: ConfirmedValues, m: boolean) => {
    setSaving(true); setMsg('');
    try {
      const body = confirmedSaveBody(v, kind, { manual: m, parserError: tpData.parser_error });
      if (target.kind === 'rule') await api.confirmed.saveRule(target.ruleId, body, node);
      else if (target.kind === 'recording') await api.confirmed.saveRecording(target.dbRecId, body, node);
      else await api.confirmed.saveVideo(target.videoId, body, node);
      setMsg(tx('common.saved2'));
      setTimeout(() => setMsg(''), 3000);
      onSaved?.();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  const applyAndSave = () => { const next = applyPresentTp(vals, tpData, kind); setVals(next); setManual(false); void doSave(next, false); };
  const resolvePath = async () => {
    setResolving(true); setMsg('');
    try {
      const path = await api.confirmed.resolvePath(vals.app_output_path_format ?? '', resolveFields(vals, tpData.setting), node);
      setVals((v) => ({ ...v, app_output_path: Array.isArray(path) ? path.join(lists.has('app_output_path') ? LIST_SEP : ', ') : String(path ?? '') }));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setResolving(false);
    }
  };

  return { kind, lists, vals, setVals, manual, setManual, saving, resolving, msg, change, doSave, applyAndSave, resolvePath };
}

export type ConfirmedState = ReturnType<typeof useConfirmedValues>;

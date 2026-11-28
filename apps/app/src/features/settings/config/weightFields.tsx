import { WEIGHT_OPTIONS } from '@tstag/core';

import { ConfigRow } from './configFields';
import type { ConfigEditorState } from './useConfigEditor';
import { useT } from '../../../ui/i18n/I18n';

type Kind = 'cmcut' | 'audio_sync';
type Param = 'workers' | 'nice' | 'max_load';
const KEY: Record<Kind, Partial<Record<Param, string>>> = {
  cmcut: { workers: 'cmcut_workers', nice: 'cmcut_nice', max_load: 'cmcut_max_load' },
  audio_sync: { nice: 'audio_sync_nice', max_load: 'audio_sync_max_load' },
};

const weightName = (w: string) => (WEIGHT_OPTIONS.find(([k]) => k === w)?.[1] ?? w).split('（')[0];
const weightOf = (c: ConfigEditorState, kind: Kind) => String(c.val(`${kind}_weight`) || 'low');

/** 数字を空欄にした時の値（今選んでいる重さで決まる。並列数と負荷はサーバーの CPU 数から） */
function presetOf(c: ConfigEditorState, kind: Kind, p: Param): number | undefined {
  const all = c.val('load_weight_presets') as Record<string, Record<Kind, Partial<Record<Param, number>>>> | undefined;
  return all?.[weightOf(c, kind)]?.[kind]?.[p];
}

/** 実際に使われる値（書いてあればそれ、空欄なら重さの値） */
function effective(c: ConfigEditorState, kind: Kind, p: Param): string {
  const v = c.val(KEY[kind][p]!);
  return v === '' || v == null ? String(presetOf(c, kind, p) ?? '?') : String(v);
}

/** 「動き」の重さ（控えめ・ふつう・全力）。下に、それで実際に使う数字を出す（詳細の数字と同じ物） */
export function WeightRow({ c, label, kind, hint }: { c: ConfigEditorState; label: string; kind: Kind; hint: string }) {
  const { t: tx } = useT();
  const nums = [
    kind === 'cmcut' ? tx('settings.weight.par', { n: effective(c, kind, 'workers') }) : tx('settings.weightFields.oneTime'),
    tx('settings.weightFields.niceness', { v0: effective(c, kind, 'nice') }),
    tx('settings.weightFields.aboveLoad', { v0: effective(c, kind, 'max_load'), v1: tx(kind === 'cmcut' ? 'settings.weight.reduce' : 'settings.weight.wait') }),
  ].join(tx('common.dotSeparator'));
  return <ConfigRow c={c} label={label} en={`${kind}_weight`} k={`${kind}_weight`} type="select" options={WEIGHT_OPTIONS}
    hint={tx('settings.weightFields.currentlyAdjustEachUnder', { v0: hint, v1: nums })} />;
}

/** 詳細の数字の1行。空欄の時は、今の重さで使う値を薄い字で出す */
export function WeightNumberRow({ c, label, kind, p, hint }: { c: ConfigEditorState; label: string; kind: Kind; p: Param; hint?: string }) {
  const { t: tx } = useT();
  const d = presetOf(c, kind, p);
  return <ConfigRow c={c} label={label} en={KEY[kind][p]!} k={KEY[kind][p]!} type="number" hint={hint}
    placeholder={d == null ? '' : tx('settings.weightFields.blankUses', { v0: d, v1: weightName(weightOf(c, kind)) })} />;
}

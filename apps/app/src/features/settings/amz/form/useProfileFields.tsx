import type { AmzFilterSetting, AmzProfileForm as Form } from '@tstag/core';
import type { Dispatch, SetStateAction } from 'react';

import { formStyles } from './formParts';
import { Check } from '../../../../ui/inputs/Check';
import { useTheme } from '../../../../ui/theme/Tweaks';

/** プロファイル編集の各まとまりで使う、値の書き換えとチェック・入力欄の形 */
export function useProfileFields(form: Form, setForm: Dispatch<SetStateAction<Form>>) {
  const { theme } = useTheme();
  const set = (k: string, v: unknown) => setForm((p) => ({ ...p, [k]: v }));
  const setBr = (k: 'a' | 'b' | 'h264', v: number) => setForm((p) => ({ ...p, bitrate: { ...p.bitrate, [k]: v } }));
  const setFlt = (k: keyof AmzFilterSetting, v: unknown) => setForm((p) => ({ ...p, filterSetting: { ...p.filterSetting, [k]: v } }));
  const fs = form.filterSetting;
  return {
    form, set, setBr, setFlt, fs,
    str: (k: string) => String(form[k] ?? ''),
    chk: (k: string, label: string, disabled?: boolean) => <Check on={!!form[k]} label={label} disabled={disabled} onPress={() => set(k, !form[k])} />,
    fchk: (k: keyof AmzFilterSetting, label: string) => <Check on={!!fs[k]} label={label} onPress={() => setFlt(k, !fs[k])} />,
    input: [formStyles.input, { borderColor: theme.line, backgroundColor: theme.surface, color: theme.ink }],
    mute: theme.mute,
  };
}

export type ProfileFields = ReturnType<typeof useProfileFields>;

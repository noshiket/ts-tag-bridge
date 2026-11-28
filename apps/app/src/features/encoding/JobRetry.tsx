import { retryStatesFor, type EncodeRow } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { JOB_RED, errText, wait } from './jobShared';
import { Select } from '../../ui/inputs/Select';
import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { useT } from '../../ui/i18n/I18n';

/** やり直し: 選んだ工程から（失敗した工程より先は選べない） */
export function JobRetry({ e, node, refresh }: { e: EncodeRow; node: string | null; refresh: () => Promise<unknown> }) {
  const { t: tx } = useT();
  const { theme } = useTheme();
  const api = useApi();
  const states = retryStatesFor(e.failedState);
  const [state, setState] = useState(states[0]!);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (!states.includes(state)) setState(states[0]!); }, [states.join(','), state]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = () => {
    setBusy(true);
    setErr('');
    api.encodes.retry(e.id, state, null, node).then(() => wait(3000)).then(() => refresh())
      .catch((x: unknown) => setErr(tx('encoding.jobRetry.retryFailed', { v0: errText(x) }))).finally(() => setBusy(false));
  };
  return (
    <View style={styles.mb14}>
      <View style={styles.row}>
        <View style={styles.sel}><Select value={state} options={states.map((s) => ({ value: s, label: s }))} onChange={setState} label={tx('encoding.jobRetry.stepRedo')} /></View>
        <Pressable onPress={go} disabled={busy}
          style={[styles.retry, { backgroundColor: busy ? theme.surface : theme.surface2, borderColor: theme.frame, opacity: busy ? 0.5 : 1 }]}>
          <T mono size={11} w={700}>{busy ? tx('encoding.jobRetry.working') : '↺ RETRY'}</T>
        </Pressable>
      </View>
      {!!err && <T mono size={10} color={JOB_RED} style={styles.mt4}>{err}</T>}
    </View>
  );
}

const styles = StyleSheet.create({
  mb14: { marginBottom: 14 },
  mt4: { marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sel: { minWidth: 130 },
  retry: { flex: 1, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5, alignItems: 'center' },
});

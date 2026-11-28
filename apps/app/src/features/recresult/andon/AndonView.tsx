import { splitEncodes, type EncodeRow } from '@tstag/core';
import { useEncodePause } from '@tstag/core/react';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AndonBelt } from './AndonBelt';
import { AndonBoard } from './AndonBoard';
import { AndonHistory } from './AndonHistory';
import { AndonRunning } from './AndonRunning';
import { GOTHIC } from '../../../ui/parts/Num';
import { T } from '../../../ui/parts/T';
import { useAppActive } from '../../../lib/lifecycle/appActive';
import { useT } from '../../../ui/i18n/I18n';

const pad = (n: number) => String(n).padStart(2, '0');
const localDay = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

/**
 * エンコードのアンドン表示（止まっていないか・異常が無いかが主役）。上に板（ランプと数）、実行中を大きく、
 * 待ちはベルトの順、下に実績。予定時刻は出さない（局・解像度・音声で速さが変わり当たらない）。実行中だけ実測の残り時間
 */
export function AndonView({ rows, node }: { rows: EncodeRow[]; node: string | null }) {
  const e = splitEncodes(rows);
  const { t: tx } = useT();
  const { paused, hiddenRunning, hiddenQueued } = useEncodePause(node);
  const running = e.queue.filter((x) => x.status === 'running');
  const waiting = e.queue.filter((x) => x.status === 'queued');
  // 残り時間を進める時計（実行中がある間・前にいる間だけ 10 秒ごと）
  const [now, setNow] = useState(() => Date.now());
  const appActive = useAppActive();
  useEffect(() => {
    if (!running.length || !appActive) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, [running.length, appActive]);
  const today = localDay(now);
  const doneToday = e.history.filter((x) => x.status === 'done' && x.updatedAt.slice(0, 10) === today).length;
  return (
    <View style={styles.wrap}>
      <View style={styles.pad}>
        <AndonBoard running={running.length + hiddenRunning > 0} paused={!!paused} waiting={waiting.length + hiddenQueued} done={doneToday} errors={e.errors} node={node} />
      </View>
      {/* 権限で見られない番組をエンコード中（一覧には出ないが、止まってはいない） */}
      {hiddenRunning > 0 && <Label>{tx('recresult.andon.hiddenRunning', { n: hiddenRunning })}</Label>}
      {running.map((x) => <View key={`${x.isAddon ? 'a' : 'e'}${x.id}`} style={styles.pad}><AndonRunning e={x} node={node} now={now} /></View>)}
      {(waiting.length > 0 || !hiddenQueued) && <Label>{waiting.length ? tx('recresult.andon.next', { n: waiting.length }) : tx('recresult.andon.noWaiting')}</Label>}
      {/* 権限で見られない番組の待ち（並びには出せないので数だけ） */}
      {hiddenQueued > 0 && <Label>{tx('recresult.andon.hiddenQueued', { n: hiddenQueued })}</Label>}
      {waiting.length > 0 && <AndonBelt items={waiting} node={node} />}
      <Label>{tx('recresult.andon.today', { n: doneToday })}</Label>
      <AndonHistory items={e.history} node={node} today={today} />
    </View>
  );
}

function Label({ children }: { children: string }) {
  return <T size={11} w={900} dim style={[GOTHIC, styles.label]}>{children}</T>;
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  pad: { paddingHorizontal: 18 },
  label: { paddingHorizontal: 18, marginTop: 4 },
});

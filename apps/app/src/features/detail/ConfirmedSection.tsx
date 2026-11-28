import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { oklch } from '../../ui/theme/oklch';
import { SectionTitle } from '../../ui/parts/SectionTitle';
import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { Card } from './Card';
import { ConfirmedEditor, type ConfirmedTarget } from './confirmed/ConfirmedEditor';
import { useT } from '../../ui/i18n/I18n';

const RED = oklch(0.6, 0.22, 25);

/**
 * 予約・録画の詳細の「解析確定値」: 再解析の2つのボタン（取り直して再解析つき）、確定値の編集、
 * 未マッチの時は再解析で送った中身（パターンのテストと結果が違う時に入力を突き合わせる）。元の detail_res / detail_rec と同じ
 */
export function ConfirmedSection({ target, unregistered, confirmed, tp, parserError, node, reparse, onChanged }: {
  /** null = まだ DB に無い */
  target: ConfirmedTarget | null;
  unregistered?: boolean;
  confirmed: Record<string, unknown> | null;
  tp: Record<string, unknown> | null;
  parserError: string[] | null | undefined;
  node: string | null;
  /** 再解析して、送った中身を返す。fresh: しょぼいカレンダーに問い合わせ直してから（規制中は後回し） */
  reparse: (fresh: boolean) => Promise<unknown>;
  /** 保存・再解析の後（詳細を取り直す） */
  onChanged: () => Promise<unknown> | void;
}) {
  const { t: tx } = useT();
  const { theme } = useTheme();
  const [reparsing, setReparsing] = useState<'cache' | 'fresh' | null>(null);
  const [msg, setMsg] = useState('');
  const [context, setContext] = useState<unknown>(null);
  const [reqOpen, setReqOpen] = useState(false);
  const run = async (fresh: boolean) => {
    setReparsing(fresh ? 'fresh' : 'cache'); setMsg(''); setReqOpen(false);
    try {
      setContext(await reparse(fresh));
      await onChanged();
      setMsg(tx('detail.confirmedSection.reparsed'));
      setTimeout(() => setMsg(''), 3000);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setReparsing(null);
    }
  };
  return (
    <View style={styles.section}>
      <SectionTitle>{tx('common.confirmedResult')}</SectionTitle>
      <Card flat>
        {unregistered || !target ? (
          <T mono size={12} dim style={styles.unreg}>{tx('detail.confirmedSection.notDbNotYet')}</T>
        ) : (
          <>
            <View style={[styles.reparse, { borderBottomColor: theme.line }]}>
              <Pressable onPress={() => void run(false)} disabled={!!reparsing}
                style={[styles.btn, { backgroundColor: reparsing ? theme.surface2 : theme.ink, borderColor: theme.frame }]}>
                <T mono size={11} w={800} color={reparsing ? theme.mute : theme.onInk}>{reparsing === 'cache' ? tx('detail.confirmedSection.reparsing') : tx('detail.confirmedSection.reparse')}</T>
              </Pressable>
              <Pressable onPress={() => void run(true)} disabled={!!reparsing}
                accessibilityLabel={tx('detail.confirmedSection.reQueryProgramCalendar')}
                style={[styles.btn, { backgroundColor: theme.surface, borderColor: reparsing ? theme.line : theme.frame }]}>
                <T mono size={11} w={700} color={reparsing ? theme.mute : theme.ink}>{reparsing === 'fresh' ? tx('detail.confirmedSection.refetching') : tx('common.refetchReparse')}</T>
              </Pressable>
              {!!msg && <T mono size={11} color={msg === tx('detail.confirmedSection.reparsed') ? oklch(0.6, 0.2, 145) : RED} style={styles.grow}>{msg}</T>}
            </View>
            <ConfirmedEditor target={target} confirmed={confirmed} tp={tp} parserError={parserError} node={node} onSaved={() => void onChanged()} />
            {!!parserError?.length && context != null && (
              <View style={[styles.req, { borderTopColor: theme.line }]}>
                <Pressable onPress={() => setReqOpen((o) => !o)} style={styles.reqHead}>
                  <T mono size={9} color={RED} style={styles.ls}>SENT REQUEST</T>
                  <T size={9} color={RED}>{reqOpen ? '▲' : '▼'}</T>
                </Pressable>
                {reqOpen && <T mono size={9} style={styles.pre}>{JSON.stringify(context, null, 2)}</T>}
              </View>
            )}
          </>
        )}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 16 },
  unreg: { textAlign: 'center', padding: 14 },
  reparse: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, paddingVertical: 10, paddingHorizontal: 14, borderBottomWidth: 1 },
  btn: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 9, borderWidth: 1.5 },
  grow: { flex: 1 },
  req: { paddingTop: 8, paddingBottom: 10, paddingHorizontal: 14, borderTopWidth: 1 },
  reqHead: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ls: { letterSpacing: 0.5 },
  pre: { marginTop: 6, padding: 8, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.15)' },
});

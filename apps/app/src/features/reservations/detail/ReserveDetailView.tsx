import { reserveTimes, type ReserveDetail } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { RecSettingSection } from './RecSettingSection';
import { ReserveActions, ReserveMoreSheet } from './ReserveActions';
import { ReserveHeaderCard } from './ReserveHeaderCard';
import { AutoAddRuleLink } from '../../detail/AutoAddRuleLink';
import { AutoEncodeRegister } from '../../detail/AutoEncodeRegister';
import { ConfirmedSection } from '../../detail/ConfirmedSection';
import { DuplicateVideos } from '../../detail/DuplicateVideos';
import { ParsePreview } from '../../detail/ParsePreview';
import { ProgramInfo } from '../../detail/ProgramInfo';
import { ShoboiInfoPanel } from '../../detail/ShoboiInfoPanel';
import { More } from '../../../ui/parts/Icons';
import { IconButton, TopBar } from '../../../ui/parts/TopBar';
import { useTheme } from '../../../ui/theme/Tweaks';
import { OverlapReserves } from '../OverlapReserves';
import { useT } from '../../../ui/i18n/I18n';

/**
 * 予約詳細の中身（元の detail_res.jsx）: 見出しのカード・同時刻の予約・しょぼいカレンダー・番組情報・自動予約ルール・
 * 解析の試し・確定値・録画設定・自動エンコード・操作・重複する動画。上端の「…」は EPG 同期
 */
export function ReserveDetailView({ r, node, back }: { r: ReserveDetail; node: string | null; back: () => void }) {
  const { t: tx } = useT();
  const api = useApi();
  const qc = useQueryClient();
  const { theme } = useTheme();
  const [moreOpen, setMoreOpen] = useState(false);
  const t = reserveTimes(r);

  return (
    <>
      <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={styles.content}>
        <TopBar title={tx('common.reservationDetails')} onBack={back}
          right={<IconButton title={tx('common.other')} onPress={() => setMoreOpen(true)}><More c={theme.ink} /></IconButton>} />
        <View style={styles.pad}>
          <ReserveHeaderCard r={r} />
          <OverlapReserves r={r} node={node} style={styles.section} />
          <ShoboiInfoPanel info={r.shoboi_info} />
          <ProgramInfo description={r.description} extendedInfo={r.extended_info} genre={r.genre} />
          <AutoAddRuleLink ruleId={r.rule_id} autoAddId={r.auto_add_id} node={node} />
          <ParsePreview node={node} ctxId={`R-${r.reserve_id}`} input={{
            title: r.title, sid: r.sid, onid: r.onid, tsid: r.tsid, service_name: r.station_name,
            // 元は予約の開始を 'YYYY-MM-DD HH:mm' で渡している
            start_time: t.start, description: r.description, extended_info: r.extended_info,
          }} />
          <ConfirmedSection unregistered={r.rule_id == null}
            target={r.rule_id != null ? { kind: 'rule', ruleId: r.rule_id } : null}
            confirmed={r.confirmed} tp={r.text_parser_result} parserError={r.parser_error} node={node}
            reparse={async (fresh) => (await api.confirmed.reparseRule(r.rule_id!, r.title, fresh, node)).text_parser_context ?? null}
            onChanged={() => qc.invalidateQueries({ queryKey: ['reserves', node ?? ''] })} />
          <RecSettingSection r={r} node={node} />
          <AutoEncodeRegister dbRecId={null} confirmed={r.confirmed} sid={r.sid} node={node} />
          <ReserveActions r={r} node={node} back={back} />
          <DuplicateVideos list={r.duplicate_info ?? []} node={node} />
        </View>
      </ScrollView>
      <ReserveMoreSheet r={r} node={node} open={moreOpen} onClose={() => setMoreOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 40 },
  pad: { paddingHorizontal: 18 },
  section: { marginTop: 16 },
});

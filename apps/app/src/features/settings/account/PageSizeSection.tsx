import { PAGE_SIZE_CHOICES } from '@tstag/core';
import { Pressable, StyleSheet, View } from 'react-native';

import { SectionTitle } from '../../../ui/parts/SectionTitle';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { Card } from '../parts';
import { useT } from '../../../ui/i18n/I18n';

/** 一覧の表示件数（元の PageSizeSettingRow）: アカウントの既定と、この端末だけの上書き */
export function PageSizeSection() {
  const { theme, accent, pageSize, accountPageSize, devicePageSize, setDevicePageSize, setTweak } = useTheme();
  const { t: tx } = useT();
  const chip = (key: string, on: boolean, label: string, onPress: () => void) => (
    <Pressable key={key} onPress={onPress}
      style={[styles.chip, { backgroundColor: on ? accent.primary : theme.surface, borderColor: on ? accent.primary : theme.line }]}>
      <T mono size={11} w={700} color={on ? '#fff' : theme.ink}>{label}</T>
    </Pressable>
  );
  return (
    <>
      <SectionTitle>{tx('settings.account.pageSize')}</SectionTitle>
      <Card pad>
        <T mono size={10} dim style={styles.mb8}>{tx('settings.account.pageSize.note')}</T>
        <T size={10} w={700} style={styles.mb5}>{tx('settings.account.pageSize.account')}</T>
        <View style={[styles.wrap, styles.mb12]}>
          {PAGE_SIZE_CHOICES.map((n) => chip(`a${n}`, accountPageSize === n, tx('common.count', { n }), () => setTweak('pageSize', n)))}
        </View>
        <T size={10} w={700} style={styles.mb5}>{tx('settings.account.pageSize.device')}</T>
        <View style={styles.wrap}>
          {chip('d0', !devicePageSize, tx('settings.account.pageSize.followDefault'), () => setDevicePageSize(null))}
          {PAGE_SIZE_CHOICES.map((n) => chip(`d${n}`, devicePageSize === n, tx('common.count', { n }), () => setDevicePageSize(n)))}
        </View>
        <T mono size={9} dim style={styles.mt8}>{tx('settings.account.pageSize.current', { n: pageSize, where: tx(devicePageSize ? 'settings.account.pageSize.whereDevice' : 'settings.account.pageSize.whereAccount') })}</T>
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  mt8: { marginTop: 8 },
  mb5: { marginBottom: 5 },
  mb8: { marginBottom: 8 },
  mb12: { marginBottom: 12 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingVertical: 5, paddingHorizontal: 11, borderRadius: 8, borderWidth: 1.5 },
});

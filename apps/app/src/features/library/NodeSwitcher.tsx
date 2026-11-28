import { useNodes } from '@tstag/core/react';
import { StyleSheet, View } from 'react-native';

import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { useT } from '../../ui/i18n/I18n';

const styles = StyleSheet.create({
  badge: { marginLeft: 10, paddingVertical: 3, paddingHorizontal: 9, borderRadius: 8, borderWidth: 1.5 },
});

/** どのサーバーのものを見ているかだけ示す札（元の NodeBadge。切り替えはしない）。他のサーバーが無ければ出さない */
export function NodeBadge({ node }: { node: string | null }) {
  const { t: tx } = useT();
  const nodes = useNodes();
  const { theme, accent } = useTheme();
  if (!nodes.data?.nodes?.length) return null;
  return (
    <View style={[styles.badge, { borderColor: theme.frame, backgroundColor: node ? accent.primary : theme.surface }]}>
      <T mono w={700} size={10} color={node ? '#fff' : theme.mute}>{node || tx('nav.ownServer')}</T>
    </View>
  );
}

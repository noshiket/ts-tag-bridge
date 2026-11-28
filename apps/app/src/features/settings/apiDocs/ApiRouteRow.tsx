import { API_AUTH_LABEL, type ApiRoute } from '@tstag/core';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { oklch } from '../../../ui/theme/oklch';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

const METHOD_COLOR: Record<string, string> = {
  GET: oklch(0.55, 0.15, 250), POST: oklch(0.55, 0.15, 150), PUT: oklch(0.6, 0.18, 70),
  PATCH: oklch(0.6, 0.18, 70), DELETE: oklch(0.55, 0.22, 25),
};

/** API の口の1行。押すと説明書きの全文・呼べる人・中の関数を開く */
export function ApiRouteRow({ route }: { route: ApiRoute }) {
  const { t: tx } = useT();
  const { theme } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <Pressable onPress={() => setOpen(!open)} style={[styles.row, { borderBottomColor: theme.line }]}>
      <View style={styles.head}>
        {route.methods.map((m) => (
          <View key={m} style={[styles.method, { borderColor: METHOD_COLOR[m] ?? theme.mute }]}>
            <T mono size={8} w={700} color={METHOD_COLOR[m] ?? theme.mute}>{m}</T>
          </View>
        ))}
        <T mono size={10} w={700} style={styles.path} selectable>{route.path}</T>
      </View>
      <T size={10} dim numberOfLines={open ? undefined : 1}>{route.summary || tx('settings.apiRouteRow.noDescription')}</T>
      {open && (
        <View style={[styles.detail, { backgroundColor: theme.surface2 }]}>
          <T mono size={9} dim>
            {API_AUTH_LABEL[route.auth]}
            {route.relay ? tx('settings.apiRouteRow.relayableOtherServersName') : ''}
          </T>
          {route.doc.includes('\n') && <T size={10} selectable style={styles.doc}>{route.doc}</T>}
          <T mono size={8} dim selectable>{route.source}</T>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: 8, paddingHorizontal: 12, borderBottomWidth: 1, gap: 3 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  method: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 },
  path: { flexShrink: 1 },
  detail: { marginTop: 4, padding: 8, borderRadius: 6, gap: 6 },
  doc: { lineHeight: 16 },
});

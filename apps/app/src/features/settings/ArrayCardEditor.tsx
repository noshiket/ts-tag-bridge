import type { ReactNode } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { oklch } from '../../ui/theme/oklch';
import { T } from '../../ui/parts/T';
import { monoFamily } from '../../ui/theme/theme';
import { useTheme } from '../../ui/theme/Tweaks';
import { useT } from '../../ui/i18n/I18n';

type Item = Record<string, unknown>;

/**
 * 一覧の設定（EDCB サーバー・連携先など）の編集（元の ArrayCardEditor）。よく触る項目は1行の入力。
 * 入れ子の項目（場所の対応など）は renderExtra で、それぞれ行で書く・選ぶ部品を出す（JSON は書かせない）
 */
export function ArrayCardEditor({ items, onChange, fields, newItem, renderExtra }: {
  items: Item[];
  onChange: (items: Item[]) => void;
  fields: { key: string; label: string; placeholder?: string }[];
  newItem: Item;
  renderExtra?: (it: Item, idx: number) => ReactNode;
}) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();

  const update = (idx: number, key: string, v: unknown) => onChange(items.map((it, i) => (i === idx ? { ...it, [key]: v } : it)));
  const input = [styles.input, { backgroundColor: theme.surface2, borderColor: theme.line, color: theme.ink }];

  return (
    <View>
      {items.map((it, idx) => (
        <View key={idx} style={[styles.item, { borderBottomColor: theme.line }]}>
          <View style={styles.itemHead}>
            <T mono size={9} w={800} dim>{`#${idx + 1}`}</T>
            <Pressable onPress={() => onChange(items.filter((_, i) => i !== idx))}><T mono size={9} w={700} color={oklch(0.6, 0.22, 25)}>{tx('reservations.list.sheet.delete')}</T></Pressable>
          </View>
          {fields.map((f) => (
            <View key={f.key} style={styles.field}>
              <T mono size={9} dim style={styles.label}>{f.label}</T>
              <TextInput value={it[f.key] == null ? '' : String(it[f.key])} onChangeText={(v) => update(idx, f.key, v)} placeholder={f.placeholder || ''}
                placeholderTextColor={theme.mute} autoCapitalize="none" autoCorrect={false} style={[input, styles.grow]} />
            </View>
          ))}
          {renderExtra?.(it, idx)}
        </View>
      ))}
      <Pressable onPress={() => onChange([...items, { ...newItem }])} style={[styles.add, items.length > 0 && { borderTopWidth: 1, borderTopColor: theme.line }]}>
        <T mono size={10} w={700} color={accent.primary}>{tx('common.add')}</T>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  item: { paddingVertical: 10, paddingHorizontal: 13, borderBottomWidth: 1 },
  itemHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  field: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  label: { width: 56 },
  grow: { flex: 1 },
  input: { paddingVertical: 5, paddingHorizontal: 8, borderRadius: 8, borderWidth: 1, fontSize: 11, fontFamily: monoFamily[400] },
  add: { padding: 9, alignItems: 'center' },
});

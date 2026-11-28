import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type StyleProp, type TextStyle } from 'react-native';

import { T } from '../parts/T';
import { useTheme } from '../theme/Tweaks';

/**
 * 候補つきの入力（Web の <input list> + <datalist> の代わり）。入っている間、打った文字を含む候補を下に出し、押すとその値にする。
 * 一覧に無いものもそのまま打てる
 */
export function SuggestInput({ value, onChangeText, options, placeholder, style }: {
  value: string; onChangeText: (v: string) => void; options: string[]; placeholder?: string; style?: StyleProp<TextStyle>;
}) {
  const { theme } = useTheme();
  const [focused, setFocused] = useState(false);
  const q = value.trim().toLowerCase();
  const items = focused ? options.filter((o) => o !== value && (!q || o.toLowerCase().includes(q))).slice(0, 8) : [];
  return (
    <View style={styles.wrap}>
      <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={theme.mute} autoCorrect={false} autoCapitalize="none"
        onFocus={() => setFocused(true)} onBlur={() => setTimeout(() => setFocused(false), 200)} style={[{ color: theme.ink }, style]} />
      {items.length > 0 && (
        <View style={[styles.list, { backgroundColor: theme.surface, borderColor: theme.frame }]}>
          {items.map((o) => (
            <Pressable key={o} onPress={() => { onChangeText(o); setFocused(false); }} style={[styles.item, { borderBottomColor: theme.line }]}>
              <T size={12} numberOfLines={1}>{o}</T>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative', zIndex: 50 },
  list: { position: 'absolute', top: '100%', marginTop: 3, left: 0, right: 0, zIndex: 50, borderWidth: 1.5, borderRadius: 9, overflow: 'hidden', boxShadow: '0px 8px 24px rgba(0,0,0,0.3)' },
  item: { paddingVertical: 9, paddingHorizontal: 10, borderBottomWidth: 1 },
});

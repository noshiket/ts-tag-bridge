import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';

/**
 * 重ねて出す画面（Modal）の中身を、キーボードの上へ持ち上げる。画面の下に付くシートは、中の ScrollView が
 * キーボードの分を空けてもシート自体が下に残り、入力欄がキーボードに隠れていた（フォルダ名の変更など）
 */
export function KeyboardLift({ children }: { children: ReactNode }) {
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fill}>
      {children}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });

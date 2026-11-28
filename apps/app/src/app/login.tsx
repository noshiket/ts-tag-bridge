// ログイン / 初回登録（元の Web 版の auth.jsx と同じ見た目。テーマによらず暗い画面）
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { useSession } from '../session/SessionProvider';
import { T } from '../ui/parts/T';
import { ACCENTS } from '../ui/theme/theme';
import { useT } from '../ui/i18n/I18n';

const C = {
  bg: '#0E0B14',
  ink: '#F6F1FF',
  mute: 'rgba(246,241,255,0.5)',
  line: 'rgba(246,241,255,0.10)',
  field: 'rgba(246,241,255,0.06)',
  primary: ACCENTS.magenta.primary,
  // oklch(0.60 0.20 145 / 0.15) と (0.80 0.16 145)
  noticeBg: 'rgba(0,157,30,0.15)', noticeText: '#75D87A',
  // oklch(0.55 0.25 25 / 0.15) と (0.80 0.18 25)
  errorBg: 'rgba(223,0,13,0.15)', errorText: '#FF8981',
};

export default function LoginScreen() {
  const { t: tx } = useT();
  const { signIn, register, needsServerUrl, lastServerUrl } = useSession();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  // 前に入ったサーバーを入れておく（ログアウトしても打ち直さなくて済むように）
  const [serverUrl, setServerUrl] = useState(lastServerUrl);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (loading) return;
    if (needsServerUrl && !serverUrl.trim()) { setError(tx('screens.login.enterServer')); return; }
    if (!username.trim() || !password.trim()) { setError(tx('screens.login.enterUserNamePassword')); return; }
    setLoading(true);
    setError('');
    setNotice('');
    try {
      if (mode === 'login') {
        await signIn(serverUrl, username.trim(), password);
      } else {
        // 2人目以降の登録は承認待ち。まだログインさせない
        const pending = await register(serverUrl, username.trim(), password);
        if (pending != null) { setMode('login'); setPassword(''); setNotice(pending || tx('screens.login.pending')); }
      }
    } catch (e) {
      setError(e instanceof TypeError ? tx('screens.login.cantConnectServer') : e instanceof Error ? e.message : tx('screens.login.errorOccurred'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.center}>
        <View style={styles.box}>
          <View style={styles.logo}>
            <T mono w={700} size={11} color={C.mute} style={styles.brand}>TS TAG BRIDGE</T>
            <T w={700} size={22} color={C.ink}>{mode === 'login' ? tx('common.sign') : tx('screens.login.createAccount')}</T>
            {mode === 'register' && (
              <T mono size={11} color={C.mute} style={styles.hint}>
                {tx('screens.login.firstUserBecomesAdmin')}
              </T>
            )}
          </View>
          <View style={styles.form}>
            {needsServerUrl && (
              <Field placeholder={tx('screens.login.serverHttps8082')} value={serverUrl} onChangeText={setServerUrl} keyboardType="url" textContentType="URL" />
            )}
            <Field placeholder={tx('screens.login.userName')} value={username} onChangeText={setUsername} textContentType="username" autoComplete="username" />
            <Field placeholder={tx('screens.login.password')} value={password} onChangeText={setPassword} secureTextEntry onSubmitEditing={submit}
              textContentType={mode === 'login' ? 'password' : 'newPassword'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
            {!!notice && <T mono size={13} color={C.noticeText} style={[styles.msg, { backgroundColor: C.noticeBg }]}>{notice}</T>}
            {!!error && <T mono size={13} color={C.errorText} style={[styles.msg, { backgroundColor: C.errorBg }]}>{error}</T>}
            <Pressable onPress={submit} disabled={loading} style={[styles.button, { backgroundColor: loading ? 'rgba(246,241,255,0.1)' : C.primary, opacity: loading ? 0.7 : 1 }]}>
              <T w={700} size={15} color="#fff">{loading ? '...' : mode === 'login' ? tx('common.sign') : tx('screens.login.createAccount')}</T>
            </Pressable>
          </View>
          <Pressable onPress={() => { setMode((m) => (m === 'login' ? 'register' : 'login')); setError(''); setNotice(''); }} style={styles.switch}>
            <T mono size={13} color={C.mute}>{mode === 'login' ? tx('screens.login.createAccount2') : tx('screens.login.backSign')}</T>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function Field(props: React.ComponentProps<typeof TextInput>) {
  return (
    <TextInput autoCapitalize="none" autoCorrect={false} placeholderTextColor={C.mute}
      style={[styles.input, Platform.OS === 'web' && styles.inputWeb]} {...props} />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  box: { width: '100%', maxWidth: 360, paddingHorizontal: 24 },
  logo: { alignItems: 'center', marginBottom: 36 },
  brand: { letterSpacing: 2, marginBottom: 6 },
  hint: { marginTop: 6, textAlign: 'center' },
  form: { gap: 12 },
  input: {
    paddingVertical: 12, paddingHorizontal: 14, borderRadius: 10, backgroundColor: C.field,
    color: C.ink, borderWidth: 1.5, borderColor: C.line, fontSize: 15,
  },
  inputWeb: { fontFamily: "'Noto Sans JP', 'Space Grotesk', system-ui, sans-serif" },
  msg: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, overflow: 'hidden' },
  button: { paddingVertical: 13, borderRadius: 12, marginTop: 4, alignItems: 'center' },
  switch: { alignItems: 'center', marginTop: 20 },
});

import { focusManager, QueryClient } from '@tanstack/react-query';
import { AppState, Platform } from 'react-native';

// アプリが前に戻った時に、古くなった一覧を取り直す（Web はブラウザの visibility で同じことが起きる）
if (Platform.OS !== 'web') {
  focusManager.setEventListener((setFocused) => {
    const sub = AppState.addEventListener('change', (s) => setFocused(s === 'active'));
    return () => sub.remove();
  });
}

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // 一覧は30秒は取り直さない。前に戻った時・再接続した時は古ければ取り直す
        staleTime: 30_000,
        // 通信が落ちた時の取り直しは ApiClient が行うので、ここでは重ねない
        retry: false,
      },
    },
  });
}

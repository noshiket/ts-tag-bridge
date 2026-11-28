import { AppState } from 'react-native';

/** 画面が前に出るまで待つ。背面にいる間に取り直しても止められるだけなので */
export function waitUntilActive(): Promise<void> {
  if (AppState.currentState === 'active') return Promise.resolve();
  return new Promise((resolve) => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      sub.remove();
      resolve();
    });
  });
}

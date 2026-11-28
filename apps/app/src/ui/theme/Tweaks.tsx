import { usePatchPrefs, usePrefs } from '@tstag/core/react';
import { DEVICE_PAGE_SIZE_KEY, parseDevicePageSize, resolvePageSize } from '@tstag/core';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { deviceStore } from '../../lib/device/deviceStore';

import { useSession } from '../../session/SessionProvider';
import { loadThemeFaces } from './fonts';
import { ACCENTS, DEFAULT_TWEAKS, THEMES, type Accent, type AccentKey, type Theme, type ThemeKey } from './theme';

// テーマ・アクセント色・一覧の件数。元の Web 版と同じくアカウントの設定（prefs.tweaks）に置き、
// どの端末でも同じ見た目にする。ログイン前は既定の色。一覧の件数だけは、この端末だけの上書きもできる

interface TweaksValue {
  theme: Theme;
  accent: Accent;
  themeKey: ThemeKey;
  accentKey: AccentKey;
  /** 使う件数（この端末の上書きがあればそれ） */
  pageSize: number;
  /** アカウントの既定の件数 */
  accountPageSize: number;
  /** この端末だけの件数（null はアカウントの既定に従う） */
  devicePageSize: number | null;
  setDevicePageSize: (n: number | null) => void;
  /** 番組表の表示（grid / list / week。アカウントに置くので他の端末でも最後に選んだ表示で開く。元と同じ） */
  epgView: EpgView;
  /** ミュージックの一覧の表示（list / grid。アカウントに置く。元と同じ） */
  musicView: 'list' | 'grid';
  /** 予約一覧の表示（card: 標準 / poster: テロップ / table: テレビ欄。アカウントに置く） */
  reserveView: ReserveView;
  /** 録画結果の表示（card: 標準 / qc: 検査票 / sheet: コンタクトシート。アカウントに置く） */
  recView: RecView;
  /** ライブラリのアルバムの表示（card: 標準 / tile: タイル / stack: 重ね。アカウントに置く） */
  albumView: AlbumView;
  /** 表示言語（'ja' か、言語アドオンのコード。アカウントに置く） */
  lang: string;
  /** エンコード進捗の見せ方（元の Tweaks の Progress style。既定は ring） */
  progressStyle: ProgressStyle;
  setTweak: (key: TweakKey, value: string | number) => void;
}

export type EpgView = 'grid' | 'list' | 'week';
export type ProgressStyle = 'bar' | 'ring' | 'steps';
export type ReserveView = 'card' | 'poster' | 'table';
export type RecView = 'card' | 'qc' | 'sheet';
export type AlbumView = 'card' | 'tile' | 'stack';
type TweakKey = 'theme' | 'accent' | 'pageSize' | 'epgView' | 'musicView' | 'reserveView' | 'recView' | 'albumView' | 'lang' | 'progressStyle';

const TweaksContext = createContext<TweaksValue | null>(null);

export function TweaksProvider({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const prefs = usePrefs(status === 'signedIn');
  const patch = usePatchPrefs();
  const t = (status === 'signedIn' && prefs.data?.tweaks) || {};
  const themeKey = (t.theme && t.theme in THEMES ? t.theme : DEFAULT_TWEAKS.theme) as ThemeKey;
  const accentKey = (t.accent && t.accent in ACCENTS ? t.accent : DEFAULT_TWEAKS.accent) as AccentKey;
  useEffect(() => loadThemeFaces(THEMES[themeKey]), [themeKey]);
  const [devicePageSize, setDevice] = useState(() => parseDevicePageSize(deviceStore.get(DEVICE_PAGE_SIZE_KEY)));
  const setDevicePageSize = useCallback((n: number | null) => {
    // 消す API が無いので空にする（読む時に選べる数でなければ無しになる）
    deviceStore.set(DEVICE_PAGE_SIZE_KEY, n ? String(n) : '');
    setDevice(n);
  }, []);
  const accountPageSize = resolvePageSize(t.pageSize, null);
  const pageSize = resolvePageSize(t.pageSize, devicePageSize);
  const epgView: EpgView = t.epgView === 'list' || t.epgView === 'week' ? t.epgView : 'grid';
  const musicView: 'list' | 'grid' = t.musicView === 'grid' ? 'grid' : 'list';
  const reserveView: ReserveView = t.reserveView === 'poster' || t.reserveView === 'table' ? t.reserveView : 'card';
  const recView: RecView = t.recView === 'sheet' || t.recView === 'qc' ? t.recView : 'card';
  const albumView: AlbumView = t.albumView === 'tile' || t.albumView === 'stack' ? t.albumView : 'card';
  const lang = typeof t.lang === 'string' && t.lang ? t.lang : 'ja';
  const progressStyle: ProgressStyle = t.progressStyle === 'bar' || t.progressStyle === 'steps' ? t.progressStyle : 'ring';

  const { mutate } = patch;
  const setTweak = useCallback(
    (key: TweakKey, value: string | number) => mutate({ tweaks: { [key]: value } }),
    [mutate],
  );
  const value = useMemo(
    () => ({
      theme: THEMES[themeKey], accent: ACCENTS[accentKey], themeKey, accentKey, pageSize, accountPageSize, devicePageSize, setDevicePageSize, epgView, musicView, reserveView, recView, albumView, lang, progressStyle, setTweak,
    }),
    [themeKey, accentKey, pageSize, accountPageSize, devicePageSize, setDevicePageSize, epgView, musicView, reserveView, recView, albumView, lang, progressStyle, setTweak],
  );
  return <TweaksContext.Provider value={value}>{children}</TweaksContext.Provider>;
}

export function useTheme(): TweaksValue {
  const v = useContext(TweaksContext);
  if (!v) throw new Error('TweaksProvider の外で useTheme を呼んでいます');
  return v;
}

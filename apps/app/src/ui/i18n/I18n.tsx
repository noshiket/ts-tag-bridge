import { JA, translate, type Messages, type MsgKey, type Vars } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useQuery } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';

import { useSession } from '../../session/SessionProvider';
import { useTheme } from '../theme/Tweaks';
import { I18N_KEY } from './i18nKey';

type Dict = { code: string; messages: Messages };

/** 文を引く関数（部品の外の関数へ渡す時の型） */
export type Tr = (key: MsgKey, vars?: Vars) => string;

interface I18nValue {
  /** 今の言語（'ja' か言語アドオンのコード） */
  lang: string;
  /** 文を引く（訳が無ければ日本語） */
  t: Tr;
}
const I18nContext = createContext<I18nValue | null>(null);

/** 部品の外（関数・送信の知らせなど）から引く時の辞書。I18nProvider が描くたびに今の言語のものへ替える */
let currentDict: Messages | null = null;
/** 部品の外で文を引く（呼んだ時の言語。ファイルの読み込み時に作る定数には使わない） */
export const tNow: Tr = (key, vars) => translate(JA, currentDict, key, vars);

/**
 * 表示言語。言語はアカウントの設定（tweaks.lang）、日本語以外の辞書はサーバーの言語アドオンから取る。
 * ログイン前は、最後に使った言語（端末の控え）で出す
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const { status } = useSession();
  const { lang: chosen } = useTheme();
  const q = useQuery<Dict>({
    queryKey: I18N_KEY, staleTime: 10 * 60_000, enabled: status === 'signedIn',
    queryFn: async () => (chosen === 'ja' ? { code: 'ja', messages: {} } : api.i18n.messages(chosen)),
  });
  // 言語を変えたら辞書を取り直す（キーは 1 つにして、控えに今の言語だけを残す）
  const { refetch } = q;
  const held = q.data?.code;
  useEffect(() => { if (status === 'signedIn' && held !== chosen) void refetch(); }, [status, chosen, held, refetch]);
  const lang = status === 'signedIn' ? chosen : (held ?? 'ja');
  const dict = held === lang ? q.data!.messages : null;
  currentDict = dict;
  const t = useCallback((key: MsgKey, vars?: Vars) => translate(JA, dict, key, vars), [dict]);
  const value = useMemo(() => ({ lang, t }), [lang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * core の名前表（状態の名前など）を表示言語で。辞書に「ns.k」があればそれ、無ければ表の日本語、それも無ければ k
 */
export function trLabel(tr: Tr, ns: string, k: string | number, table?: Record<string | number, string>): string {
  const key = `${ns}.${k}`;
  return key in JA ? tr(key as MsgKey) : (table?.[k] ?? String(k));
}

/**
 * core の日本語の日付・時間の書き方（1時間30分・5分・12秒・(火)）を、表示言語の辞書の書き方に直す。日本語ならそのまま
 */
export function localizeFmt(s: string): string {
  if (!currentDict) return s;
  const week = tNow('date.week').split(',');
  return s.replace(/(\d+)時間(\d+)分/g, (_, h, m) => tNow('fmt.hm', { h, m }))
    .replace(/(\d+)時間/g, (_, n) => tNow('fmt.h', { n }))
    .replace(/(\d+)分(\d+)秒/g, (_, m, sec) => tNow('fmt.ms', { m, s: sec }))
    .replace(/(\d+)分/g, (_, n) => tNow('unit.min', { n }))
    .replace(/(\d+)秒/g, (_, n) => tNow('fmt.s', { n }))
    .replace(/([(（])([日月火水木金土])([)）])/g, (_, a, d, b) => `${a}${week['日月火水木金土'.indexOf(d)]}${b}`);
}

export function useT(): I18nValue {
  const v = useContext(I18nContext);
  if (!v) throw new Error('I18nProvider の外で useT を呼んでいます');
  return v;
}

/** ログインしたままにしておく情報。Web は serverUrl が ''（同じ場所）で token が無い */
export interface Saved {
  serverUrl: string;
  token: string | null;
}

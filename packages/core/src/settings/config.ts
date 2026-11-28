// 設定の「アプリ」のサーバー設定（config.yml）の編集。元の Web 版の SettingsApp と同じ決め方。
// 変えた項目だけ dirty に 'a.b.c' のキーで持ち、保存はその分だけ PATCH /api/config で送る

/** サーバーが秘密の値の代わりに返す印 */
export const SECRET_MASK = '********';

export type Config = Record<string, unknown>;
export type ConfigDirty = Record<string, unknown>;

export function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), obj);
}

/** 今の値（変えていればその値。無ければ ''） */
export function configValue(cfg: Config | null, dirty: ConfigDirty, key: string): unknown {
  if (key in dirty) return dirty[key];
  return getPath(cfg, key) ?? '';
}

/** JSON として読めるか */
export function isJson(text: string): boolean {
  try { JSON.parse(text); return true; } catch { return false; }
}

/** 作業ディレクトリの候補（上から使う）。無ければ tmp_base 1つ */
export function tmpBaseListOf(cfg: Config | null, dirty: ConfigDirty): string[] {
  if ('tmp_base_list' in dirty) return dirty.tmp_base_list as string[];
  const l = cfg?.tmp_base_list as string[] | undefined;
  if (l?.length) return l;
  return typeof cfg?.tmp_base === 'string' && cfg.tmp_base ? [cfg.tmp_base] : [];
}

/** 一覧の項目（変えていればその値） */
export const configList = <T>(cfg: Config | null, dirty: ConfigDirty, key: string): T[] =>
  (key in dirty ? dirty[key] : getPath(cfg, key) ?? []) as T[];

/** 並べ替え（はみ出す時はそのまま） */
export function moveItem<T>(list: T[], idx: number, d: -1 | 1): T[] {
  const j = idx + d;
  if (j < 0 || j >= list.length) return list;
  const n = [...list];
  [n[idx], n[j]] = [n[j]!, n[idx]!];
  return n;
}

/** サーバー間連携の今の状態（送り先があれば送る側、合言葉だけなら受ける側） */
export function federationRole(get: (k: string) => unknown): { role: 'sender' | 'receiver' | 'off'; label: string } {
  if (get('federation.library_peer.url')) {
    const name = get('federation.library_peer.name');
    return { role: 'sender', label: `📤 送る側 — 保存先に「master」を選んだ動画を${name ? `「${name}」` : '送り先'}へ送ります` };
  }
  if (get('federation.fed_token')) return { role: 'receiver', label: '📥 受ける側 — 合言葉の合う他のサーバーから、動画を受け取ったり見られたりします' };
  return { role: 'off', label: '連携していません' };
}

/** TLS 検証（'false' か false の時だけ切る） */
export const verifyTls = (v: unknown) => v !== 'false' && v !== false;

// ── アプリのログ ──

export interface LogEntry { time: string; level: string; name: string; message: string }
export const LOG_LEVELS = ['ALL', 'DEBUG', 'INFO', 'WARNING', 'ERROR'] as const;
/** ログから予約・録画へ飛べるか（'reserve 123' / 'recording_id=45'） */
export function logLink(message: string | undefined): { kind: 'reserve' | 'recording'; id: number } | null {
  const r = message?.match(/\breserve (\d+)\b/);
  if (r) return { kind: 'reserve', id: Number(r[1]) };
  const c = message?.match(/\brecording_id=(\d+)\b/);
  return c ? { kind: 'recording', id: Number(c[1]) } : null;
}

// ── 音声解析の順番待ち ──

export interface AudioJob {
  id: string; state: 'running' | 'queued' | 'done' | 'error' | string; kind?: string; queue_position?: number | null;
  title?: string; episode_number?: string | null; source_name?: string | null; video_id?: number; last_log?: string | null; error?: string | null;
}
const KIND: Record<string, [string, string]> = {
  full: ['取り込み', '比較→ずれ測定→映像確認→取り込み'],
  audio_only: ['音声のみ取り込み', '音声比較だけで取り込み(500ms刻み)'],
  compare: ['比較のみ', '音声の比較のみ'],
  frame_sync: ['ずれ測定', 'ずれの測定のみ'],
  music_import: ['音楽取り込み', '音楽の取り込み(再生用MP4へ変換して登録)'],
  thumbnail: ['サムネ再生成', 'サムネイルの作り直し'],
};
export const audioJobKind = (j: AudioJob) => ({ label: KIND[j.kind ?? '']?.[0] ?? j.kind ?? '', hint: KIND[j.kind ?? '']?.[1] ?? '' });
export const audioJobState = (j: AudioJob) =>
  j.state === 'running' ? '実行中' : j.state === 'queued' ? `順番待ち${j.queue_position || ''}` : j.state === 'done' ? '完了' : 'エラー';
/** 何の解析か（題名 #話 ← 取り込み元） */
export const audioJobTitle = (j: AudioJob) =>
  `${j.title || `video ${j.video_id}`}${j.episode_number ? ` #${j.episode_number}` : ''}${j.source_name ? ` ← ${j.source_name}` : ''}`;
/** 右の短い状態（エラーならその文、他は最後のログから時刻を除いたもの） */
export const audioJobNote = (j: AudioJob) => (j.state === 'error' ? j.error || '' : (j.last_log || '').replace(/^\[\d\d:\d\d:\d\d\]\s*/, ''));

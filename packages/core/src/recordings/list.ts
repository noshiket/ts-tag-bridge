// 録画結果の一覧（元の Web 版の recresult.jsx / history.jsx と同じ決め方）。絞り込みと数えるのはサーバーがする
import type { DuplicateVideo, Recording, RecordingDetail } from './types';

export interface RecFilters {
  station: string;
  genre: string;
  /** YYYY-MM-DD */
  date: string;
  folder: 'all' | 'with' | 'without';
  ep: 'all' | 'multi' | 'single' | 'none';
  recStatus: 'all' | number;
  state: string;
  parserErr: 'all' | 'yes' | 'no';
  /** 既定は「有」（ファイルの無い録画は普段は見ない） */
  fileExist: 'all' | 'yes' | 'no' | 'unscanned';
  drop: 'all' | 'yes' | 'no';
  text: string;
}

export const DEFAULT_REC_FILTERS: RecFilters = {
  station: '', genre: '', date: '', folder: 'all', ep: 'all', recStatus: 'all', state: 'all',
  parserErr: 'all', fileExist: 'yes', drop: 'all', text: '',
};

/** 既定から変えている絞り込みの数（「絞込」の数字） */
export const activeRecFilterCount = (f: RecFilters) => [
  f.station !== '', f.genre !== '', f.date !== '', f.folder !== 'all', f.ep !== 'all', f.recStatus !== 'all', f.state !== 'all',
  f.parserErr !== 'all', f.fileExist !== 'yes', f.drop !== 'all', f.text !== '',
].filter(Boolean).length;

/** サーバーへ渡す条件（GET /api/recordings/augmented の問い合わせ） */
export function recordingsQuery(f: RecFilters, page: number, perPage: number): string {
  const q = new URLSearchParams({ page: String(page), per_page: String(perPage) });
  if (f.station) q.set('station', f.station);
  if (f.genre) q.set('genre', f.genre);
  if (f.date) q.set('date', f.date);
  if (f.folder !== 'all') q.set('folder', f.folder);
  if (f.ep !== 'all') q.set('ep', f.ep);
  if (f.recStatus !== 'all') q.set('rec_status', String(f.recStatus));
  if (f.state !== 'all') q.set('state', f.state);
  if (f.parserErr !== 'all') q.set('parser_err', f.parserErr);
  if (f.fileExist !== 'all') q.set('file_exist', f.fileExist);
  if (f.drop !== 'all') q.set('drop', f.drop);
  if (f.text) q.set('q', f.text);
  return q.toString();
}

/** EDCB の録画の状態の名前 */
export const REC_STATUS_LABELS: Record<number, string> = { 0: '録画中', 1: '正常', 2: 'エラー', 3: '中断', 4: 'スキップ' };

/** このアプリの処理の段階の名前（この並びが処理の順） */
export const REC_STATE_LABELS: Record<string, string> = {
  pending: '処理待', scanning: '解析中', found: '検出', non_file: 'ファイル無', waiting: '待機', queued: 'キュー',
  encoding: 'エンコ中', encode_finish: '完了', encode_error: '失敗', error: 'エラー', skipped: 'スキップ',
};

/** 段階を処理の順に（知らないものは後ろに名前順） */
export function sortRecStates(states: string[]): string[] {
  const order = Object.keys(REC_STATE_LABELS);
  return [...states].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });
}

/** 局を件数の多い順に */
export const stationsByCount = (m: Record<string, number> = {}) => Object.entries(m).sort((a, b) => b[1] - a[1]);

/** 実況の勢い（1分あたりのコメント数） */
export const commentsPerMin = (count: number | null | undefined, durationSec: number | null | undefined) =>
  count != null && durationSec && durationSec > 0 ? Math.round(count / (durationSec / 60)) : null;

/**
 * カードに添える重複の動画（多い時は3件まで）。勢いが最大のものと、同じ局(SID)のものを先に選ぶ
 * （先頭から2件だと見たい局の回が落ちる。元と同じ）
 */
export function pickDuplicates(r: Pick<Recording, 'sid' | 'duplicate_info'>): DuplicateVideo[] {
  const dups = r.duplicate_info || [];
  if (dups.length <= 2) return dups;
  const per = (d: DuplicateVideo) => commentsPerMin(d.comment_count, d.duration_sec) ?? -1;
  const picked: DuplicateVideo[] = [];
  const top = [...dups].sort((a, b) => per(b) - per(a))[0];
  if (top) picked.push(top);
  for (const d of dups) {
    if (String(d.sid ?? '') !== String(r.sid ?? '')) continue;
    if (!picked.some((x) => x.id === d.id)) picked.push(d);
  }
  return picked.slice(0, 3);
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const stamp = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** 開始・終了（端末の時刻で 'YYYY-MM-DD HH:mm'）と長さ（分）。番組の終わりが分かればそれを使う（元と同じ） */
export function recordingTimes(r: Pick<RecordingDetail, 'start_time' | 'duration_sec' | 'eit_end_time'>) {
  if (!r.start_time) return { start: '', end: '', durationMin: 0 };
  const start = Date.parse(r.start_time);
  const end = r.eit_end_time ? Date.parse(r.eit_end_time) : start + (r.duration_sec || 0) * 1000;
  return { start: stamp(start), end: stamp(end), durationMin: Math.round((end - start) / 60000) };
}

/** ファイルの大きさ（1GB からは小数1桁の GB、それ未満は MB） */
export function fileSizeLabel(bytes: number | null | undefined): string {
  if (!bytes) return '';
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

/** 再生時間（HH:MM:SS.mmm） */
export function clockLabel(sec: number): string {
  const ms = Math.round(sec * 1000);
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor((ms % 3600000) / 60000))}:${pad(Math.floor((ms % 60000) / 1000))}.${pad(ms % 1000, 3)}`;
}

/** キューに入れられる段階（待機・エラー）と、入っている段階（消して入れ直せる） */
export const canQueueRecording = (state: string | null) => state === 'waiting' || state === 'error';
export const isQueuedRecording = (state: string | null) => ['queued', 'encoding', 'encode_error', 'encode_finish'].includes(state ?? '');

type Transfer = NonNullable<Recording['transfer_state']> & { error?: string | null; updated_at?: string | null };

/** 別のサーバーへ送るボタンの文字（その送り先の進み具合で変わる。失敗したら「やり直す」） */
export function transferButton(toNode: string, t: Transfer | null | undefined, starting: string | null) {
  const mine = t && t.node === toNode ? t : null;
  const busy = !!mine && ['starting', 'waiting', 'sending', 'finalizing'].includes(mine.phase);
  const failed = !!mine && (mine.phase === 'error' || mine.phase === 'interrupted');
  const sent = !!mine && (mine.phase === 'done' || mine.phase === 'already');
  const label = starting === toNode ? `${toNode} へ転送を開始中...`
    : busy ? `${toNode} へ転送中…` : failed ? `${toNode} へ転送をやり直す` : sent ? `${toNode} へもう一度転送` : `${toNode} へ転送`;
  return { label, busy, failed };
}

const PHASE: Record<string, string> = {
  starting: '準備中', waiting: '順番待ち', sending: '送信中', finalizing: '受け側で登録中', done: '送信完了',
  already: '送信済み(向こうに既にあった)', error: '送信失敗',
};
const gb = (n: number) => `${(n / 1e9).toFixed(2)}GB`;

/** 送っている時の進み具合の見出し（「node2 へ転送 · 送信中 1.20GB / 3.00GB (40%)」） */
export function transferStatus(t: Transfer) {
  const pct = t.total > 0 ? Math.min(100, (t.sent / t.total) * 100) : 0;
  const done = t.phase === 'done' || t.phase === 'already';
  const text = `${t.node} へ転送 · ${PHASE[t.phase] || t.phase}`
    + (t.total > 0 && !done ? ` ${gb(t.sent)} / ${gb(t.total)} (${pct.toFixed(0)}%)` : '')
    + (done && t.total > 0 ? ` ${gb(t.total)}` : '');
  return { text, pct, done, bad: t.phase === 'error' };
}

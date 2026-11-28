// 録画の処理の進み具合（録画→解析→待機→エンコ→完了の 5 段）。録画結果のコンタクトシートの札と目盛りに使う
import { REC_STATE_LABELS } from './list';
import type { Recording } from './types';

export const REC_STEPS = ['録画', '解析', '待機', 'エンコ', '完了'] as const;

export interface RecProgress {
  /** 進んだ段の数（1〜5） */
  step: number;
  /** 札の言葉（日本語） */
  label: string;
  /** 札の言葉のもと（表示言語で引く時のキー: recording / encoded / 段階の名前） */
  state: string;
  /** 別のサーバーへ任せている時のサーバー名（waiting(名前)） */
  node: string | null;
  kind: 'done' | 'working' | 'error';
}

const STEP: Record<string, number> = { pending: 2, scanning: 2, found: 3, waiting: 3, queued: 3, encoding: 4, encode_finish: 5 };

export function recProgress(r: Pick<Recording, 'state' | 'rec_status'>): RecProgress {
  if (r.rec_status === 0) return { step: 1, label: '録画中', state: 'recording', node: null, kind: 'working' };
  const m = /^(\w+)\((.+)\)$/.exec(r.state ?? '');
  const base = m ? m[1]! : r.state ?? 'pending';
  const node = m ? m[2]! : null;
  const label = REC_STATE_LABELS[base] ?? base;
  if (base === 'encode_finish') return { step: 5, label: 'エンコ済', state: 'encoded', node, kind: 'done' };
  if (base in STEP) return { step: STEP[base]!, label, state: base, node, kind: 'working' };
  // 失敗・ファイル無・スキップなど。どこで止まったかは分からないので解析までにする
  return { step: 2, label, state: base, node, kind: 'error' };
}

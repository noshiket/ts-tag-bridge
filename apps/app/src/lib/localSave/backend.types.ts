import type { LocalSaveMeta, LocalSidecar } from '@tstag/core';

/** 保存した1本を読み出したもの。再生には uri を使う（Web は Blob の URL なので release で放す） */
export interface LocalBundle {
  videoUri: string;
  posterUri: string | null;
  tileUri: string | null;
  sidecar: LocalSidecar;
  mime: string;
  release(): void;
}

/** 保存の完了時に書くもの */
export interface LocalRecord {
  sidecar: LocalSidecar;
  mime: string;
  totalSize: number;
  cachedAt: string;
  audio: 'main' | 'secondary';
}

/**
 * 保存先（端末ごと）。Web は元の Web 版と同じ OPFS + IndexedDB + localStorage（元の保存をそのまま読める）、
 * iOS はアプリの書類フォルダ
 */
export interface LocalBackend {
  /** この端末で保存できるか */
  available(): boolean;
  /** 保存済みの一覧（鍵 → 控えた情報） */
  loadIndex(): Promise<Record<string, LocalSaveMeta>>;
  /**
   * 動画本体を書く。止める時は signal。書いた大きさを返す。前の書きかけがあれば続きから取る。
   * 通信が切れて書けた分を残した時は、その割合を partial に付けて投げる（後で続きを取る）。
   * keep: 続きを取るために書きかけと一緒に残す情報。
   * onWaiting: 前の物を取り終えるまで待たせた（true）・流し始めた（false）（iOS の部品。順番を部品が守るため）
   */
  writeVideo(ck: string, url: string, headers: Record<string, string>, mime: string,
    onProgress: (p: number) => void, signal: AbortSignal, keep: { meta: LocalSaveMeta; secondary: boolean },
    onWaiting?: (waiting: boolean) => void): Promise<{ totalSize: number }>;
  /**
   * 保存を積んだことを端末に控える（iOS。アプリが終わっても次の起動で取り直すため）。
   * 確定（commit）・取り消し（remove）・失敗で消える
   */
  remember?(ck: string, keep: { meta: LocalSaveMeta; secondary: boolean }): void;
  /** 前回の書きかけ（続きを取れるもの） */
  listPartial(): Promise<{ ck: string; meta: LocalSaveMeta; secondary: boolean; progress: number }[]>;
  /** 本体の後に補助データとサムネを書いて保存を確定する */
  commit(ck: string, rec: LocalRecord, meta: LocalSaveMeta, assets: { poster: string; tile: string | null }, headers: Record<string, string>): Promise<void>;
  /** 補助データだけ書き直す */
  updateSidecar(ck: string, sidecar: LocalSidecar): Promise<void>;
  /**
   * 保存に添える JSON（card: ライブラリのカードの中身、tag: tag.json 丸ごと）を置く・読む。
   * 通信の無い時も、一覧のカードと再生画面のタブ（確定値・チャプター）を同じに出すため
   */
  saveJson(ck: string, name: LocalJsonName, data: unknown): Promise<void>;
  readJson(ck: string, name: LocalJsonName): Promise<unknown>;
  read(ck: string): Promise<LocalBundle | null>;
  /** 一覧のサムネ（無ければ null）。Web は Blob の URL */
  posterUri(ck: string): Promise<string | null>;
  /** 保存の鍵を付け替える（動画の番号・サーバーが変わった時） */
  rename(oldCk: string, newCk: string): Promise<void>;
  remove(ck: string): Promise<void>;
  clear(): Promise<void>;
  usage(): Promise<number>;
}

export type LocalJsonName = 'card' | 'tag';

// 分割画面の CM解析まわり（元の split.jsx の cmRanges・chaptersIn・flipBlocks・segMutes など）。
// CM解析は録画登録スキャンが作る参考の結果で、分割（segments）には押した時だけ反映する。
// 中身は役割ごとのファイルに分けてある: 解析の結果（cmResult）・▼（cmMarks）・ブロック（cmBlocks）・チャプター（cmChapters）
export * from './cmBlocks';
export * from './cmChapters';
export * from './cmMarks';
export * from './cmResult';
export type { SplitSegment } from './source';

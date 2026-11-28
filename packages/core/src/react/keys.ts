// 取得した結果の置き場所の名前。書き込みの後に取り直す範囲もこれで指定する
type Node = string | null | undefined;
/** ライブラリの動画は番号、録画は 'rec:番号'（stream/target の targetKey） */
type SKey = number | string;

export const queryKeys = {
  me: ['me'] as const,
  prefs: ['prefs'] as const,
  mylist: ['mylist'] as const,
  nodes: ['nodes'] as const,
  comments: (id: SKey, node: Node) => ['stream', node ?? '', 'comments', id] as const,
  captions: (id: SKey, track: string, node: Node) => ['stream', node ?? '', 'captions', id, track] as const,
  marks: (id: SKey, node: Node) => ['stream', node ?? '', 'marks', id] as const,
  streamMeta: (id: SKey, node: Node) => ['stream', node ?? '', 'meta', id] as const,
  watchEntry: (fileKey: string) => ['watch', fileKey] as const,
  watchHistory: ['watchHistory'] as const,
  albums: (node: Node) => ['library', node ?? '', 'albums'] as const,
  album: (id: number, node: Node) => ['library', node ?? '', 'album', id] as const,
  series: (id: number, node: Node) => ['library', node ?? '', 'series', id] as const,
  reserves: (node: Node) => ['reserves', node ?? '', 'list'] as const,
  reserve: (id: number, node: Node) => ['reserves', node ?? '', 'one', id] as const,
  tunerReserves: (node?: string | null) => ['reserves', node ?? '', 'tuners'] as const,
  recordings: (node: Node, query: string) => ['recordings', node ?? '', query] as const,
  recording: (dbRecId: number, node: Node) => ['recordings', node ?? '', 'one', dbRecId] as const,
  recordingProbe: (dbRecId: number, node: Node) => ['recordings', node ?? '', 'probe', dbRecId] as const,
  encodes: (node: Node) => ['encodes', node ?? '', 'list'] as const,
  encodePause: (node: Node) => ['encodes', node ?? '', 'pause'] as const,
  parsePreview: (key: string) => ['parsePreview', key] as const,
  albumCaptures: (id: number, node: Node) => ['library', node ?? '', 'albumCaptures', id] as const,
  autoAdd: (node: Node) => ['autoAdd', node ?? '', 'epg'] as const,
  manuAdd: (node: Node) => ['autoAdd', node ?? '', 'manu'] as const,
};

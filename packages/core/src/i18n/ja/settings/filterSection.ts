import type { Messages } from '../../translate';

export const settingsFilterSection = {
  'settings.filterSection.filters': 'フィルタ',
  'settings.filterSection.mainFilterScriptPath': 'メインフィルタスクリプトのパス',
  'settings.filterSection.postFilterPath': 'ポストフィルタのパス',
  'settings.filterSection.algorithm': 'アルゴリズム',
  'settings.filterSection.strength': '強度',
  'settings.filterSection.quality15': '品質 (1-5)',
  'settings.filterSection.widthPx': '横 (px)',
  'settings.filterSection.heightPx': '縦 (px)',
  'settings.filterSection.process': 'CUDAで処理',
  'settings.filterSection.deinterlace': 'インターレース解除',
  'settings.filterSection.deblocking': 'デブロッキング',
  'settings.filterSection.resize': 'リサイズ',
  'settings.filterSection.temporalStabilizationTemporalnr': '時間軸安定化 (TemporalNR)',
  'settings.filterSection.reduceBanding': 'バンディング低減',
  'settings.filterSection.edgeEnhancementAnime': 'エッジ強調（アニメ用）',
} satisfies Messages;

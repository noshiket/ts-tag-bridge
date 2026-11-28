// パターンビルダー（元の parse.jsx の TitleSegmenter の区切り方と、パターン画面・再生画面のパターンタブの登録・編集の組み立て）。
// 中身は役割ごとのファイルに分けてある: 区切り（segments）・照合（matching）・登録/編集（analyzeEdit）・保存前の確かめ（saveChecks）
export * from './analyzeEdit';
export * from './matching';
export * from './saveChecks';
export * from './segments';

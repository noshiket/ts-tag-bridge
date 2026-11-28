import { RefreshControl } from 'react-native';

/** 引っぱって取り直す。一覧の refreshControl に渡す。tint はテーマの薄い文字色 */
export function pullToRefresh(query: { isRefetching: boolean; refetch: () => Promise<unknown> }, tint?: string) {
  return <RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={tint} />;
}

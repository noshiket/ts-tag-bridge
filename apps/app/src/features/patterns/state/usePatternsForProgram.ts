import { findPatternsByString, matchedPatterns, type Analyzer, type PatternCtx } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

/**
 * パターン登録で読むもの: 設定（出力先・text_parser の文脈）と、番組の局（SID）のパターン、
 * この題名に当たるもの（完全マッチはサーバーで判定・追加候補）
 */
export function usePatternsForProgram(ctx: PatternCtx | null, normalizedTitle: string) {
  const api = useApi();
  const config = useQuery({ queryKey: ['config', ''], queryFn: () => api.settings.config() });
  const configOutputPath = String(config.data?.output_path ?? '');
  const tpContext = (config.data?.text_parser_context as Record<string, unknown> | undefined) ?? {};

  const sid = ctx?.sid;
  const patterns = useQuery({
    queryKey: ['patterns', sid],
    queryFn: async () => (await api.patterns.list(sid!)).map((p) => ({ ...p, pattern_index: p.index }) as Analyzer),
    enabled: !!sid,
  });
  const analyzers = useMemo(() => patterns.data ?? [], [patterns.data]);
  const reload = () => patterns.refetch();

  // 完全マッチはサーバーで判定する（簡易な照合は全角空白などで食い違い、実際に採用されるものが出ないことがある）
  const matchesQ = useQuery({
    queryKey: ['patternMatches', normalizedTitle, sid, analyzers],
    queryFn: async () => matchedPatterns(analyzers, await api.patterns.matches({
      title: normalizedTitle, sid, onid: ctx?.onid, tsid: ctx?.tsid, service_name: ctx?.service_name ?? '', start_time: ctx?.start ?? '',
      description: ctx?.description ?? '', extended_info: ctx?.extended_info ?? '',
    }, analyzers)),
    enabled: !!normalizedTitle && !!sid && analyzers.length > 0,
  });
  const matched = analyzers.length && normalizedTitle && sid ? matchesQ.data ?? [] : [];
  const candidates = useMemo(() => findPatternsByString(normalizedTitle, analyzers, { description: ctx?.description ?? '', extended_info: ctx?.extended_info ?? '' }),
    [normalizedTitle, analyzers, ctx?.description, ctx?.extended_info]);

  return { sid, configOutputPath, tpContext, reload, matched, candidates };
}

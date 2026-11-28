import { ACTION_SCHEMA, OUTPUT_FIELDS } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useQuery } from '@tanstack/react-query';

/** サーバーのアクション定義と出力フィールド（取れなければ元の定数） */
export function useActionSchema() {
  const api = useApi();
  const q = useQuery({ queryKey: ['patterns', 'actives'], queryFn: () => api.patterns.actives(), staleTime: Infinity });
  return {
    picker: q.data?.actives.length ? q.data.actives : ACTION_SCHEMA,
    fields: q.data?.outputFields.length ? q.data.outputFields : OUTPUT_FIELDS,
  };
}

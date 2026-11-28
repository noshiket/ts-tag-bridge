import type { ApiClient } from '../http/client';

/** GET /api/nodes。federation でつながっている他のサーバー */
export interface Nodes {
  node_id: string;
  role: string;
  nodes: { name: string }[];
  /** ライブラリを相手と共有している時の相手の名前 */
  library_peer: string | null;
}

export const nodesApi = (c: ApiClient) => ({
  list: () => c.get<Nodes>('/api/nodes'),
});

/**
 * 別のサーバー(federation のノード)の API を、このサーバー経由で呼ぶパスにする。
 * node が無ければこのサーバー自身。
 *
 * 例: nodePath('node1', '/api/videos/albums') → '/api/nodes/node1/videos/albums'
 */
export function nodePath(node: string | null | undefined, path: string): string {
  if (!node) return path;
  return `/api/nodes/${encodeURIComponent(node)}/${path.replace(/^\/api\//, '')}`;
}

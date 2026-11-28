import { describe, expect, it } from 'vitest';

import { filterApiRoutes, groupApiRoutes, type ApiRoute } from '../src/settings/apiDocs';

const r = (path: string, group: string, doc = '', methods = ['GET']): ApiRoute =>
  ({ path, group, doc, summary: doc.split('\n')[0] ?? '', methods, auth: 'login', relay: false, source: 'api.x.f' });

describe('API の一覧', () => {
  const routes = [r('/api/encode/sync', 'encode', 'Phase B を今すぐ動かす', ['POST']), r('/api/encode/recordings', 'encode'), r('/api/videos/list', 'videos', '動画の一覧')];

  it('空なら全部、空白で区切ると全部を含む物だけ', () => {
    expect(filterApiRoutes(routes, '  ')).toHaveLength(3);
    expect(filterApiRoutes(routes, 'post').map((x) => x.path)).toEqual(['/api/encode/sync']);
    expect(filterApiRoutes(routes, 'encode 今すぐ').map((x) => x.path)).toEqual(['/api/encode/sync']);
    expect(filterApiRoutes(routes, '一覧 VIDEOS')).toHaveLength(1);
  });

  it('group ごとに、並びのまままとめる', () => {
    expect(groupApiRoutes(routes).map((g) => [g.group, g.routes.length])).toEqual([['encode', 2], ['videos', 1]]);
  });
});

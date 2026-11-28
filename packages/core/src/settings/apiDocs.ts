// 開発者向けの API の一覧（GET /api/docs/routes。サーバーが自分の口と説明書きから作る）

/** 誰が呼べるか。public: ログイン不要 / login: ログインした人 / admin: 管理者だけ / fed: サーバー同士の合言葉 */
export type ApiAuth = 'public' | 'login' | 'admin' | 'fed';

export interface ApiRoute {
  path: string;
  methods: string[];
  /** /api/<ここ>/... */
  group: string;
  /** 説明書きの1行目 */
  summary: string;
  /** 説明書きの全文（無ければ空） */
  doc: string;
  auth: ApiAuth;
  /** 他のサーバーから /api/nodes/<名前>/... で中継して呼べる */
  relay: boolean;
  /** サーバーの中の関数（モジュール.名前） */
  source: string;
}

export const API_AUTH_LABEL: Record<ApiAuth, string> = {
  public: 'ログイン不要', login: 'ログイン', admin: '管理者', fed: 'サーバー間',
};

/** 文字（URL・説明書き・メソッド・関数名のどれかに含む。空白で区切ると全部を含む物）で絞る */
export function filterApiRoutes(routes: ApiRoute[], query: string): ApiRoute[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return routes;
  return routes.filter((r) => {
    const hay = `${r.methods.join(' ')} ${r.path} ${r.doc} ${r.source}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** group ごとにまとめる（並びはサーバーの並び＝group・path 順のまま） */
export function groupApiRoutes(routes: ApiRoute[]): { group: string; routes: ApiRoute[] }[] {
  const out: { group: string; routes: ApiRoute[] }[] = [];
  for (const r of routes) {
    const last = out[out.length - 1];
    if (last && last.group === r.group) last.routes.push(r);
    else out.push({ group: r.group, routes: [r] });
  }
  return out;
}

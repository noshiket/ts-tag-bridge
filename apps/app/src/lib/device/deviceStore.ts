/** 端末ごとの小さな好み（サーバーには置かない）。Web は localStorage */
export const deviceStore = {
  get: (key: string): string | null => {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set: (key: string, value: string) => {
    try { localStorage.setItem(key, value); } catch { /* 保存できなくても動きは変えない */ }
  },
};

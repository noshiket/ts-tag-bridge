// 一覧の1ページの件数。アカウントの既定（prefs.tweaks.pageSize。全部の端末に同じ）と、この端末だけの上書き（端末に保存）。
// 端末の上書きがあればそれを使う（元の Web 版の resolvePageSize と同じ）

export const PAGE_SIZE_CHOICES = [10, 20, 30, 50, 100];
export const DEVICE_PAGE_SIZE_KEY = 'tstag_page_size';
export const DEFAULT_PAGE_SIZE = 20;

/** 端末に残した値（選べる数でなければ無し） */
export function parseDevicePageSize(raw: string | null): number | null {
  const n = Number(raw);
  return PAGE_SIZE_CHOICES.includes(n) ? n : null;
}

export function resolvePageSize(tweakValue: unknown, deviceValue: number | null): number {
  if (deviceValue != null && PAGE_SIZE_CHOICES.includes(deviceValue)) return deviceValue;
  const t = Number(tweakValue);
  return t > 0 ? t : DEFAULT_PAGE_SIZE;
}

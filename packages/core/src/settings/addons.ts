// 設定の「アドオン」（元の SettingsAddons）。server/addon/ のアドオンの有効・無効と設定値

export interface AddonParam { key: string; label: string; type?: 'bool' | 'number' | 'string' | string; default?: unknown; required?: boolean }
/** GET /api/addons/settings の1件 */
export interface AddonSetting {
  name: string; label: string; target?: string; description?: string; events?: string[];
  params?: AddonParam[]; settings_params?: AddonParam[];
  settings: { enabled: boolean; params: Record<string, unknown> };
  requirements?: { ok: boolean; items: { name: string; line: string; installed: boolean; version?: string | null }[] } | null;
  health?: { ok: boolean; message?: string; hint?: string } | null;
  error?: string | null;
}
export interface AddonDraft { enabled: boolean; params: Record<string, unknown> }

/** 設定に出す項目: settings_params があればそれ、無ければ通知・設定タブのアドオンは params */
export const addonSettingParams = (a: AddonSetting): AddonParam[] =>
  a.settings_params?.length ? a.settings_params : a.target === 'event' || a.target === 'settings_tab' ? a.params ?? [] : [];

/** 試しに動かせるアドオンか */
export const canFireAddon = (a: AddonSetting) => a.target === 'event' || a.target === 'settings_tab';

/** 編集の始めの値。保存していない項目はサーバーが既定値で動くので、画面にも既定値を出す（出さないと「OFF なのに通知が来る」） */
export function addonDraft(a: AddonSetting): AddonDraft {
  const defs: Record<string, unknown> = {};
  addonSettingParams(a).forEach((p) => { if (p.default != null) defs[p.key] = p.default; });
  return { enabled: a.settings.enabled, params: { ...defs, ...a.settings.params } };
}

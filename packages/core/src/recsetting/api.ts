import type { ApiClient } from '../http/client';
import { nodePath } from '../http/node';
import type { RecSettingOptions } from './recSetting';

export const recSettingApi = (c: ApiClient) => ({
  options: (node?: string | null) => c.get<RecSettingOptions>(nodePath(node, '/api/rec_setting_options')),
  tuners: (node?: string | null) => c.get<{ tuner_id: number; tuner_name: string; reserve_count: number }[]>(nodePath(node, '/api/tuners')),
  /** 予約の録画設定を変える（EDCB の change_reserve） */
  saveReserve: (reserveId: number, payload: Record<string, unknown>, node?: string | null) =>
    c.patch<unknown>(nodePath(node, `/api/reserves/${reserveId}`), payload),
});

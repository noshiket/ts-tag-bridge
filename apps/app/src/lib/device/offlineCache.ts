// Web はブラウザで開くので、通信の無い時の控えは持たない（offlineCache.ts は iOS）
import type { QueryClient } from '@tanstack/react-query';

export function seedOffline(_qc: QueryClient) {}
export function persistOffline(_qc: QueryClient) { return () => {}; }
export function clearOffline() {}

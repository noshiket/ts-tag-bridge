import type { ReactNode } from 'react';

type PiPChange = { active: boolean; restored?: boolean };

/** Web は小窓をプレイヤーのページ（Document PiP 等）が受け持つので、ここでは何もしない */
export function useLivePip(_o: {
  channelId: string; quality: string; node: string | null; enabled: boolean; playing: boolean;
  volume: number; muted: boolean; captionOn: boolean; commentsOn: boolean; onChange: (e: PiPChange) => void;
}): { available: boolean; armed: boolean; start(): void; view: ReactNode } {
  return { available: false, armed: false, start: () => {}, view: null };
}

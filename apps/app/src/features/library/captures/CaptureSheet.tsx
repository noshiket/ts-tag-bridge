import type { LibraryCapture } from '@tstag/core';

import { Sheet, SheetItem } from '../../../ui/sheets/Sheet';
import { useT } from '../../../ui/i18n/I18n';

/** キャプチャの操作: ここから再生・原寸・端末へ保存・コピー・削除 */
export function CaptureSheet({ c, onClose, onPlay, onFull, onSave, onCopy, onDelete }: {
  c: LibraryCapture | null;
  onClose: () => void;
  onPlay: (c: LibraryCapture) => void;
  onFull: (c: LibraryCapture) => void;
  onSave: (c: LibraryCapture) => void;
  onCopy: (c: LibraryCapture) => void;
  onDelete: (c: LibraryCapture) => void;
}) {
  const { t: tx } = useT();
  const canPlay = !!(c?.tot && c.video_id != null);
  const run = (f: (c: LibraryCapture) => void) => () => { if (c) f(c); onClose(); };
  return (
    <Sheet open={!!c} onClose={onClose} title={tx('library.capture.title')} subtitle={c?.eit_title ?? c?.file}>
      {canPlay && <SheetItem first label={tx('library.capture.playHere')} onPress={run(onPlay)} />}
      <SheetItem first={!canPlay} label={tx('library.capture.full')} onPress={run(onFull)} />
      <SheetItem label={tx('library.capture.save')} onPress={run(onSave)} />
      <SheetItem label={tx('library.capture.copy')} onPress={run(onCopy)} />
      <SheetItem danger label={tx('common.delete')} onPress={run(onDelete)} />
    </Sheet>
  );
}

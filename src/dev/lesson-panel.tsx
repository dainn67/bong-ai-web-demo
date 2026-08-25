/**
 * Where a lesson is, and how to jump forward — the app's dev overlay.
 *
 * The app puts this over the lesson itself, gated behind `isLocalDebugMode`.
 * Here it belongs in the drawer: real firmware has no skip button and no
 * position readout, so putting one on the glass would be simulating something
 * that cannot exist. The drawer sits beside the badge rather than over it, so
 * the lesson stays watchable while this is open.
 */

import { Panel } from './dev-drawer';
import { useSimulatorStore } from '../store/simulator-store';

export function LessonPanel() {
  const activity = useSimulatorStore((state) => state.activity);
  const status = useSimulatorStore((state) => state.lessonDebug);
  const skip = useSimulatorStore((state) => state.skipLessonNode);
  const metadataUrl = useSimulatorStore((state) => state.lessonMetadataUrl);

  // Lessons only, like the app — a story has no nodes to step through, and its
  // own pause control already covers what a tester needs.
  if (activity.kind !== 'lesson') return null;

  const url = metadataUrl();
  // No engine yet: the lesson is still loading, or it stopped before building
  // one (signed out, bad metadata). Say which rather than showing a bare dash
  // over a button that would do nothing.
  const ready = status !== null;

  return (
    <Panel
      title="Bài học"
      action={
        url && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-semibold text-ink-500 underline underline-offset-2"
          >
            metadata.json
          </a>
        )
      }
    >
      {/* Monospace so the position does not jiggle as the numbers change —
          a proportional font makes a status line that updates every node look
          like it is twitching. */}
      <p className="rounded-xl bg-ink-900 px-2.5 py-2 font-mono text-[11px] font-semibold leading-snug text-sunny-400">
        {status ?? (activity.error ?? 'chưa có node nào — bài học đang tải')}
      </p>

      <button
        type="button"
        onClick={skip}
        disabled={!ready}
        className="rounded-xl bg-sunny-400 px-3 py-2 text-sm font-bold text-ink-900 transition active:scale-95 disabled:opacity-40"
      >
        ⏭ Node tiếp theo
      </button>

      <p className="text-xs leading-snug text-ink-500">
        Nhảy tới node cấp cao kế tiếp theo <em>thứ tự trong danh sách</em>, không
        theo <code>next</code> — node câu hỏi không có <code>next</code> của riêng
        nó (mỗi nhánh trả lời mới có), nên đi theo <code>next</code> sẽ kết thúc
        bài học ngay tại mỗi câu hỏi.
      </p>
    </Panel>
  );
}

/**
 * A running story or lesson, on the glass.
 *
 * Replaces the face while it is up, because during a lesson the caption *is*
 * what the child is following — a face beside it would compete for a screen
 * this small. Controls are two big targets at the bottom, sized for a finger
 * rather than a cursor.
 */

import { useSimulatorStore } from '../store/simulator-store';
import { canPause, phaseLabel } from './activity-state';

export function ActivityView() {
  const activity = useSimulatorStore((state) => state.activity);
  const exit = useSimulatorStore((state) => state.exitActivity);
  const togglePause = useSimulatorStore((state) => state.toggleActivityPause);

  if (!activity.kind) return null;

  const status = phaseLabel(activity);
  const listening = activity.phase === 'listening';

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-between bg-screen/95 px-9 py-7 text-center">
      <p className="max-w-full truncate text-[10px] font-bold uppercase tracking-wider text-cream-200/50">
        {activity.title}
      </p>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 py-2">
        {activity.phase === 'error' ? (
          <p className="text-xs font-semibold leading-snug text-berry-500">{activity.error}</p>
        ) : (
          <>
            {activity.caption && (
              <p className="line-clamp-4 text-[13px] font-semibold leading-snug text-cream-100">
                {activity.caption}
              </p>
            )}
            {/* The expected answer, only while the mic is open. Showing it
                during the question would read the answer out for the child. */}
            {listening && activity.hint && (
              <p className="rounded-full bg-mint-400/15 px-2.5 py-0.5 text-[10px] font-bold text-mint-400">
                {activity.hint}
              </p>
            )}
            {status && (
              <p className="text-[10px] font-medium text-cream-200/50">{status}</p>
            )}
          </>
        )}

        {activity.notice && (
          <p className="mt-1 rounded-2xl bg-sunny-400/15 px-2.5 py-1 text-[10px] font-semibold leading-tight text-sunny-400">
            {activity.notice}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2">
        {canPause(activity) && (
          <button
            type="button"
            onClick={togglePause}
            className="rounded-full bg-cream-200/15 px-4 py-1.5 text-[11px] font-bold text-cream-100 transition active:scale-95"
          >
            {activity.phase === 'paused' ? '▶ Tiếp' : '⏸ Dừng'}
          </button>
        )}
        <button
          type="button"
          onClick={exit}
          className="rounded-full bg-cream-200/15 px-4 py-1.5 text-[11px] font-bold text-cream-100 transition active:scale-95"
        >
          Thoát
        </button>
      </div>

      {/* Same listening ring the conversation mode uses, so "the mic is open"
          looks identical whichever mode the child is in. */}
      {listening && (
        <div className="pointer-events-none absolute inset-2 animate-pulse rounded-full ring-2 ring-mint-400/60" />
      )}
    </div>
  );
}

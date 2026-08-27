/**
 * A running story or lesson, on the glass.
 *
 * Replaces the face while it is up, because during a lesson the caption *is*
 * what the child is following — a face beside it would compete for a screen
 * this small.
 *
 * Centred on both axes and inset from the edge, for the same reason the menu
 * is: this is a circle, and anything pushed into a corner of the box it is
 * inscribed in gets clipped away by the curve.
 */

import { useSimulatorStore } from '../store/simulator-store';
import { canPause, phaseLabel } from './activity-state';

export function ActivityView() {
  const activity = useSimulatorStore((state) => state.activity);
  const togglePause = useSimulatorStore((state) => state.toggleActivityPause);
  const skip = useSimulatorStore((state) => state.skipLessonNode);
  const position = useSimulatorStore((state) => state.lessonPosition);

  if (!activity.kind) return null;

  const status = phaseLabel(activity);
  const listening = activity.phase === 'listening';
  const hasImage = Boolean(activity.imageUrl);

  return (
    <div
      className={`absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-center overflow-hidden rounded-full ${
        hasImage ? 'bg-transparent' : 'bg-screen/95'
      }`}
    >
      {/* Full screen background image when present */}
      {hasImage && (
        <>
          <img
            src={activity.imageUrl!}
            alt=""
            className="absolute inset-0 h-full w-full object-cover pointer-events-none"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-ink-950/70 via-ink-950/20 to-ink-950/85 pointer-events-none" />
        </>
      )}

      {/* Same budget as the menu: the inscribed square, spent in full. */}
      <div className="relative z-10 flex w-[76%] flex-col items-center gap-1.5">
        <p className="w-full truncate text-[10px] font-bold uppercase tracking-[0.18em] text-cream-200/80 drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)]">
          {activity.title}
        </p>

        {activity.phase === 'error' ? (
          <p className="text-[11px] font-semibold leading-snug text-berry-500 bg-ink-950/60 backdrop-blur-xs px-2.5 py-1 rounded-lg">
            {activity.error}
          </p>
        ) : (
          <>
            {activity.caption && (
              <p
                className={`line-clamp-4 text-[13px] font-semibold leading-snug text-cream-100 ${
                  hasImage
                    ? 'bg-ink-950/50 backdrop-blur-xs px-2.5 py-1 rounded-xl drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]'
                    : ''
                }`}
              >
                {activity.caption}
              </p>
            )}
            {/* The expected answer, only while the mic is open. Showing it during
              the question would read the answer out for the child. */}
            {listening && activity.hint && (
              <p className="rounded-full bg-mint-400/20 border border-mint-400/30 px-2.5 py-0.5 text-[10px] font-bold text-mint-300 drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)]">
                {activity.hint}
              </p>
            )}
            {status && (
              <p className="text-[10px] font-medium text-cream-200/70 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
                {status}
              </p>
            )}
          </>
        )}

        {activity.notice && (
          <p className="rounded-2xl bg-sunny-400/20 border border-sunny-400/30 px-2.5 py-1 text-[10px] font-semibold leading-tight text-sunny-300 drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)]">
            {activity.notice}
          </p>
        )}

        {/* Pause is about *this* story, so it stays on the glass. Leaving is the
          back button's job — a device with rim controls should not put an exit
          on screen and then teach the child two ways out of one place.

          Skip sits beside it, on request. It is a tester's control that no real
          badge has — the position counter next to it gives the same game away —
          so it is deliberately the quieter of the two and appears only for
          lessons, which are the only thing with nodes to step through. */}
        <div className="mt-0.5 flex items-center gap-1.5">
          {canPause(activity) && (
            <button
              type="button"
              onClick={togglePause}
              className="rounded-full bg-cream-200/20 hover:bg-cream-200/30 backdrop-blur-xs px-4 py-1 text-[11px] font-bold text-cream-100 transition active:scale-95 shadow-sm"
            >
              {activity.phase === 'paused' ? '▶ Tiếp' : '⏸ Dừng'}
            </button>
          )}

          {activity.kind === 'lesson' && position && (
            <button
              type="button"
              onClick={skip}
              title="Node tiếp theo (chỉ dành cho kiểm thử)"
              className="flex items-center gap-1 rounded-full bg-sunny-400/20 hover:bg-sunny-400/30 backdrop-blur-xs border border-sunny-400/30 px-2.5 py-1 text-[11px] font-bold text-sunny-300 transition active:scale-95 shadow-sm"
            >
              ⏭
              {/* Tabular so the counter does not shuffle the button's width as
                  the numbers change. */}
              <span className="font-mono text-[10px] tabular-nums">{position}</span>
            </button>
          )}
        </div>
      </div>

      {/* Same listening ring the conversation mode uses, so "the mic is open"
          looks identical whichever mode the child is in. Outside the content
          box on purpose — it traces the glass, not the text. */}
      {listening && (
        <div className="pointer-events-none absolute inset-2 animate-pulse rounded-full ring-2 ring-mint-400/60" />
      )}
    </div>
  );
}

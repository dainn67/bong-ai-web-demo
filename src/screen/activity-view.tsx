/**
 * A running story or lesson, on the glass.
 *
 * Owns the glass while it is up, because during a lesson the picture and the
 * caption *are* what the child is following — a face beside them would compete
 * for a screen this small.
 *
 * It is also the touch surface for a `câu hỏi chạm`. Its only job there is
 * geometry: work out which zone or direction the finger meant, and report it.
 * What the answer *means* — which branch runs, what appears next — is decided
 * by the script or by the server, never here. A view with opinions about that
 * would fight whoever is actually running the lesson over the same screen.
 *
 * While a picture is up it gets the whole circle. Text and controls appear only
 * on the black screen, because artwork for a touch question *is* the question
 * and a caption laid over it hides the choices; the position readout and the
 * tester controls are in the drawer, which sits beside the badge instead.
 *
 * Centred on both axes and inset from the edge, for the same reason the menu
 * is: this is a circle, and anything pushed into a corner of the box it is
 * inscribed in gets clipped away by the curve.
 */

import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { useSimulatorStore } from '../store/simulator-store';
import { canPause, phaseLabel } from './activity-state';
import { classifyGesture, type TouchGestureSample } from './touch-layout';
import { toDevicePoint } from './touch-input';

const TEXT_BOX = 'pointer-events-none relative z-10 flex w-[76%] flex-col items-center gap-1.5';

export function ActivityView() {
  const activity = useSimulatorStore((state) => state.activity);
  const face = useSimulatorStore((state) => state.face);
  const togglePause = useSimulatorStore((state) => state.toggleActivityPause);
  const skip = useSimulatorStore((state) => state.skipLessonNode);
  const position = useSimulatorStore((state) => state.lessonPosition);
  const dispatchTouch = useSimulatorStore((state) => state.dispatchTouch);

  const downPoint = useRef<TouchGestureSample | null>(null);

  if (!activity.kind) return null;

  const status = phaseLabel(activity);
  const listening = activity.phase === 'listening';
  const waitingForTouch = activity.waitingFor === 'touch' && Boolean(activity.touchLayout);
  const effectiveImageUrl = activity.imageUrl || face.imageUrl;
  const effectiveImageSeq = activity.imageSeq || face.imageSeq;
  const hasImage = Boolean(effectiveImageUrl);


  const sampleAt = (event: ReactPointerEvent<HTMLDivElement>): TouchGestureSample => ({
    ...toDevicePoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect()),
    at: event.timeStamp,
  });

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // Outside a question window every press is ignored — a child carrying the
    // badge presses the glass constantly without meaning anything by it.
    if (!waitingForTouch) return;
    downPoint.current = sampleAt(event);
    // Capture so a finger that slides off the circle still reports its release
    // here, which is what makes a swipe measurable at all.
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = downPoint.current;
    downPoint.current = null;
    if (!waitingForTouch || !start || !activity.touchLayout) return;

    // Tap layouts read the press-down point; only a swipe needs the release.
    const end = sampleAt(event);
    dispatchTouch(classifyGesture(start, end, activity.touchLayout), {
      // The press-down coordinate, which is the one the protocol asks for: it
      // is what the child aimed at, before any drag moved their finger.
      point: { x: start.x, y: start.y },
      durationMs: Math.max(0, Math.round(end.at - start.at)),
    });
  };

  const onPointerCancel = () => {
    downPoint.current = null;
  };

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      className={`absolute inset-0 flex flex-col items-center justify-center gap-1.5 overflow-hidden rounded-full text-center ${
        hasImage ? 'bg-transparent' : 'bg-screen/95'
      } ${waitingForTouch ? 'cursor-crosshair' : ''}`}
    >
      {hasImage ? (
        // Nothing over the artwork. A lesson's picture is the question — a
        // caption across it hides the very thing the child is choosing between,
        // and on a 360px circle any text box big enough to read covers a zone.
        // The status line and the controls live in the drawer, beside the badge
        // rather than on top of it.
        <img
          // Keyed on the sequence too, so showing the same GIF twice restarts it.
          key={`${effectiveImageUrl}-${effectiveImageSeq ?? 0}`}
          src={effectiveImageUrl!}
          alt=""
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        />
      ) : (

        <div className={TEXT_BOX}>
          <p className="w-full truncate text-[10px] font-bold uppercase tracking-[0.18em] text-cream-200/80">
            {activity.title}
          </p>


          {activity.phase === 'error' ? (
            <p className="rounded-lg bg-ink-950/60 px-2.5 py-1 text-[11px] font-semibold leading-snug text-berry-500 backdrop-blur-xs">
              {activity.error}
            </p>
          ) : (
            <>
              {activity.caption && (
                <p className="line-clamp-3 text-[13px] font-semibold leading-snug text-cream-100">
                  {activity.caption}
                </p>
              )}
              {listening && activity.hint && (
                <p className="rounded-full border border-mint-400/30 bg-mint-400/20 px-2.5 py-0.5 text-[10px] font-bold text-mint-300">
                  {activity.hint}
                </p>
              )}
              {status && <p className="text-[10px] font-medium text-cream-200/70">{status}</p>}
            </>
          )}

          {/* Hidden while a question is open: a button here would swallow a
              press meant for the zone behind it. */}
          {!waitingForTouch && (
            <div className="pointer-events-auto mt-0.5 flex items-center gap-1.5">
              {canPause(activity) && (
                <button
                  type="button"
                  onClick={togglePause}
                  className="rounded-full bg-cream-200/20 px-4 py-1 text-[11px] font-bold text-cream-100 shadow-sm backdrop-blur-xs transition hover:bg-cream-200/30 active:scale-95"
                >
                  {activity.phase === 'paused' ? '▶ Tiếp' : '⏸ Dừng'}
                </button>
              )}

              {activity.kind === 'lesson' && position && (
                <button
                  type="button"
                  onClick={skip}
                  title="Node tiếp theo (chỉ dành cho kiểm thử)"
                  className="flex items-center gap-1 rounded-full border border-sunny-400/30 bg-sunny-400/20 px-2.5 py-1 text-[11px] font-bold text-sunny-300 shadow-sm backdrop-blur-xs transition hover:bg-sunny-400/30 active:scale-95"
                >
                  ⏭
                  <span className="font-mono text-[10px] tabular-nums">{position}</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* The one thing that does go over artwork, because it is the answer to
          "did that register?" and it is gone again in a few seconds. The store
          clears `notice` on its own, so there is no timer to keep here. */}
      {activity.notice && (
        <div className="pointer-events-none absolute bottom-4 z-20 max-w-[88%]">
          <p className="rounded-full border border-sunny-400/60 bg-ink-950/95 px-3.5 py-1.5 text-center text-[11px] font-bold leading-tight text-sunny-300 shadow-[0_6px_20px_rgba(0,0,0,0.8)] backdrop-blur-md">
            {activity.notice}
          </p>
        </div>
      )}
    </div>
  );
}

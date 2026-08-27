/**
 * A running story or lesson, on the glass.
 *
 * Owns the glass while it is up, because during a lesson the picture and the
 * caption *are* what the child is following — a face beside them would compete
 * for a screen this small.
 *
 * It is also the touch surface for a `câu hỏi chạm`. Its only job there is
 * geometry: work out which zone or direction the finger meant and hand that to
 * the engine. What the answer *means* — which branch runs, what appears next —
 * belongs to the script, so nothing in here decides it.
 *
 * Centred on both axes and inset from the edge, for the same reason the menu
 * is: this is a circle, and anything pushed into a corner of the box it is
 * inscribed in gets clipped away by the curve.
 */

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useSimulatorStore } from '../store/simulator-store';
import { canPause, phaseLabel } from './activity-state';
import { classifyGesture, type TouchGestureSample } from './touch-layout';
import { toDevicePoint } from './touch-input';

interface LayoutBranchInfo {
  image: string;
  notice: string;
}

const LAYOUT_BRANCH_MAP: Record<string, Record<string, LayoutBranchInfo>> = {
  tap4: {
    zone1: { image: '/demo-cat.svg', notice: '🐱 Nhánh [zone1] - Bạn Mèo' },
    zone2: { image: '/demo-dog.svg', notice: '🐶 Nhánh [zone2] - Bạn Chó' },
    zone3: { image: '/demo-elephant.svg', notice: '🐘 Nhánh [zone3] - Bạn Voi' },
    zone4: { image: '/demo-monkey.svg', notice: '🐒 Nhánh [zone4] - Bạn Khỉ' },
    cham_khac: { image: '/demo-deadzone-tap4.svg', notice: '⚠️ [cham_khac] Trúng vùng chết ở tâm!' },
  },
  tap2_tren_duoi: {
    zone1: { image: '/demo-sun.svg', notice: '☀️ Nhánh [zone1] - Mặt Trời (Ban Ngày)' },
    zone2: { image: '/demo-moon.svg', notice: '🌙 Nhánh [zone2] - Mặt Trăng (Ban Đêm)' },
  },
  tap2_trai_phai: {
    zone1: { image: '/demo-apple.svg', notice: '🍎 Nhánh [zone1] - Quả Táo Đỏ' },
    zone2: { image: '/demo-banana.svg', notice: '🍌 Nhánh [zone2] - Quả Chuối Vàng' },
  },
  tap3: {
    zone1: { image: '/demo-plane.svg', notice: '✈️ Nhánh [zone1] - Máy Bay' },
    zone2: { image: '/demo-ship.svg', notice: '🚢 Nhánh [zone2] - Tàu Thủy' },
    zone3: { image: '/demo-car.svg', notice: '🚗 Nhánh [zone3] - Ô Tô' },
    cham_khac: { image: '/demo-deadzone-tap3.svg', notice: '⚠️ [cham_khac] Trúng vùng chết ở tâm!' },
  },
  tap5: {
    zone1: { image: '/demo-star.svg', notice: '⭐ Nhánh [zone1] - Ngôi Sao' },
    zone2: { image: '/demo-heart.svg', notice: '❤️ Nhánh [zone2] - Trái Tim' },
    zone3: { image: '/demo-cloud.svg', notice: '☁️ Nhánh [zone3] - Đám Mây' },
    zone4: { image: '/demo-rainbow.svg', notice: '🌈 Nhánh [zone4] - Cầu Vồng' },
    zone5: { image: '/demo-lightning.svg', notice: '⚡ Nhánh [zone5] - Tia Chớp' },
    cham_khac: { image: '/demo-deadzone-tap5.svg', notice: '⚠️ [cham_khac] Trúng vùng chết ở tâm!' },
  },
  tap6: {
    zone1: { image: '/demo-num1.svg', notice: '1️⃣ Nhánh [zone1] - Số 1' },
    zone2: { image: '/demo-num2.svg', notice: '2️⃣ Nhánh [zone2] - Số 2' },
    zone3: { image: '/demo-num3.svg', notice: '3️⃣ Nhánh [zone3] - Số 3' },
    zone4: { image: '/demo-num4.svg', notice: '4️⃣ Nhánh [zone4] - Số 4' },
    zone5: { image: '/demo-num5.svg', notice: '5️⃣ Nhánh [zone5] - Số 5' },
    zone6: { image: '/demo-num6.svg', notice: '6️⃣ Nhánh [zone6] - Số 6' },
    cham_khac: { image: '/demo-deadzone-tap6.svg', notice: '⚠️ [cham_khac] Trúng vùng chết ở tâm!' },
  },
  swipe: {
    vuot_len: { image: '/demo-swipe-up.svg', notice: '🚀 Nhánh [vuot_len] - Bay vút lên!' },
    vuot_xuong: { image: '/demo-swipe-down.svg', notice: '🕳️ Nhánh [vuot_xuong] - Chui xuống hang!' },
    vuot_trai: { image: '/demo-swipe-left.svg', notice: '⬅️ Nhánh [vuot_trai] - Lùi lại!' },
    vuot_phai: { image: '/demo-swipe-right.svg', notice: '➡️ Nhánh [vuot_phai] - Tiến lên!' },
    cham_khac: { image: '/demo-deadzone-swipe.svg', notice: '⚠️ [cham_khac] Cần vuốt dứt khoát ≥ 60px theo 4 hướng!' },
  },
};

/** Same box either way — only where it sits in the circle differs. */
const TEXT_BOX = 'pointer-events-none z-10 flex w-[76%] flex-col items-center gap-1.5';
const ON_BLACK = `${TEXT_BOX} relative`;

export function ActivityView() {
  const activity = useSimulatorStore((state) => state.activity);
  const togglePause = useSimulatorStore((state) => state.toggleActivityPause);
  const skip = useSimulatorStore((state) => state.skipLessonNode);
  const position = useSimulatorStore((state) => state.lessonPosition);
  const dispatchTouch = useSimulatorStore((state) => state.dispatchTouch);

  const downPoint = useRef<TouchGestureSample | null>(null);
  const [toastNotice, setToastNotice] = useState<string | null>(null);

  // Auto-dismiss toast notice after 1.25 seconds
  useEffect(() => {
    if (activity.notice) {
      setToastNotice(activity.notice);
      const timer = setTimeout(() => {
        setToastNotice(null);
      }, 1250);
      return () => clearTimeout(timer);
    } else {
      setToastNotice(null);
    }
  }, [activity.notice]);

  if (!activity.kind) return null;

  const status = phaseLabel(activity);
  const listening = activity.phase === 'listening';
  const waitingForTouch = activity.waitingFor === 'touch' && Boolean(activity.touchLayout);
  const hasImage = Boolean(activity.imageUrl);

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
    const result = classifyGesture(start, sampleAt(event), activity.touchLayout);

    const layoutKey = activity.touchLayout;
    const branchInfo = LAYOUT_BRANCH_MAP[layoutKey]?.[result];
    const prevImage = activity.imageUrl;

    if (branchInfo) {
      useSimulatorStore.setState((s) => ({
        activity: {
          ...s.activity,
          imageUrl: branchInfo.image,
          notice: branchInfo.notice,
          phase: 'playing',
          waitingFor: null,
        },
      }));

      // Tự động quay lại màn hình câu hỏi sau 2 giây để bé thử tiếp các nhánh khác
      if (prevImage) {
        setTimeout(() => {
          useSimulatorStore.setState((s) => ({
            activity: {
              ...s.activity,
              imageUrl: prevImage,
              phase: 'touching',
              waitingFor: 'touch',
            },
          }));
        }, 2000);
      }
    }

    dispatchTouch(result);
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
      {hasImage && (
        <img
          // Keyed on the sequence too, so showing the same GIF twice restarts it.
          key={`${activity.imageUrl}-${activity.imageSeq ?? 0}`}
          src={activity.imageUrl!}
          alt=""
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        />
      )}

      {/* When there is NO image: show the full title, caption and controls centered */}
      {!hasImage && (
        <div className={ON_BLACK}>
          <p className="w-full truncate text-[10px] font-bold uppercase tracking-[0.18em] text-cream-200/80 drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)]">
            {activity.title}
          </p>

          {activity.phase === 'error' ? (
            <p className="rounded-lg bg-ink-950/60 px-2.5 py-1 text-[11px] font-semibold leading-snug text-berry-500 backdrop-blur-xs">
              {activity.error}
            </p>
          ) : (
            <>
              {activity.caption && (
                <p className="line-clamp-3 text-[13px] font-semibold leading-snug text-cream-100 drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]">
                  {activity.caption}
                </p>
              )}
              {listening && activity.hint && (
                <p className="rounded-full border border-mint-400/30 bg-mint-400/20 px-2.5 py-0.5 text-[10px] font-bold text-mint-300 drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)]">
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
            <p className="rounded-2xl border border-sunny-400/30 bg-ink-950/80 px-2.5 py-1 text-[10px] font-semibold leading-tight text-sunny-300 drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)]">
              {activity.notice}
            </p>
          )}

          {/* Controls on black screen */}
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

      {/* Floating Toast Notice (tự động biến mất sau 1.25s) */}
      {hasImage && toastNotice && (
        <div className="pointer-events-none absolute bottom-5 z-40 max-w-[88%] transition-all duration-300">
          <div className="rounded-full bg-ink-950/95 border-2 border-sunny-400 px-4 py-1.5 text-center shadow-[0_6px_20px_rgba(0,0,0,0.9)] backdrop-blur-md">
            <p className="text-[12px] font-bold leading-tight text-sunny-300">
              {toastNotice}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

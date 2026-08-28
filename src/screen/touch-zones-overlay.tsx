import { useState, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import {
  DISPLAY_SIZE,
  getSwipeDirection,
  getTouchZone,
  toDevicePoint,
  type SwipeDirection,
  type TouchStart,
  type TouchZonesConfig,
} from './touch-input';

interface TouchZonesOverlayProps {
  config: TouchZonesConfig;
  onTouch: (gesture: 'tap' | 'swipe', zone?: string, direction?: SwipeDirection) => void;
}

export function TouchZonesOverlay({ config, onTouch }: TouchZonesOverlayProps) {
  const [activeZone, setActiveZone] = useState<string | null>(null);
  const startPoint = useRef<TouchStart | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { mode, zonesCount, layout = 'split_vertical' } = config;

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pt = toDevicePoint(e.clientX, e.clientY, rect);
    startPoint.current = { ...pt, at: e.timeStamp };
    e.currentTarget.setPointerCapture(e.pointerId);

    if (mode === 'tap') {
      const z = getTouchZone(pt, zonesCount, layout);
      setActiveZone(z);
    }
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const start = startPoint.current;
    startPoint.current = null;
    setActiveZone(null);

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || !start) return;

    const end = { ...toDevicePoint(e.clientX, e.clientY, rect), at: e.timeStamp };

    if (mode === 'swipe') {
      const dir = getSwipeDirection(start, end);
      if (dir) {
        onTouch('swipe', undefined, dir);
      }
    } else {
      const zone = getTouchZone(end, zonesCount, layout);
      onTouch('tap', zone);
    }
  };

  const handlePointerCancel = () => {
    startPoint.current = null;
    setActiveZone(null);
  };

  return (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      className="absolute inset-0 z-30 flex items-center justify-center select-none cursor-pointer rounded-full overflow-hidden"
    >
      {/* Semi-transparent interactive backdrop */}
      <div className="absolute inset-0 bg-ink-950/20 backdrop-blur-[1px]" />

      {mode === 'tap' && renderTapLayout(zonesCount, layout, activeZone, (z) => onTouch('tap', z))}
      {mode === 'swipe' && renderSwipeLayout((dir) => onTouch('swipe', undefined, dir))}

      {/* Floating Mode Badge */}
      <div className="pointer-events-none absolute bottom-4 px-3 py-1 rounded-full bg-ink-900/80 border border-cream-100/20 backdrop-blur-md shadow-lg">
        <p className="text-[11px] font-bold text-cream-100 tracking-wide flex items-center gap-1.5 animate-pulse">
          {mode === 'tap' ? '👆 Chạm để chọn' : '👉 Vuốt để trả lời'}
        </p>
      </div>
    </div>
  );
}

function renderTapLayout(
  zonesCount: number,
  layout: string,
  activeZone: string | null,
  onSelect: (zone: string) => void,
) {
  if (zonesCount === 2) {
    if (layout === 'split_horizontal') {
      return (
        <div className="absolute inset-0 flex flex-col pointer-events-none">
          <div
            onClick={(e) => {
              e.stopPropagation();
              onSelect('zone_1');
            }}
            className={`pointer-events-auto flex-1 flex flex-col items-center justify-center border-b border-cream-100/30 transition-all ${
              activeZone === 'zone_1' ? 'bg-mint-400/30 ring-2 ring-mint-300' : 'bg-cream-100/5 hover:bg-cream-100/15'
            }`}
          >
            <span className="text-sm font-black text-cream-100 bg-ink-900/60 px-3 py-1 rounded-full border border-cream-100/20 shadow">
              Phần Trên (1)
            </span>
          </div>
          <div
            onClick={(e) => {
              e.stopPropagation();
              onSelect('zone_2');
            }}
            className={`pointer-events-auto flex-1 flex flex-col items-center justify-center transition-all ${
              activeZone === 'zone_2' ? 'bg-mint-400/30 ring-2 ring-mint-300' : 'bg-cream-100/5 hover:bg-cream-100/15'
            }`}
          >
            <span className="text-sm font-black text-cream-100 bg-ink-900/60 px-3 py-1 rounded-full border border-cream-100/20 shadow">
              Phần Dưới (2)
            </span>
          </div>
        </div>
      );
    }

    // Default 2 zones: split_vertical
    return (
      <div className="absolute inset-0 flex pointer-events-none">
        <div
          onClick={(e) => {
            e.stopPropagation();
            onSelect('zone_1');
          }}
          className={`pointer-events-auto flex-1 flex flex-col items-center justify-center border-r border-cream-100/30 transition-all ${
            activeZone === 'zone_1' ? 'bg-mint-400/30 ring-2 ring-mint-300' : 'bg-cream-100/5 hover:bg-cream-100/15'
          }`}
        >
          <span className="text-sm font-black text-cream-100 bg-ink-900/60 px-3 py-1 rounded-full border border-cream-100/20 shadow">
            Trái (1)
          </span>
        </div>
        <div
          onClick={(e) => {
            e.stopPropagation();
            onSelect('zone_2');
          }}
          className={`pointer-events-auto flex-1 flex flex-col items-center justify-center transition-all ${
            activeZone === 'zone_2' ? 'bg-mint-400/30 ring-2 ring-mint-300' : 'bg-cream-100/5 hover:bg-cream-100/15'
          }`}
        >
          <span className="text-sm font-black text-cream-100 bg-ink-900/60 px-3 py-1 rounded-full border border-cream-100/20 shadow">
            Phải (2)
          </span>
        </div>
      </div>
    );
  }

  if (zonesCount === 3) {
    return (
      <div className="absolute inset-0 flex pointer-events-none">
        {[1, 2, 3].map((num) => {
          const zId = `zone_${num}`;
          return (
            <div
              key={zId}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(zId);
              }}
              className={`pointer-events-auto flex-1 flex flex-col items-center justify-center border-r border-cream-100/25 last:border-r-0 transition-all ${
                activeZone === zId ? 'bg-mint-400/30 ring-2 ring-mint-300' : 'bg-cream-100/5 hover:bg-cream-100/15'
              }`}
            >
              <span className="text-sm font-black text-cream-100 bg-ink-900/60 w-8 h-8 flex items-center justify-center rounded-full border border-cream-100/20 shadow">
                {num}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  if (zonesCount === 4) {
    return (
      <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 pointer-events-none">
        {[
          { id: 'zone_1', label: '1' },
          { id: 'zone_2', label: '2' },
          { id: 'zone_3', label: '3' },
          { id: 'zone_4', label: '4' },
        ].map((z) => (
          <div
            key={z.id}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(z.id);
            }}
            className={`pointer-events-auto flex items-center justify-center border border-cream-100/20 transition-all ${
              activeZone === z.id ? 'bg-mint-400/30 ring-2 ring-mint-300' : 'bg-cream-100/5 hover:bg-cream-100/15'
            }`}
          >
            <span className="text-sm font-black text-cream-100 bg-ink-900/60 w-8 h-8 flex items-center justify-center rounded-full border border-cream-100/20 shadow">
              {z.label}
            </span>
          </div>
        ))}
      </div>
    );
  }

  // 5 or 6 zones
  const total = Math.min(6, zonesCount);
  return (
    <div className="absolute inset-0 grid grid-cols-3 grid-rows-2 pointer-events-none">
      {Array.from({ length: total }, (_, i) => {
        const num = i + 1;
        const zId = `zone_${num}`;
        return (
          <div
            key={zId}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(zId);
            }}
            className={`pointer-events-auto flex items-center justify-center border border-cream-100/20 transition-all ${
              activeZone === zId ? 'bg-mint-400/30 ring-2 ring-mint-300' : 'bg-cream-100/5 hover:bg-cream-100/15'
            }`}
          >
            <span className="text-sm font-black text-cream-100 bg-ink-900/60 w-8 h-8 flex items-center justify-center rounded-full border border-cream-100/20 shadow">
              {num}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function renderSwipeLayout(onSwipe: (dir: SwipeDirection) => void) {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <div className="relative w-48 h-48 flex items-center justify-center">
        {/* Up Arrow */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSwipe('swipe_up');
          }}
          className="pointer-events-auto absolute top-1 flex flex-col items-center gap-0.5 p-2 rounded-xl bg-ink-900/70 hover:bg-ink-900 border border-cream-100/20 text-cream-100 active:scale-90 transition shadow-md"
        >
          <span className="text-lg leading-none">⬆️</span>
          <span className="text-[9px] font-bold">Lên</span>
        </button>

        {/* Down Arrow */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSwipe('swipe_down');
          }}
          className="pointer-events-auto absolute bottom-8 flex flex-col items-center gap-0.5 p-2 rounded-xl bg-ink-900/70 hover:bg-ink-900 border border-cream-100/20 text-cream-100 active:scale-90 transition shadow-md"
        >
          <span className="text-lg leading-none">⬇️</span>
          <span className="text-[9px] font-bold">Xuống</span>
        </button>

        {/* Left Arrow */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSwipe('swipe_left');
          }}
          className="pointer-events-auto absolute left-1 flex flex-col items-center gap-0.5 p-2 rounded-xl bg-ink-900/70 hover:bg-ink-900 border border-cream-100/20 text-cream-100 active:scale-90 transition shadow-md"
        >
          <span className="text-lg leading-none">⬅️</span>
          <span className="text-[9px] font-bold">Trái</span>
        </button>

        {/* Right Arrow */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSwipe('swipe_right');
          }}
          className="pointer-events-auto absolute right-1 flex flex-col items-center gap-0.5 p-2 rounded-xl bg-ink-900/70 hover:bg-ink-900 border border-cream-100/20 text-cream-100 active:scale-90 transition shadow-md"
        >
          <span className="text-lg leading-none">➡️</span>
          <span className="text-[9px] font-bold">Phải</span>
        </button>

        <div className="w-12 h-12 rounded-full border border-dashed border-cream-100/40 flex items-center justify-center text-xs font-semibold text-cream-200/60">
          Vuốt
        </div>
      </div>
    </div>
  );
}

/**
 * The touch window, drawn on the glass.
 *
 * Its whole job is to show the child the grid they are being graded against,
 * and to report where they pressed. What the press *means* — which branch runs
 * next — belongs to the server, never here.
 *
 * Everything is drawn from `layoutGeometry`, the same table `classifyTap` reads.
 * That is deliberate and it is the fix: this file used to keep its own idea of
 * the layouts, with its own names and its own shapes, and the two disagreed —
 * so the picture showed one thing and the verdict said another.
 *
 * Zones are real pie slices, because that is what the artwork is. Rectangles
 * over a sliced circle would light up the wrong region for every press near a
 * boundary, which is exactly the case a tester is trying to check.
 */

import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { toDevicePoint, DISPLAY_SIZE } from './touch-input';
import {
  classifyGesture,
  layoutGeometry,
  SCREEN_CENTER_X,
  SCREEN_CENTER_Y,
  SCREEN_RADIUS,
  type TouchClassificationResult,
  type TouchDetail,
  type TouchGestureSample,
  type TouchLayoutType,
  type TouchWindow,
} from './touch-layout';

interface TouchZonesOverlayProps {
  config: TouchWindow;
  onTouch: (result: TouchClassificationResult, detail: TouchDetail) => void;
}

/** Vietnamese names for the swipe directions, for the hint arrows. */
const SWIPE_HINTS: { result: TouchClassificationResult; label: string; icon: string; at: string }[] = [
  { result: 'vuot_len', label: 'Lên', icon: '⬆️', at: 'top-6 left-1/2 -translate-x-1/2' },
  { result: 'vuot_xuong', label: 'Xuống', icon: '⬇️', at: 'bottom-10 left-1/2 -translate-x-1/2' },
  { result: 'vuot_trai', label: 'Trái', icon: '⬅️', at: 'left-6 top-1/2 -translate-y-1/2' },
  { result: 'vuot_phai', label: 'Phải', icon: '➡️', at: 'right-6 top-1/2 -translate-y-1/2' },
];

export function TouchZonesOverlay({ config, onTouch }: TouchZonesOverlayProps) {
  const { layout } = config;
  const geometry = layoutGeometry(layout);

  const containerRef = useRef<HTMLDivElement>(null);
  const startPoint = useRef<TouchGestureSample | null>(null);
  // Reset between questions comes from the `key` at the mount point, not from
  // an effect: a new layout is a new window, and remounting is the honest way
  // to say so.
  const [activeZone, setActiveZone] = useState<TouchClassificationResult | null>(null);

  const sampleAt = (event: ReactPointerEvent<HTMLDivElement>): TouchGestureSample | null => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { ...toDevicePoint(event.clientX, event.clientY, rect), at: event.timeStamp };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const start = sampleAt(event);
    if (!start) return;
    startPoint.current = start;
    event.currentTarget.setPointerCapture(event.pointerId);
    // Preview only, and only for taps: a swipe has not happened yet at press-down.
    if (geometry.kind !== 'swipe') setActiveZone(classifyGesture(start, null, layout));
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const start = startPoint.current;
    startPoint.current = null;
    setActiveZone(null);
    if (!start) return;

    const end = sampleAt(event);
    if (!end) return;

    onTouch(classifyGesture(start, end, layout), {
      // Press-down, which is what §3.1 asks for: the point the child aimed at,
      // before their finger had a chance to slide.
      point: { x: start.x, y: start.y },
      durationMs: Math.max(0, Math.round(end.at - start.at)),
    });
  };

  const onPointerCancel = () => {
    startPoint.current = null;
    setActiveZone(null);
  };

  return (
    <div
      ref={containerRef}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      className="absolute inset-0 z-30 cursor-crosshair select-none overflow-hidden rounded-full"
    >
      {/* Faint, and no blur. The artwork underneath is the question — the grid
          is there to show where the boundaries fall, not to replace it. */}
      <svg
        viewBox={`0 0 ${DISPLAY_SIZE} ${DISPLAY_SIZE}`}
        className="pointer-events-none absolute inset-0 h-full w-full"
      >
        <ZoneShapes layout={layout} activeZone={activeZone} />
      </svg>

      {geometry.kind === 'swipe' && (
        <div className="pointer-events-none absolute inset-0">
          {SWIPE_HINTS.map((hint) => (
            <span
              key={hint.result}
              className={`absolute flex flex-col items-center gap-0.5 rounded-xl border border-cream-100/20 bg-ink-900/70 px-2 py-1 text-cream-100 shadow-md ${hint.at}`}
            >
              <span className="text-base leading-none">{hint.icon}</span>
              <span className="text-[9px] font-bold">{hint.label}</span>
            </span>
          ))}
        </div>
      )}

      <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-cream-100/20 bg-ink-900/80 px-3 py-1 shadow-lg backdrop-blur-md">
        <p className="text-[11px] font-bold tracking-wide text-cream-100">
          {geometry.kind === 'swipe' ? '👉 Vuốt để trả lời' : '👆 Chạm để chọn'}
        </p>
      </div>
    </div>
  );
}

/**
 * The zone boundaries, as SVG.
 *
 * Numbers are device pixels throughout, so the shape drawn and the shape
 * classified are the same arithmetic.
 */
function ZoneShapes({
  layout,
  activeZone,
}: {
  layout: TouchLayoutType;
  activeZone: TouchClassificationResult | null;
}) {
  const geometry = layoutGeometry(layout);

  const fill = (zone: string) =>
    activeZone === zone ? 'rgba(74,222,128,0.35)' : 'rgba(255,255,255,0.06)';
  const stroke = 'rgba(255,255,255,0.55)';

  if (geometry.kind === 'swipe') {
    return <circle cx={SCREEN_CENTER_X} cy={SCREEN_CENTER_Y} r={SCREEN_RADIUS - 1} fill="none" stroke={stroke} strokeWidth={2} />;
  }

  if (geometry.kind === 'halves') {
    const horizontal = geometry.split === 'horizontal';
    return (
      <>
        <path
          d={halfPath(horizontal, true)}
          fill={fill('zone1')}
          stroke={stroke}
          strokeWidth={2}
        />
        <path
          d={halfPath(horizontal, false)}
          fill={fill('zone2')}
          stroke={stroke}
          strokeWidth={2}
        />
        <ZoneLabel
          x={horizontal ? SCREEN_CENTER_X : SCREEN_RADIUS / 2}
          y={horizontal ? SCREEN_RADIUS / 2 : SCREEN_CENTER_Y}
          text="1"
        />
        <ZoneLabel
          x={horizontal ? SCREEN_CENTER_X : SCREEN_CENTER_X + SCREEN_RADIUS / 2}
          y={horizontal ? SCREEN_CENTER_Y + SCREEN_RADIUS / 2 : SCREEN_CENTER_Y}
          text="2"
        />
      </>
    );
  }

  if (geometry.kind === 'quadrants') {
    const deadRadius = geometry.deadRadius;
    const quadrants = [
      { zone: 'zone1', from: 270, to: 360, labelDeg: 315, num: '1' },
      { zone: 'zone2', from: 0, to: 90, labelDeg: 45, num: '2' },
      { zone: 'zone3', from: 90, to: 180, labelDeg: 135, num: '3' },
      { zone: 'zone4', from: 180, to: 270, labelDeg: 225, num: '4' },
    ];
    return (
      <>
        {quadrants.map(({ zone, from, to, labelDeg, num }) => {
          const label = polar(labelDeg, (SCREEN_RADIUS + deadRadius) / 2);
          return (
            <g key={zone}>
              <path d={sectorPath(from, to)} fill={fill(zone)} stroke={stroke} strokeWidth={2} />
              <ZoneLabel x={label.x} y={label.y} text={num} />
            </g>
          );
        })}
        <circle
          cx={SCREEN_CENTER_X}
          cy={SCREEN_CENTER_Y}
          r={deadRadius}
          fill={activeZone === 'cham_khac' ? 'rgba(248,113,113,0.35)' : 'rgba(0,0,0,0.25)'}
          stroke={stroke}
          strokeWidth={2}
          strokeDasharray="5 4"
        />
      </>
    );
  }

  const { sectors, deadRadius } = geometry;
  const sectorDeg = 360 / sectors;

  return (
    <>
      {Array.from({ length: sectors }, (_, i) => {
        const zone = `zone${i + 1}`;
        // Zone 1 *starts* at 12 o'clock, so a boundary line sits on it and the
        // sectors run clockwise from there — the same arithmetic `classifyTap`
        // does. Half a sector out here is the single easiest way to make every
        // answer look like a content bug.
        const from = i * sectorDeg;
        const label = polar(from + sectorDeg / 2, (SCREEN_RADIUS + deadRadius) / 2);
        return (
          <g key={zone}>
            <path d={sectorPath(from, from + sectorDeg)} fill={fill(zone)} stroke={stroke} strokeWidth={2} />
            <ZoneLabel x={label.x} y={label.y} text={String(i + 1)} />
          </g>
        );
      })}
      {/* The dead centre. Drawn because it is a real answer — `cham_khac` —
          and a child who taps a hole they cannot see just taps harder. */}
      <circle
        cx={SCREEN_CENTER_X}
        cy={SCREEN_CENTER_Y}
        r={deadRadius}
        fill={activeZone === 'cham_khac' ? 'rgba(248,113,113,0.35)' : 'rgba(0,0,0,0.25)'}
        stroke={stroke}
        strokeWidth={2}
        strokeDasharray="5 4"
      />
    </>
  );
}

function ZoneLabel({ x, y, text }: { x: number; y: number; text: string }) {
  return (
    <>
      <circle cx={x} cy={y} r={15} fill="rgba(24,20,18,0.7)" stroke="rgba(255,255,255,0.3)" />
      <text
        x={x}
        y={y}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={16}
        fontWeight="bold"
        fill="#fff"
      >
        {text}
      </text>
    </>
  );
}

/** Half the circle: top/bottom when `horizontal`, else left/right. */
function halfPath(horizontal: boolean, first: boolean): string {
  const r = SCREEN_RADIUS;
  if (horizontal) {
    return first
      ? `M 0,${r} A ${r},${r} 0 0 1 ${2 * r},${r} Z`
      : `M ${2 * r},${r} A ${r},${r} 0 0 1 0,${r} Z`;
  }
  return first
    ? `M ${r},${2 * r} A ${r},${r} 0 0 1 ${r},0 Z`
    : `M ${r},0 A ${r},${r} 0 0 1 ${r},${2 * r} Z`;
}

/** A pie slice between two angles, measured clockwise from 12 o'clock. */
function sectorPath(fromDeg: number, toDeg: number): string {
  const a = polar(fromDeg, SCREEN_RADIUS);
  const b = polar(toDeg, SCREEN_RADIUS);
  const large = toDeg - fromDeg > 180 ? 1 : 0;
  return `M ${SCREEN_CENTER_X},${SCREEN_CENTER_Y} L ${a.x},${a.y} A ${SCREEN_RADIUS},${SCREEN_RADIUS} 0 ${large} 1 ${b.x},${b.y} Z`;
}

/** Degrees clockwise from 12 o'clock, to a point at `radius`. */
function polar(deg: number, radius: number): { x: number; y: number } {
  const rad = ((deg - 90) * Math.PI) / 180;
  return {
    x: SCREEN_CENTER_X + radius * Math.cos(rad),
    y: SCREEN_CENTER_Y + radius * Math.sin(rad),
  };
}

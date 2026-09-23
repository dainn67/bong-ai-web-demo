/**
 * 360×360 px Circular Touch Screen Simulator for v3 Script Engine.
 * Features:
 * - 5 touch layouts: tb2, lr2, pie3, pie4, swipe
 * - 45px central dead zone visualization
 * - Touch-down coordinate capture & swipe vector analysis
 * - Visual zone overlay toggle for inspection
 */

import React, { useState, useRef, useCallback } from 'react';
import type { V3TouchLayout } from './types';

const DISPLAY_DIAMETER = 360;
const RADIUS = DISPLAY_DIAMETER / 2; // 180
const DEAD_ZONE_RADIUS = 45; // 25% of radius

interface CircularTouchSimulatorProps {
  layout?: V3TouchLayout;
  activeOrb?: string;
  activeImage?: string;
  onTouchReply?: (reply: string) => void;
  interactive?: boolean;
}

export const CircularTouchSimulator: React.FC<CircularTouchSimulatorProps> = ({
  layout,
  activeOrb = 'idle',
  activeImage,
  onTouchReply,
  interactive = true,
}) => {
  const [showOverlay, setShowOverlay] = useState(true);
  const [lastTouch, setLastTouch] = useState<{ x: number; y: number; zone: string } | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  const classifyTouchDown = useCallback(
    (x: number, y: number, currentLayout: V3TouchLayout): string => {
      const dx = x - RADIUS;
      const dy = y - RADIUS;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Outside round screen
      if (dist > RADIUS) return 'miss';

      // Dead zone for pie3 and pie4
      if ((currentLayout === 'pie3' || currentLayout === 'pie4') && dist <= DEAD_ZONE_RADIUS) {
        return 'miss';
      }

      if (currentLayout === 'tb2') {
        return dy < 0 ? 'zone1' : 'zone2';
      }

      if (currentLayout === 'lr2') {
        return dx < 0 ? 'zone1' : 'zone2';
      }

      if (currentLayout === 'pie3') {
        // 3 sectors of 120 deg
        let angle = (Math.atan2(dy, dx) * 180) / Math.PI; // -180 to 180
        if (angle < 0) angle += 360; // 0 to 360, 0 is at 3 o'clock
        // Sector 1: top-right to bottom-right, etc.
        // Let's divide into 3 equal 120° slices starting from top (270° or -90°)
        const shifted = (angle + 90) % 360;
        if (shifted < 120) return 'zone1';
        if (shifted < 240) return 'zone2';
        return 'zone3';
      }

      if (currentLayout === 'pie4') {
        // 4 sectors of 90 deg, zone 1 starts at 12 o'clock (270°), clockwise
        let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
        if (angle < 0) angle += 360;
        // Shift by 45° so 12 o'clock is centered, or exact quadrants:
        // Zone 1: 315° to 45° (Top), Zone 2: 45° to 135° (Right), Zone 3: 135° to 225° (Bottom), Zone 4: 225° to 315° (Left)
        const shifted = (angle + 45) % 360;
        if (shifted < 90) return 'zone2'; // right
        if (shifted < 180) return 'zone3'; // bottom
        if (shifted < 270) return 'zone4'; // left
        return 'zone1'; // top
      }

      return 'zone1';
    },
    [],
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!interactive || !layout) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    pointerStartRef.current = { x, y, time: Date.now() };

    if (layout !== 'swipe') {
      const zone = classifyTouchDown(x, y, layout);
      setLastTouch({ x, y, zone });
      if (onTouchReply) {
        onTouchReply(zone);
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!interactive || layout !== 'swipe' || !pointerStartRef.current) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const endX = e.clientX - rect.left;
    const endY = e.clientY - rect.top;
    const start = pointerStartRef.current;
    pointerStartRef.current = null;

    const dx = endX - start.x;
    const dy = endY - start.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const duration = Date.now() - start.time;

    // Spec: distance >= 60px, duration <= 800ms, dominant axis >= 1.5x
    if (dist >= 60 && duration <= 800) {
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      let swipeReply = 'miss';
      if (absDx >= 1.5 * absDy) {
        swipeReply = dx > 0 ? 'swipe_right' : 'swipe_left';
      } else if (absDy >= 1.5 * absDx) {
        swipeReply = dy > 0 ? 'swipe_down' : 'swipe_up';
      }

      setLastTouch({ x: endX, y: endY, zone: swipeReply });
      if (onTouchReply) {
        onTouchReply(swipeReply);
      }
    } else {
      setLastTouch({ x: endX, y: endY, zone: 'miss' });
      if (onTouchReply) onTouchReply('miss');
    }
  };

  return (
    <div className="flex flex-col items-center gap-3">
      {/* 360x360 Circular Frame */}
      <div
        style={{ width: DISPLAY_DIAMETER, height: DISPLAY_DIAMETER }}
        className="relative rounded-full overflow-hidden bg-slate-950 border-4 border-slate-700 shadow-2xl select-none cursor-pointer touch-none"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
      >
        {/* Background visual or Orb expression */}
        {activeImage ? (
          <img src={activeImage} alt="Visual" className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white">
            <span className="text-6xl animate-pulse">
              {activeOrb === 'happy' && '😄'}
              {activeOrb === 'thinking' && '🤔'}
              {activeOrb === 'surprised' && '😲'}
              {activeOrb === 'delicious' && '😋'}
              {activeOrb === 'cool' && '😎'}
              {activeOrb === 'crying' && '😢'}
              {activeOrb === 'winking' && '😉'}
              {activeOrb === 'loving' && '🥰'}
              {activeOrb === 'sleepy' && '😴'}
              {activeOrb === 'idle' && '🙂'}
            </span>
            <span className="mt-2 text-xs font-semibold text-slate-400 capitalize">{activeOrb}</span>
          </div>
        )}

        {/* Visual Zone Overlays */}
        {showOverlay && layout && (
          <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 360 360">
            {layout === 'tb2' && (
              <>
                <line x1="0" y1="180" x2="360" y2="180" stroke="rgba(255,255,255,0.4)" strokeWidth="2" strokeDasharray="4 4" />
                <text x="180" y="100" fill="rgba(255,255,255,0.8)" textAnchor="middle" fontSize="14" fontWeight="bold">zone1 (Trên)</text>
                <text x="180" y="270" fill="rgba(255,255,255,0.8)" textAnchor="middle" fontSize="14" fontWeight="bold">zone2 (Dưới)</text>
              </>
            )}

            {layout === 'lr2' && (
              <>
                <line x1="180" y1="0" x2="180" y2="360" stroke="rgba(255,255,255,0.4)" strokeWidth="2" strokeDasharray="4 4" />
                <text x="90" y="185" fill="rgba(255,255,255,0.8)" textAnchor="middle" fontSize="14" fontWeight="bold">zone1 (Trái)</text>
                <text x="270" y="185" fill="rgba(255,255,255,0.8)" textAnchor="middle" fontSize="14" fontWeight="bold">zone2 (Phải)</text>
              </>
            )}

            {layout === 'pie4' && (
              <>
                <line x1="0" y1="0" x2="360" y2="360" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
                <line x1="360" y1="0" x2="0" y2="360" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
                <circle cx="180" cy="180" r={DEAD_ZONE_RADIUS} fill="rgba(239, 68, 68, 0.25)" stroke="rgba(239, 68, 68, 0.8)" strokeWidth="2" />
                <text x="180" y="80" fill="white" textAnchor="middle" fontSize="13" fontWeight="bold">zone1</text>
                <text x="290" y="185" fill="white" textAnchor="middle" fontSize="13" fontWeight="bold">zone2</text>
                <text x="180" y="300" fill="white" textAnchor="middle" fontSize="13" fontWeight="bold">zone3</text>
                <text x="70" y="185" fill="white" textAnchor="middle" fontSize="13" fontWeight="bold">zone4</text>
                <text x="180" y="184" fill="#fca5a5" textAnchor="middle" fontSize="10">Vùng Chết</text>
              </>
            )}

            {layout === 'pie3' && (
              <>
                <circle cx="180" cy="180" r={DEAD_ZONE_RADIUS} fill="rgba(239, 68, 68, 0.25)" stroke="rgba(239, 68, 68, 0.8)" strokeWidth="2" />
                <text x="180" y="90" fill="white" textAnchor="middle" fontSize="13" fontWeight="bold">zone1</text>
                <text x="260" y="250" fill="white" textAnchor="middle" fontSize="13" fontWeight="bold">zone2</text>
                <text x="100" y="250" fill="white" textAnchor="middle" fontSize="13" fontWeight="bold">zone3</text>
              </>
            )}

            {layout === 'swipe' && (
              <text x="180" y="185" fill="rgba(255,255,255,0.6)" textAnchor="middle" fontSize="14">
                Vuốt (Trượt ngón tay &gt;60px)
              </text>
            )}
          </svg>
        )}

        {/* Touch Ripple Marker */}
        {lastTouch && (
          <div
            style={{ left: lastTouch.x - 12, top: lastTouch.y - 12 }}
            className="absolute w-6 h-6 rounded-full bg-emerald-400/80 border-2 border-white animate-ping pointer-events-none"
          />
        )}
      </div>

      {/* Control / Status Bar */}
      <div className="flex items-center justify-between w-full max-w-[360px] text-xs text-slate-400 px-1">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={showOverlay}
            onChange={(e) => setShowOverlay(e.target.checked)}
            className="rounded border-slate-700"
          />
          <span>Hiện lưới cảm ứng ({layout || 'không'})</span>
        </label>
        {lastTouch && (
          <span className="font-mono text-emerald-400">
            Kết quả: <strong className="text-white">{lastTouch.zone}</strong>
          </span>
        )}
      </div>
    </div>
  );
};

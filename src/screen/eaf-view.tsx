/**
 * EAF (Espressif Animation Format) Viewer & Player for Web Simulator.
 *
 * Provides:
 * 1. `isEafUrl`: detects .eaf files
 * 2. `extractEmoteName`: extracts emote key (e.g. 'happy', 'crying', 'thinking')
 * 3. `EafScreenView`: Animated Canvas decoder with fallback Robot Emote Face on the round badge screen
 * 4. `EafThumbnail`: Mini robot emote badge for Lesson Studio tables & cards
 */

import { useEffect, useRef, useState } from 'react';
import { cdnUrl } from '../lessons/catalog';

export function isEafUrl(url?: string | null): boolean {
  if (!url) return false;
  const clean = url.split('?')[0].trim().toLowerCase();
  return clean.endsWith('.eaf') || clean.includes('.eaf.') || clean.includes('.eaf');
}

export function normalizeEafUrl(url?: string | null): string {
  if (!url) return '';
  // Strip .360.png or other unwanted suffixes that might be appended
  if (url.includes('.eaf.')) {
    return url.replace(/\.eaf\..*$/i, '.eaf');
  }
  return url;
}

export function extractEmoteName(urlOrFileName?: string | null): string {
  if (!urlOrFileName) return 'neutral';
  const normalized = normalizeEafUrl(urlOrFileName);
  const clean = normalized.split('?')[0].trim();
  const base = clean.split('/').pop() || clean;
  const withoutExt = base.replace(/\.eaf$/i, '');
  if (withoutExt.toLowerCase().startsWith('ezgif')) {
    return 'robot';
  }
  // Clean order prefixes like "order_1_happy" -> "happy" if recognizable
  const parts = withoutExt.split(/[_\-\s]+/);
  for (const part of parts.reverse()) {
    const p = part.toLowerCase();
    if (EMOTE_MAP[p]) return p;
  }
  return parts[parts.length - 1] || withoutExt;
}

export interface EmoteMeta {
  emoji: string;
  label: string;
  bgGradient: string;
  glowColor: string;
}

export const EMOTE_MAP: Record<string, EmoteMeta> = {
  robot: { emoji: '🤖', label: 'Robot Bống (.EAF)', bgGradient: 'from-blue-500/25 to-indigo-600/35', glowColor: 'rgba(99, 102, 241, 0.45)' },
  ezgif: { emoji: '🤖', label: 'Robot Bống (.EAF)', bgGradient: 'from-blue-500/25 to-indigo-600/35', glowColor: 'rgba(99, 102, 241, 0.45)' },
  happy: { emoji: '😊', label: 'Vui vẻ', bgGradient: 'from-amber-400/25 to-orange-500/35', glowColor: 'rgba(251, 191, 36, 0.45)' },
  crying: { emoji: '😭', label: 'Khóc nhè', bgGradient: 'from-sky-400/25 to-blue-600/35', glowColor: 'rgba(56, 189, 248, 0.45)' },
  sad: { emoji: '😢', label: 'Buồn bã', bgGradient: 'from-indigo-400/25 to-slate-600/35', glowColor: 'rgba(129, 140, 248, 0.45)' },
  angry: { emoji: '😠', label: 'Tức giận', bgGradient: 'from-rose-500/25 to-red-600/35', glowColor: 'rgba(244, 63, 94, 0.45)' },
  surprised: { emoji: '😮', label: 'Ngạc nhiên', bgGradient: 'from-yellow-400/25 to-amber-500/35', glowColor: 'rgba(250, 204, 21, 0.45)' },
  thinking: { emoji: '🤔', label: 'Suy nghĩ', bgGradient: 'from-purple-400/25 to-indigo-500/35', glowColor: 'rgba(192, 132, 252, 0.45)' },
  excited: { emoji: '🤩', label: 'Phấn khích', bgGradient: 'from-amber-300/25 to-pink-500/35', glowColor: 'rgba(244, 114, 182, 0.45)' },
  cool: { emoji: '😎', label: 'Cực ngầu', bgGradient: 'from-teal-400/25 to-emerald-600/35', glowColor: 'rgba(45, 212, 191, 0.45)' },
  delicious: { emoji: '😋', label: 'Ngon tuyệt', bgGradient: 'from-orange-400/25 to-amber-500/35', glowColor: 'rgba(251, 146, 60, 0.45)' },
  embarrassed: { emoji: '😳', label: 'Ngại ngùng', bgGradient: 'from-pink-400/25 to-rose-500/35', glowColor: 'rgba(251, 113, 133, 0.45)' },
  funny: { emoji: '🤪', label: 'Hài hước', bgGradient: 'from-lime-400/25 to-yellow-500/35', glowColor: 'rgba(163, 230, 53, 0.45)' },
  confident: { emoji: '😏', label: 'Tự tin', bgGradient: 'from-cyan-400/25 to-blue-500/35', glowColor: 'rgba(34, 211, 238, 0.45)' },
  confused: { emoji: '😕', label: 'Bối rối', bgGradient: 'from-violet-400/25 to-purple-600/35', glowColor: 'rgba(167, 139, 250, 0.45)' },
  idle: { emoji: '🙂', label: 'Nghỉ ngơi', bgGradient: 'from-emerald-400/25 to-teal-500/35', glowColor: 'rgba(52, 211, 153, 0.45)' },
  neutral: { emoji: '🙂', label: 'Bình thường', bgGradient: 'from-slate-400/25 to-slate-600/35', glowColor: 'rgba(148, 163, 184, 0.45)' },
  shocked: { emoji: '😱', label: 'Sửng sốt', bgGradient: 'from-blue-500/25 to-indigo-700/35', glowColor: 'rgba(99, 102, 241, 0.45)' },
  shy: { emoji: '🥺', label: 'E thẹn', bgGradient: 'from-pink-300/25 to-rose-400/35', glowColor: 'rgba(253, 164, 175, 0.45)' },
  sleepy: { emoji: '😴', label: 'Buồn ngủ', bgGradient: 'from-indigo-400/25 to-blue-900/35', glowColor: 'rgba(129, 140, 248, 0.45)' },
  wink: { emoji: '😉', label: 'Nháy mắt', bgGradient: 'from-yellow-400/25 to-amber-500/35', glowColor: 'rgba(250, 204, 21, 0.45)' },
  winking: { emoji: '😉', label: 'Nháy mắt', bgGradient: 'from-yellow-400/25 to-amber-500/35', glowColor: 'rgba(250, 204, 21, 0.45)' },
  loving: { emoji: '🥰', label: 'Yêu thương', bgGradient: 'from-rose-400/25 to-pink-600/35', glowColor: 'rgba(244, 63, 94, 0.45)' },
  laughing: { emoji: '😆', label: 'Cười lớn', bgGradient: 'from-amber-400/25 to-yellow-500/35', glowColor: 'rgba(251, 191, 36, 0.45)' },
  relaxed: { emoji: '😌', label: 'Thư giãn', bgGradient: 'from-emerald-400/25 to-teal-600/35', glowColor: 'rgba(52, 211, 153, 0.45)' },
  kissy: { emoji: '😘', label: 'Hôn gió', bgGradient: 'from-pink-400/25 to-rose-500/35', glowColor: 'rgba(244, 114, 182, 0.45)' },
  silly: { emoji: '😜', label: 'Nghịch ngợm', bgGradient: 'from-lime-400/25 to-green-500/35', glowColor: 'rgba(163, 230, 53, 0.45)' },
};

function getEmoteMeta(emoteKey: string): EmoteMeta {
  const k = emoteKey.toLowerCase();
  return (
    EMOTE_MAP[k] || {
      emoji: '🤖',
      label: emoteKey || 'Biểu cảm EAF',
      bgGradient: 'from-purple-500/25 to-indigo-600/35',
      glowColor: 'rgba(168, 85, 247, 0.45)',
    }
  );
}

/**
 * Decodes and plays .eaf file on an HTML5 canvas at 15 fps.
 * Returns true if successfully loaded and playing, false otherwise.
 */
function useEafCanvasPlayer(url: string, canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    if (!url || !isEafUrl(url)) {
      setIsPlaying(false);
      return;
    }

    let isMounted = true;
    let animTimer: number | null = null;

    async function loadAndPlay() {
      try {
        const normalized = normalizeEafUrl(url);
        const targetUrl = cdnUrl(normalized);
        const resp = await fetch(targetUrl);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const buf = await resp.arrayBuffer();
        if (!isMounted) return;

        const view = new DataView(buf);
        const bytes = new Uint8Array(buf);

        // Verify magic bytes: 0x89, 'E', 'A', 'F'
        if (bytes[0] !== 0x89 || bytes[1] !== 0x45 || bytes[2] !== 0x41 || bytes[3] !== 0x46) {
          throw new Error('Not an EAF file');
        }

        const numFrames = view.getUint32(4, true);
        if (numFrames === 0) throw new Error('No frames in EAF');

        // Frame region starts after header (16) + table (numFrames * 8)
        const frameRegionStart = 16 + numFrames * 8;
        const frameOffsets: { size: number; offset: number }[] = [];
        for (let i = 0; i < numFrames; i++) {
          const size = view.getUint32(16 + i * 8, true);
          const offset = view.getUint32(16 + i * 8 + 4, true);
          frameOffsets.push({ size, offset: frameRegionStart + offset });
        }

        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let curFrame = 0;
        setIsPlaying(true);

        const renderNextFrame = () => {
          if (!isMounted || !canvasRef.current) return;
          const { offset } = frameOffsets[curFrame];
          if (offset >= buf.byteLength) return;

          // Frame header
          // bytes[offset..offset+1] == "ZZ"
          const width = view.getUint16(offset + 12, true);
          const height = view.getUint16(offset + 14, true);
          const blockCount = view.getUint16(offset + 16, true);
          const blockHeight = view.getUint16(offset + 18, true);

          if (canvas.width !== width) canvas.width = width;
          if (canvas.height !== height) canvas.height = height;

          // Palette offset
          const paletteOffset = offset + 20 + blockCount * 4;
          const blocksStart = paletteOffset + 256 * 4;

          const imgData = ctx.createImageData(width, height);
          const pixels = imgData.data;

          let blockDataPtr = blocksStart;
          for (let b = 0; b < blockCount; b++) {
            const blkLen = view.getUint32(offset + 20 + b * 4, true);
            const blockEnd = blockDataPtr + blkLen;
            const startY = b * blockHeight;
            const endY = Math.min(height, startY + blockHeight);

            // First byte in block: 0 = RLE
            let ptr = blockDataPtr + 1;
            let currentPixel = startY * width;
            const maxPixel = endY * width;

            while (ptr < blockEnd && currentPixel < maxPixel) {
              const run = bytes[ptr++];
              const palIdx = bytes[ptr++];
              const palPos = paletteOffset + palIdx * 4;
              const blue = bytes[palPos];
              const green = bytes[palPos + 1];
              const red = bytes[palPos + 2];
              const alpha = bytes[palPos + 3];

              for (let r = 0; r < run && currentPixel < maxPixel; r++) {
                const pxIdx = currentPixel * 4;
                pixels[pxIdx] = red;
                pixels[pxIdx + 1] = green;
                pixels[pxIdx + 2] = blue;
                pixels[pxIdx + 3] = alpha;
                currentPixel++;
              }
            }

            blockDataPtr = blockEnd;
          }

          ctx.putImageData(imgData, 0, 0);

          curFrame = (curFrame + 1) % numFrames;
          animTimer = window.setTimeout(renderNextFrame, 1000 / 15); // 15 fps
        };

        renderNextFrame();
      } catch (err) {
        // Fallback to animated emote view
        console.warn('[EAFPlayer] Canvas decode skipped, fallback to avatar:', err);
        setIsPlaying(false);
      }
    }

    void loadAndPlay();

    return () => {
      isMounted = false;
      if (animTimer) clearTimeout(animTimer);
    };
  }, [url]);

  return isPlaying;
}

/**
 * Screen presentation of an EAF file inside the round screen.
 */
export function EafScreenView({ url, fileName }: { url: string; fileName?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isPlayingCanvas = useEafCanvasPlayer(url, canvasRef);
  const emoteKey = extractEmoteName(fileName || url);
  const meta = getEmoteMeta(emoteKey);

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-slate-950">
      {/* Canvas Layer for live EAF playback */}
      <canvas
        ref={canvasRef}
        className={`pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
          isPlayingCanvas ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Fallback Emote Avatar View */}
      <div
        className={`flex flex-col items-center justify-center gap-2 p-6 transition-opacity duration-300 ${
          isPlayingCanvas ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
      >
        <div
          className={`flex h-28 w-28 items-center justify-center rounded-full bg-gradient-to-b ${meta.bgGradient} border border-white/20 shadow-2xl animate-pulse`}
          style={{ boxShadow: `0 0 45px ${meta.glowColor}` }}
        >
          <span className="text-6xl drop-shadow-md select-none">{meta.emoji}</span>
        </div>

        <div className="flex flex-col items-center gap-0.5">
          <span className="rounded-full bg-purple-500/20 border border-purple-400/40 px-3 py-0.5 text-[11px] font-bold text-purple-300 font-mono tracking-wide">
            🤖 [EAF: {emoteKey}]
          </span>
          <span className="text-[10px] font-medium text-slate-400">{meta.label}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Mini EAF thumbnail for Lesson Studio (Table & Cards).
 */
export function EafThumbnail({
  url,
  fileName,
  size = 'md',
}: {
  url?: string | null;
  fileName?: string;
  size?: 'sm' | 'md';
}) {
  const emoteKey = extractEmoteName(fileName || url);
  const meta = getEmoteMeta(emoteKey);

  if (size === 'sm') {
    return (
      <div
        className="inline-flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-md border border-purple-300/80 dark:border-purple-700 bg-purple-100 dark:bg-purple-950 text-center shadow-xs"
        title={`Biểu cảm Robot (.eaf): ${emoteKey} (${fileName || url || ''})`}
      >
        <span className="text-sm leading-none">{meta.emoji}</span>
        <span className="text-[8px] font-bold text-purple-700 dark:text-purple-300 uppercase leading-none mt-0.5">
          EAF
        </span>
      </div>
    );
  }

  return (
    <div className="relative group shrink-0">
      <div
        className="flex h-14 w-14 flex-col items-center justify-center rounded-lg border border-purple-300 dark:border-purple-700 bg-gradient-to-b from-purple-50 to-purple-100 dark:from-purple-950 dark:to-slate-900 shadow-sm p-1"
        title={`Biểu cảm Robot (.eaf): ${emoteKey}`}
      >
        <span className="text-2xl drop-shadow-xs">{meta.emoji}</span>
        <span className="text-[9px] font-bold text-purple-700 dark:text-purple-300 font-mono truncate max-w-full">
          {emoteKey}.eaf
        </span>
      </div>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          title="Xem / Tải file .eaf gốc"
          className="absolute inset-0 flex items-center justify-center rounded-lg bg-ink-900/70 opacity-0 group-hover:opacity-100 text-white text-[10px] font-bold transition"
        >
          EAF ↗
        </a>
      )}
    </div>
  );
}

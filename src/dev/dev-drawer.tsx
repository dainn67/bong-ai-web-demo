/**
 * The instruments, beside the badge rather than over it.
 *
 * Everything in here is scaffolding no real badge has, so it stays shut by
 * default: the device is the thing being shown, and a packet log competing with
 * it for attention makes the product look like a debugging session.
 *
 * Open, though, it sits *next to* the badge on a wide screen and pushes the
 * page over to make room, because the two are read together. Watching a frame
 * arrive means tapping the glass and looking at the log in the same breath, and
 * the old dimmed scrim made that impossible twice over — it swallowed the tap,
 * and it blurred the screen you were trying to read the result off.
 *
 * Narrow screens have nowhere to put a second column, so there it stays an
 * overlay with a scrim you can dismiss by clicking away. Still no blur: the
 * badge behind it is information, not decoration.
 */

import { useEffect, type ReactNode } from 'react';
import { AuthPanel } from './auth-panel';
import { ConnectionPanel } from './connection-panel';
import { AudioPanel } from './audio-panel';
import { HardwarePanel } from './hardware-panel';
import { LessonPanel } from './lesson-panel';
import { PacketInspector } from './packet-inspector';
import { TouchTestPanel } from './touch-test-panel';

/** Bật/tắt nhanh mục Thử nghiệm Cảm ứng trong tab Kỹ thuật (đổi thành false để ẩn) */
export const SHOW_TOUCH_TEST_PANEL = true;
// export const SHOW_TOUCH_TEST_PANEL = false;

interface DevDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function DevDrawer({ open, onClose }: DevDrawerProps) {
  // Escape closes it. A panel that covers the demo needs a way out that does
  // not involve hunting for the button.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <>
      {/* Below `lg` only, where the drawer covers the badge anyway. Above it
          the badge stays live, so anything that ate clicks would defeat the
          point of having both on screen at once. */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-10 bg-ink-900/20 transition-opacity duration-300 lg:hidden ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      <aside
        className={`fixed inset-y-0 right-0 z-20 flex w-full max-w-[26rem] flex-col gap-4 overflow-y-auto bg-cream-100 p-5 shadow-[-16px_0_40px_-16px_rgba(61,44,36,0.4)] transition-transform duration-300 ease-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        aria-hidden={!open}
      >
        <header className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-ink-900">Công cụ</h2>
            <p className="text-xs text-ink-500">Thiết bị thật không có thứ nào trong này</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-ink-700 shadow-sm transition hover:bg-cream-200"
          >
            Đóng
          </button>
        </header>

        {/* First, and only while a lesson runs: it is the thing being watched. */}
        <LessonPanel />
        {SHOW_TOUCH_TEST_PANEL && <TouchTestPanel />}
        <ConnectionPanel />
        <AuthPanel />
        <HardwarePanel />
        <AudioPanel />
        <PacketInspector />
      </aside>
    </>
  );
}

/** Shared shell so every instrument sits on the same card. */
export function Panel({
  title,
  action,
  children,
  grow,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  grow?: boolean;
}) {
  return (
    <section
      className={`flex flex-col gap-3 rounded-blob bg-white p-4 shadow-[0_6px_20px_-14px_rgba(61,44,36,0.5)] ${
        grow ? 'min-h-0 flex-1' : ''
      }`}
    >
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wide text-ink-500">{title}</h3>
        {action}
      </header>
      {children}
    </section>
  );
}

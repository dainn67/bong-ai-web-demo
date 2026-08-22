/**
 * The instruments, tucked away.
 *
 * Everything in here is scaffolding no real badge has. It stays one click from
 * the demo rather than beside it: the device is the thing being shown, and a
 * packet log competing with it for attention makes the product look like a
 * debugging session.
 */

import { useEffect, type ReactNode } from 'react';
import { ConnectionPanel } from './connection-panel';
import { AudioPanel } from './audio-panel';
import { PacketInspector } from './packet-inspector';

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
      <div
        onClick={onClose}
        className={`fixed inset-0 z-10 bg-ink-900/20 backdrop-blur-[2px] transition-opacity duration-300 ${
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

        <ConnectionPanel />
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

/**
 * The badge's physical condition, as a set of dials.
 *
 * Everything here is something the real hardware measures about itself and
 * reports — and most of it is otherwise unreachable, since nothing in the
 * stack can produce a flat battery or a broken microphone on demand.
 */

import { useSimulatorStore } from '../store/simulator-store';
import {
  DEVICE_FAULTS,
  wifiBars,
  wifiQuality,
  LOW_BATTERY,
} from '../hardware/hardware-state';
import { Panel } from './dev-drawer';

export function HardwarePanel() {
  const hardware = useSimulatorStore((state) => state.hardware);
  const connected = useSimulatorStore((state) => state.status === 'connected');
  const setHardware = useSimulatorStore((state) => state.setHardware);

  return (
    <Panel title="Phần cứng" action={<TelemetryBadge connected={connected} />}>
      <Slider
        label="Pin"
        value={`${hardware.battery}%`}
        min={0}
        max={100}
        step={1}
        current={hardware.battery}
        danger={hardware.battery <= LOW_BATTERY}
        onChange={(battery) => setHardware({ battery })}
      />

      <div className="flex gap-2">
        <Toggle
          label="Đang sạc"
          on={hardware.charging}
          onChange={(charging) => setHardware({ charging })}
        />
        <Toggle
          label="Tự hao pin"
          on={hardware.autoDrain}
          onChange={(autoDrain) => setHardware({ autoDrain })}
        />
      </div>

      <Slider
        label="Sóng WiFi"
        value={`${hardware.wifiRssi} dBm · ${wifiQuality(hardware.wifiRssi)} ${'▮'.repeat(wifiBars(hardware.wifiRssi)) || '—'}`}
        min={-95}
        max={-40}
        step={1}
        current={hardware.wifiRssi}
        danger={hardware.wifiRssi < -85}
        onChange={(wifiRssi) => setHardware({ wifiRssi })}
      />

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-ink-500">Báo lỗi thiết bị</span>
        <select
          value={hardware.faultCode ?? ''}
          onChange={(event) => setHardware({ faultCode: event.target.value || null })}
          className="rounded-xl bg-cream-100 px-3 py-2 text-sm text-ink-900 outline-none"
        >
          <option value="">Bình thường</option>
          {DEVICE_FAULTS.map((fault) => (
            <option key={fault.code} value={fault.code}>
              {fault.label}
            </option>
          ))}
        </select>
      </label>

      <p className="text-xs text-ink-300">
        Nút bấm nằm trên thân máy — bấm nhanh để nói, giữ lâu để tạm biệt
      </p>
      <p className="text-xs text-ink-300">
        Pin và lỗi đi qua WebSocket (<code>battery</code>, <code>error</code>), rồi
        máy chủ ghi vào hàng thiết bị mà app phụ huynh đọc. Thiết bị thật cũng
        không có đường nào khác.
      </p>
    </Panel>
  );
}

/**
 * Whether condition is being reported at all.
 *
 * There is nothing more to say than this. The old badge here tracked an HTTP
 * POST and could report "đã gửi" or "lỗi"; the socket gives no acknowledgement,
 * so claiming delivery would be inventing it. Connected means the frames are
 * going out — where they land is the packet inspector's business.
 */
function TelemetryBadge({ connected }: { connected: boolean }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-bold ${
        connected ? 'bg-mint-400/20 text-mint-500' : 'bg-cream-200 text-ink-500'
      }`}
    >
      {connected ? 'đang gửi' : 'tắt'}
    </span>
  );
}

interface SliderProps {
  label: string;
  value: string;
  min: number;
  max: number;
  step: number;
  current: number;
  danger?: boolean;
  onChange: (value: number) => void;
}

function Slider({ label, value, min, max, step, current, danger, onChange }: SliderProps) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-baseline justify-between">
        <span className="text-xs font-semibold text-ink-500">{label}</span>
        <span className={`font-mono text-xs ${danger ? 'text-berry-500' : 'text-ink-700'}`}>
          {value}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={current}
        onChange={(event) => onChange(Number(event.target.value))}
        className={danger ? 'accent-berry-500' : 'accent-coral-500'}
      />
    </label>
  );
}

function Toggle({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className="flex flex-1 items-center justify-between gap-2 rounded-xl bg-cream-100 px-3 py-2">
      <span className="text-xs font-semibold text-ink-700">{label}</span>
      <input
        type="checkbox"
        checked={on}
        onChange={(event) => onChange(event.target.checked)}
        className="h-5 w-9 shrink-0 appearance-none rounded-full bg-cream-300 transition checked:bg-mint-400 before:block before:h-4 before:w-4 before:translate-x-0.5 before:translate-y-0.5 before:rounded-full before:bg-white before:transition checked:before:translate-x-[1.125rem]"
      />
    </label>
  );
}

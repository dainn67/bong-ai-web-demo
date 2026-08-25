/**
 * Provisioning — in the drawer, never on the badge.
 *
 * This panel replaced a parent login form, and the difference is the whole
 * point. The login form was a workaround: the browser held a parent's JWT
 * because the browser was running the lesson engine, and the lesson engine
 * needed `{userPhone}` and `{voiceID}` to build clip URLs. Real firmware has
 * never had a password, and simulating one simulated something that cannot
 * exist.
 *
 * The server runs the lesson now, so what the badge needs is not a session but
 * an *identity*: a `device_id` the backend recognises and has attached to a
 * child. `POST /devices/bind-by-phone` mints exactly that from a phone number
 * that is already registered. It is a bench operation — done once, stored, and
 * then never touched again while the device runs.
 *
 * Without it, `/lesson-sessions/start` answers `DEVICE_NOT_BOUND` and the badge
 * can chat but cannot learn. That failure arrives as a spoken refusal several
 * seconds after asking for a lesson, which is a miserable thing to debug, so
 * the panel says up front whether this badge is bound.
 */

import { useState } from 'react';
import { Panel } from './dev-drawer';
import { useSimulatorStore } from '../store/simulator-store';
import { bindByPhone, type BoundDevice } from '../api/provision-client';

export function BindPanel() {
  const config = useSimulatorStore((state) => state.config);
  const updateConfig = useSimulatorStore((state) => state.updateConfig);
  const status = useSimulatorStore((state) => state.status);
  const disconnect = useSimulatorStore((state) => state.disconnect);

  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bound, setBound] = useState<BoundDevice | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await bindByPhone(phone.trim(), { deviceName: config.deviceName });
      setBound(result);
      // The bound id *is* the device from here on: it is what `hello` carries
      // and what the orchestrator looks the child up by. Leaving the random MAC
      // in place would bind an account to a device that never connects.
      updateConfig({ macAddress: result.deviceId });
      // A socket opened under the old identity is now talking to the wrong
      // device row. Drop it rather than letting it look like it still works.
      if (status !== 'disconnected') disconnect();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Gán thiết bị">
      {bound ? (
        <Bound bound={bound} />
      ) : (
        <p className="text-xs leading-snug text-ink-500">
          Bài học cần thiết bị đã gán vào tài khoản phụ huynh — nếu chưa gán, máy
          chủ trả <code>DEVICE_NOT_BOUND</code> và Bống chỉ trò chuyện được.
          Số điện thoại phải <em>đã đăng ký</em> sẵn trong hệ thống.
        </p>
      )}

      <div className="flex flex-col gap-2">
        <input
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && phone.trim() && void submit()}
          placeholder="Số điện thoại phụ huynh"
          inputMode="tel"
          autoComplete="username"
          className="rounded-xl bg-cream-100 px-3 py-2 text-sm outline-none ring-coral-400 focus:ring-2"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || !phone.trim()}
          className="rounded-xl bg-coral-500 px-3 py-2 text-sm font-bold text-white transition active:scale-95 disabled:opacity-40"
        >
          {busy ? 'Đang gán…' : bound ? 'Gán lại' : 'Gán thiết bị'}
        </button>
        {error && <p className="text-xs font-medium text-berry-500">{error}</p>}
      </div>

      <p className="text-[11px] leading-snug text-ink-500">
        Máy chủ cấp <code>device_token</code> mới mỗi lần gán, và endpoint này
        không yêu cầu xác thực — chỉ dùng trên backend thử nghiệm.
      </p>
    </Panel>
  );
}

/**
 * What came back.
 *
 * `child_name` is the line that earns its place: it is proof the binding found
 * a real child row, which is the thing the lesson session actually needs. A
 * device id alone can be minted for an account with no children and would look
 * just as successful.
 */
function Bound({ bound }: { bound: BoundDevice }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
      <Field label="device_id" value={bound.deviceId} tone="ok" />
      <Field label="Phụ huynh" value={bound.phone} />
      <Field
        label="Bé"
        value={bound.childName ?? '— (chưa có bé)'}
        tone={bound.childName ? 'ok' : 'bad'}
      />
    </dl>
  );
}

function Field({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'bad' }) {
  const colour =
    tone === 'bad' ? 'text-berry-500' : tone === 'ok' ? 'text-mint-500' : 'text-ink-700';
  return (
    <>
      <dt className="font-semibold text-ink-500">{label}</dt>
      <dd className={`truncate font-medium ${colour}`}>{value}</dd>
    </>
  );
}

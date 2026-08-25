/**
 * Provisioning — the one HTTP call the badge makes that is not OTA.
 *
 * This is the browser equivalent of flashing a device on a bench: it happens
 * once per test account, before anything is running, and the thing it produces
 * is an identity. It is emphatically **not** a runtime API call. Nothing in the
 * conversation loop, the lesson loop or the screen ever reaches for it again —
 * after this, the simulator's only channels are OTA and the WebSocket.
 *
 * `POST /devices/bind-by-phone` takes a parent's phone number, finds the account
 * already in the database, attaches a child, and upserts a `UserDevice` under a
 * device id it will answer to. That is what makes a lesson session possible: the
 * backend refuses to start one for a device that is not bound to an account
 * (`DEVICE_NOT_BOUND`), and the simulator has no other way to become bound.
 *
 * Two things about the endpoint, both deliberate to know rather than discover:
 *
 * - **It takes no authentication.** Anyone who can reach the API can rebind any
 *   registered phone number to a device they control. That is a dev-harness
 *   affordance on a dev backend; do not build anything on it, and do not point
 *   this at a deployment that has real families on it.
 * - **It rotates `device_token` on every call.** The token it hands back is the
 *   only copy. Binding twice invalidates the first.
 *
 * It also returns a `websocket_url`, hardcoded to `ws://127.0.0.1:8003` in the
 * backend's `device_service.py`. It is ignored here. OTA is where the socket
 * address comes from — that is true of the real badge and it stays true here.
 */

/** Where the proxy puts `bong-api.bcserver.xyz`. See `/api` in vite.config. */
const API_BASE = '/api/v1';

const TIMEOUT_MS = 15_000;

export interface BoundDevice {
  deviceId: string;
  phone: string;
  childId: string | null;
  childName: string | null;
  deviceToken: string;
}

export class ProvisionError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ProvisionError';
    this.status = status;
  }
}

export interface BindOptions {
  /** Keeps an existing device id instead of letting the server mint `SIM_<digits>`. */
  deviceId?: string;
  deviceName?: string;
  signal?: AbortSignal;
}

/**
 * Binds this simulator to a registered parent account.
 *
 * Throws `ProvisionError` with the backend's own message, which is written in
 * Vietnamese and is genuinely the most useful thing to show — "Số điện thoại
 * chưa được đăng ký trong hệ thống" tells a tester exactly what to fix, and any
 * paraphrase of it here would be worse.
 */
export async function bindByPhone(phone: string, options: BindOptions = {}): Promise<BoundDevice> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  const response = await fetch(new URL(`${API_BASE}/devices/bind-by-phone`, location.origin), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone,
      device_id: options.deviceId,
      device_name: options.deviceName ?? 'Giả lập Robot Bống',
      hardware_model: 'esp32-s3-simulator',
    }),
    signal,
  });

  const text = await response.text();
  const json: unknown = text ? safeParse(text) : null;

  if (!response.ok) {
    throw new ProvisionError(messageFrom(json, response.status), response.status);
  }

  // `{success, data}` on the way out, like every other route on this backend.
  const data = isRecord(json) && isRecord(json.data) ? json.data : isRecord(json) ? json : {};
  const deviceId = asString(data.device_id);
  if (!deviceId) {
    throw new ProvisionError('Máy chủ không trả về device_id', response.status);
  }

  return {
    deviceId,
    phone: asString(data.phone) ?? phone,
    childId: asString(data.child_id),
    childName: asString(data.child_name),
    deviceToken: asString(data.device_token) ?? '',
  };
}

/**
 * Digs the human-readable half out of a FastAPI error.
 *
 * Measured against the live backend rather than assumed: this route raises
 * `HTTPException(detail={code, message})`, but something in the middleware
 * flattens it, and what actually arrives is
 * `{"success":false,"code":"USER_NOT_FOUND","message":"…"}` — no `detail` at
 * all. The nested shapes are still read first because other routes on this
 * backend do send them, and one day this one might again.
 */
function messageFrom(json: unknown, status: number): string {
  if (!isRecord(json)) return `HTTP ${status}`;
  const detail = json.detail;
  if (typeof detail === 'string') return detail;
  if (isRecord(detail)) return asString(detail.message) ?? `HTTP ${status}`;
  return asString(json.message) ?? `HTTP ${status}`;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

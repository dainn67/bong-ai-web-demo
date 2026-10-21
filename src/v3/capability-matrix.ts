/**
 * 3-Column Capability Matrix for V3 Simulator Studio Panel.
 *
 * Explicitly separates:
 * 1. Firmware Truth (on-device C++/ESP32 behavior)
 * 2. Simulator Parity (shared contract verified end-to-end in browser)
 * 3. Dev Harness Only (browser-only debugging conveniences)
 */

export interface CapabilityItem {
  id: string;
  title: string;
  desc: string;
  status: 'ready' | 'pending';
}

export interface CapabilityMatrix {
  firmwareTruth: CapabilityItem[];
  simulatorParity: CapabilityItem[];
  devHarnessOnly: CapabilityItem[];
}

export interface CapabilityRuntimeInput {
  hasManifest: boolean;
  hasUnwrappedKey: boolean;
  sdSceneCount: number;
  pendingJourneyLines: number;
}

export function getCapabilityMatrix(input: CapabilityRuntimeInput): CapabilityMatrix {
  return {
    firmwareTruth: [
      {
        id: 'efuse_k_dev',
        title: 'eFuse k_dev & NVS Wrapped Key',
        desc: 'ESP32 lưu k_dev trong eFuse, chỉ giữ wrapped key trên NVS và giải bọc AES-KW trong RAM.',
        status: 'ready',
      },
      {
        id: 'sd_staging_atomic',
        title: 'microSD Staging-First Sync',
        desc: 'Tải toàn bộ blob vào .staging.<ver>, kiểm tra SHA-256 rồi mới đổi tên nguyên tử.',
        status: 'ready',
      },
      {
        id: 'script_engine_fsm',
        title: 'Script Engine v3 & Excel When',
        desc: 'Đồ thị scene#step, retry 1 lần, silent_streak 4/4, INLIST, và chuyển cảnh Talk.',
        status: 'ready',
      },
      {
        id: 'compact_journey_ndjson',
        title: 'Compact NDJSON Outbox Sync',
        desc: 'Ghi dòng ev/sc/st ra /sdcard/logs/journey.ndjson và cắt sau khi nhận ack_seq.',
        status: 'ready',
      },
    ],
    simulatorParity: [
      {
        id: 'manifest_caps_bong',
        title: 'GET /device/manifest?caps=bong',
        desc: 'Tải manifest kênh thiết bị kèm BONG twin hashes và keys.content_key.',
        status: input.hasManifest ? 'ready' : 'pending',
      },
      {
        id: 'aes_kw_bong',
        title: 'RFC 3394 AES-KW + BONG AES-GCM',
        desc: 'Giải bọc 80-hex content_key trong RAM (không lưu plaintext vào localStorage) và giải mã BONG.',
        status: input.hasUnwrappedKey ? 'ready' : 'pending',
      },
      {
        id: 'listen_talk_handoff',
        title: 'Listen & Talk Handoff (HAHA ⇄ MAGIC_BOOK)',
        desc: 'Gửi multipart clip + nhận handoff.seed / handoff.target điều hướng liên cảnh.',
        status: 'ready',
      },
      {
        id: 'single_end_mutex_flush',
        title: 'Idempotent session_end & Single-Flight Flush',
        desc: `Đảm bảo đúng 1 dòng ev="end" mỗi sid và khóa chống trùng lặp flush (pending=${input.pendingJourneyLines}).`,
        status: 'ready',
      },
    ],
    devHarnessOnly: [
      {
        id: 'preview_journey',
        title: 'POST /api/journeys/preview (pv-*)',
        desc: 'Chỉ dùng trên trình duyệt/studio để lưu nhanh bản xem trước vào trang Admin.',
        status: 'ready',
      },
      {
        id: 'step_jump_inspector',
        title: 'Step Jump & Memory Inspector',
        desc: 'Nhảy bước bất kỳ, sửa nhanh biến bộ nhớ và giả lập câu trả lời không cần mic.',
        status: 'ready',
      },
      {
        id: 'embedded_talk_sandbox',
        title: 'Free Talk Sandbox Tab',
        desc: 'Tab thử nghiệm nhanh /device/talk/* bên trong bảng Kỹ Thuật V3.',
        status: 'ready',
      },
    ],
  };
}

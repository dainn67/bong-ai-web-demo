import { useState, useEffect } from 'react';

export interface QaAcceptanceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface TestCase {
  id: string;
  category: 'sync' | 'audio' | 'touch' | 'ai' | 'freetalk';
  title: string;
  steps: string;
  expected: string;
  critical: boolean;
}

const TEST_CASES: TestCase[] = [
  {
    id: 'TC-01',
    category: 'sync',
    title: 'Đồng bộ Virtual SD Card (Offline-First)',
    steps: 'Mở web http://localhost:5180/ -> Bật "Kỹ thuật" hoặc xem TalkBar -> Kiểm tra trạng thái Thẻ SD ảo -> Nhấn "Đồng bộ SD Card".',
    expected: 'Hệ thống tải thành công 50 asset files (47 WAV + 3 EAF) từ Backend 8000, lưu trữ tại IndexedDB. Báo trạng thái "Đã đồng bộ đầy đủ".',
    critical: true,
  },
  {
    id: 'TC-02',
    category: 'sync',
    title: 'Liên kết thiết bị & Đăng nhập Phụ huynh',
    steps: 'Bấm nút "Mã QR & Đăng nhập" trên góc phải Header -> Nhập SĐT 0123456789 / password123 -> Nhấn Đăng nhập.',
    expected: 'Hiện thông tin Phụ huynh và Bé Bống, MAC thiết bị được gán thành công, header chuyển sang trạng thái "👶 Bé Bống".',
    critical: false,
  },
  {
    id: 'TC-03',
    category: 'audio',
    title: 'Phát âm thanh tuần tự & Không chồng âm',
    steps: 'Chọn bài "HAHA", bắt đầu từ Step 0 (b7qsm). Lắng nghe Bống cất lời chào.',
    expected: 'Âm thanh giọng đọc phát từ file WAV đã mã hóa trên Virtual SD Card, âm thanh rõ ràng, không giật lag, không nuốt âm.',
    critical: true,
  },
  {
    id: 'TC-04',
    category: 'audio',
    title: 'Turn-Taking: Tách biệt "Bống nói" & "Bé nói"',
    steps: 'Quan sát viền màn hình và nhãn trạng thái khi Bống đang đọc thoại tại bất kỳ bước nào.',
    expected: 'Khi Bống đang nói: Viền viền vàng/xanh nhạt, nhãn "Bống đang nói...", Mic KHÔNG mở. Khi Bống dứt câu: Viền chuyển sang đỏ/xanh lá "Tới lượt bé nói", Mic mới tự động mở nếu bật Auto Mic.',
    critical: true,
  },
  {
    id: 'TC-05',
    category: 'audio',
    title: 'Tự động mở Mic (Auto-Mic)',
    steps: 'Đảm bảo công tắc "Auto Mic" trên thanh TalkBar đang bật (🟢). Đợi Bống kết thúc câu hỏi ở Step 0 hoặc Step 4.',
    expected: 'Mic tự động mở ngay khi Bống vừa ngưng lời thoại, nhãn hiển thị "🟢 Tới lượt bé nói (Mic đang mở)", bé có thể cất giọng nói ngay lập tức.',
    critical: true,
  },
  {
    id: 'TC-06',
    category: 'ai',
    title: 'Phân loại giọng nói AI (Prompt phan_loai)',
    steps: 'Tại Step 4 (bpelu), Bống yêu cầu bé đọc tiếng Anh từ "cat". Bật mic nói "cat" (hoặc nhập "cat" vào ô chat rồi gửi).',
    expected: 'Backend phân loại qua prompt phan_loai, khớp nhánh "cat", Bống khen ngợi phát âm chuẩn và chuyển sang bước tiếp theo.',
    critical: true,
  },
  {
    id: 'TC-07',
    category: 'touch',
    title: 'Cảm ứng chạm tròn 4 góc (Layout pie4)',
    steps: 'Tại Step 12 (b6lk1), Bống kích hoạt câu hỏi cảm ứng. Quan sát màn hình LCD tròn và click/chạm vào một trong 4 góc phần tư.',
    expected: 'Màn hình chia 4 góc phần tư nhấp nháy sinh động, click vào góc bất kỳ tạo hiệu ứng rung/sáng phản hồi và chuyển tiếp nhánh kịch bản.',
    critical: true,
  },
  {
    id: 'TC-08',
    category: 'touch',
    title: 'Cử chỉ vuốt 4 hướng (Layout swipe)',
    steps: 'Tại Step 20 (bxaft), Bống yêu cầu bé vuốt màn hình. Giữ chuột/ngón tay trên mặt kính và vuốt theo một hướng (Lên / Xuống / Trái / Phải).',
    expected: 'Mũi tên chỉ hướng hiển thị, hệ thống ghi nhận cử chỉ vuốt, phản hồi xúc giác và kích hoạt lời khen ngợi của Bống.',
    critical: true,
  },
  {
    id: 'TC-09',
    category: 'audio',
    title: 'Hoạt ảnh nhị phân Espressif (.eaf 15fps)',
    steps: 'Quan sát các bước có hoạt ảnh như haha_h_002.eaf (Step 12) hoặc haha_h_003.eaf (Step 20).',
    expected: 'File .eaf nhị phân được giải mã trực tiếp và vẽ canvas 15fps mượt mà trên khuôn mặt Bống, thay thế cho emote icon tĩnh thông thường.',
    critical: true,
  },
  {
    id: 'TC-10',
    category: 'ai',
    title: 'Lưu bộ nhớ Context {user.fav_color} & Cá nhân hoá',
    steps: 'Tại Step 29 (boakb), Bống hỏi bé thích màu gì. Nói hoặc nhập màu "đỏ" (hoặc "xanh"). Quan sát đến Step 36 (bsmjb).',
    expected: 'Câu trả lời được lưu vào biến nhớ {user.fav_color}. Đến Step 36, Bống nhắc lại chính xác màu bé đã chọn trong câu thoại.',
    critical: false,
  },
  {
    id: 'TC-11',
    category: 'freetalk',
    title: 'Chế độ Đàm thoại tự do (Free Talk v3)',
    steps: 'Bấm nút "🛠️ Debug" -> Nhấp chuyển sang tab "🎙️ Đàm thoại tự do Free Talk v3" -> Bật mic hoặc gõ câu hỏi trò chuyện tự do.',
    expected: 'Bống đóng vai trò người bạn thông thái, trả lời phù hợp với lứa tuổi trẻ nhỏ (Persona Bống), lọc các nội dung nhạy cảm theo Safety Guardrails.',
    critical: false,
  },
  {
    id: 'TC-12',
    category: 'sync',
    title: 'Nhảy bước tùy ý (Jump Step Inspector)',
    steps: 'Mở bảng "🛠️ Debug" -> Tại danh sách 42 bước của kịch bản HAHA, click vào bất kỳ Step nào (ví dụ: Step 12 hoặc Step 20).',
    expected: 'Engine nhảy tức thì đến bước được chọn, cập nhật đúng màn hình, biểu cảm, audio và layout tương tác của bước đó.',
    critical: false,
  },
];

type TabType = 'overview' | 'lesson_haha' | 'checklist' | 'services';

export function QaAcceptanceModal({ isOpen, onClose }: QaAcceptanceModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [testResults, setTestResults] = useState<Record<string, 'pass' | 'fail' | 'pending'>>({});
  const [copied, setCopied] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');

  // Load test results from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('bong_qa_test_matrix_v3');
      if (saved) {
        setTestResults(JSON.parse(saved) as Record<string, 'pass' | 'fail' | 'pending'>);
      }
    } catch {
      // Ignore storage errors
    }
  }, []);

  // Save test results to localStorage
  const updateTestStatus = (id: string, status: 'pass' | 'fail' | 'pending') => {
    const updated = { ...testResults, [id]: status };
    setTestResults(updated);
    try {
      localStorage.setItem('bong_qa_test_matrix_v3', JSON.stringify(updated));
    } catch {
      // Ignore storage errors
    }
  };

  const handleResetChecklist = () => {
    if (window.confirm('Bạn có chắc muốn đặt lại toàn bộ kết quả kiểm thử?')) {
      setTestResults({});
      try {
        localStorage.removeItem('bong_qa_test_matrix_v3');
      } catch {
        // Ignore
      }
    }
  };

  const handleCopyReport = () => {
    const total = TEST_CASES.length;
    const passed = TEST_CASES.filter((tc) => testResults[tc.id] === 'pass').length;
    const failed = TEST_CASES.filter((tc) => testResults[tc.id] === 'fail').length;
    const pending = total - passed - failed;

    const reportLines = [
      '# BÁO CÁO NGHIỆM THU KIỂM THỬ BỐNG AI V3',
      `Thời gian: ${new Date().toLocaleString('vi-VN')}`,
      `Môi trường: Web Simulator (http://localhost:5180/)`,
      `Tổng số ca kiểm thử: ${total} | Đạt: ${passed} | Không đạt: ${failed} | Chưa test: ${pending}`,
      '--------------------------------------------------',
      ...TEST_CASES.map((tc) => {
        const res = testResults[tc.id] || 'pending';
        const icon = res === 'pass' ? '✅ PASS' : res === 'fail' ? '❌ FAIL' : '⏳ PENDING';
        return `[${icon}] ${tc.id}: ${tc.title} -> Kỳ vọng: ${tc.expected}`;
      }),
      '--------------------------------------------------',
      'Xác nhận bởi QA / Tester Bống AI',
    ];

    navigator.clipboard.writeText(reportLines.join('\n')).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const passedCount = TEST_CASES.filter((tc) => testResults[tc.id] === 'pass').length;
  const progressPercent = Math.round((passedCount / TEST_CASES.length) * 100);

  const filteredTestCases = TEST_CASES.filter((tc) => {
    if (!searchFilter.trim()) return true;
    const q = searchFilter.toLowerCase();
    return tc.title.toLowerCase().includes(q) || tc.id.toLowerCase().includes(q) || tc.steps.toLowerCase().includes(q);
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5">
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-ink-950/60 backdrop-blur-sm transition-opacity animate-fade-in"
      />

      {/* Main Dialog Modal */}
      <div className="relative z-10 flex h-[90vh] w-full max-w-5xl flex-col rounded-3xl bg-white shadow-2xl overflow-hidden border border-cream-200">
        {/* Header Bar */}
        <div className="flex items-center justify-between border-b border-cream-200 bg-gradient-to-r from-cream-100 via-white to-cream-100 px-6 py-4 shrink-0">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-tr from-amber-500 to-coral-500 text-2xl shadow-md text-white">
              📋
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-black text-ink-900 tracking-tight">Sổ Tay Nghiệm Thu & Hướng Dẫn Test V3</h2>
                <span className="rounded-full bg-coral-500/10 px-2 py-0.5 text-xs font-bold text-coral-600 border border-coral-500/20">
                  Release v3.0 Staging
                </span>
              </div>
              <p className="text-xs text-ink-500">
                Tài liệu tổng hợp tính năng, quy trình kiểm thử kịch bản sản xuất và ma trận nghiệm thu dành cho QA
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyReport}
              className="hidden sm:flex items-center gap-1.5 rounded-xl bg-ink-900 px-3.5 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-ink-800 transition active:scale-95"
              title="Copy kết quả kiểm thử vào clipboard"
            >
              <span>{copied ? '✓ Đã copy!' : '📄 Xuất Báo Cáo'}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-cream-100 text-ink-600 hover:bg-cream-200 hover:text-ink-900 transition"
              title="Đóng cửa sổ"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-cream-200 bg-cream-50/80 px-6 py-2.5 shrink-0">
          <div className="flex items-center gap-2 overflow-x-auto py-1">
            <button
              type="button"
              onClick={() => setActiveTab('overview')}
              className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition whitespace-nowrap ${
                activeTab === 'overview'
                  ? 'bg-indigo-600 text-white shadow-sm ring-1 ring-indigo-500 font-black'
                  : 'text-ink-600 hover:bg-cream-200/80 hover:text-ink-900'
              }`}
            >
              <span>🌟</span>
              <span>1. Nâng Cấp 3 Giai Đoạn</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('lesson_haha')}
              className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition whitespace-nowrap ${
                activeTab === 'lesson_haha'
                  ? 'bg-coral-500 text-white shadow-sm ring-1 ring-coral-400 font-black'
                  : 'text-ink-600 hover:bg-cream-200/80 hover:text-ink-900'
              }`}
            >
              <span>📚</span>
              <span>2. Kịch Bản HAHA (42 Bước)</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('checklist')}
              className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition whitespace-nowrap ${
                activeTab === 'checklist'
                  ? 'bg-emerald-600 text-white shadow-sm ring-1 ring-emerald-500 font-black'
                  : 'text-ink-600 hover:bg-cream-200/80 hover:text-ink-900'
              }`}
            >
              <span>🧪</span>
              <span>3. Ma Trận Kiểm Thử ({passedCount}/{TEST_CASES.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('services')}
              className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition whitespace-nowrap ${
                activeTab === 'services'
                  ? 'bg-amber-600 text-white shadow-sm ring-1 ring-amber-500 font-black'
                  : 'text-ink-600 hover:bg-cream-200/80 hover:text-ink-900'
              }`}
            >
              <span>🛠️</span>
              <span>4. Môi Trường & Port</span>
            </button>
          </div>

          {/* Quick Progress Indicator */}
          <div className="flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-xl bg-white px-3 py-1.5 border border-cream-200 shadow-xs">
            <span className="text-xs font-bold text-ink-700 whitespace-nowrap">Tiến độ Test:</span>
            <div className="h-2 w-24 overflow-hidden rounded-full bg-cream-200">
              <div
                className="h-full bg-emerald-500 transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <span className="text-xs font-mono font-black text-emerald-600">{progressPercent}%</span>
          </div>
        </div>

        {/* Tab Content Area */}
        <div className="flex-1 overflow-y-auto p-6 text-sm text-ink-800 space-y-6">
          {/* TAB 1: OVERVIEW & 3 PHASES */}
          {activeTab === 'overview' && (
            <div className="space-y-8 animate-fade-in">
              {/* Executive Summary Hero Banner */}
              <div className="rounded-2xl bg-gradient-to-r from-indigo-900 via-indigo-950 to-slate-900 p-6 text-white shadow-md border border-indigo-800">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500 text-xl shadow-sm text-white">
                      🚀
                    </span>
                    <div>
                      <h3 className="text-base font-black tracking-tight text-white">
                        Lộ Trình Nâng Cấp Toàn Diện Kiến Trúc Bống AI V3
                      </h3>
                      <p className="text-xs text-indigo-300">
                        Bước nhảy vọt từ mô hình gọi API phụ thuộc mạng sang Hệ sinh thái <strong>Offline-First FSM Engine</strong>
                      </p>
                    </div>
                  </div>
                  <span className="rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-bold text-emerald-300 border border-emerald-500/30">
                    ✓ Hoàn tất cả 3 giai đoạn (Production Ready)
                  </span>
                </div>
                <p className="text-xs text-indigo-100/90 leading-relaxed">
                  Bống AI V3 giải quyết triệt để 3 rào cản lớn nhất của các thế hệ trước: <strong>độ trễ mạng</strong>, <strong>lỗi tranh chấp lượt nói (Turn-Taking)</strong>, và <strong>tương tác nghèo nàn</strong>. Toàn bộ kịch bản, âm thanh chất lượng phòng thu và hoạt ảnh nhị phân được mã hóa tải trước vào thẻ nhớ thiết bị (Virtual SD Card), kết hợp cùng công nghệ tự động mở mic (Auto-Mic) và cảm ứng tròn đa điểm.
                </p>
              </div>

              {/* Comparison Table: Old vs. New Architecture */}
              <div className="rounded-2xl bg-white border border-cream-200 overflow-hidden shadow-xs">
                <div className="bg-cream-100/80 px-5 py-3 border-b border-cream-200 flex items-center justify-between">
                  <h4 className="font-black text-ink-900 text-xs uppercase tracking-wider flex items-center gap-2">
                    <span>⚖️</span>
                    <span>Bảng Đối Chiếu So Sánh: Hệ Thống Cũ (V1/V2) vs. Kiến Trúc Mới (V3)</span>
                  </h4>
                  <span className="text-[11px] font-semibold text-ink-500">Dành cho Đội ngũ QA / Tester & Quản trị</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-cream-200 bg-cream-50 text-ink-600 font-bold">
                        <th className="py-2.5 px-4 w-1/4">Tiêu chí kỹ thuật</th>
                        <th className="py-2.5 px-4 w-3/8 text-rose-700 bg-rose-50/40">Hệ thống cũ (V1 / V2)</th>
                        <th className="py-2.5 px-4 w-3/8 text-emerald-800 bg-emerald-50/50">Kiến trúc mới V3 (Hiện tại)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-cream-100 text-ink-800">
                      <tr>
                        <td className="py-2.5 px-4 font-bold text-ink-900">1. Cơ chế phát bài học</td>
                        <td className="py-2.5 px-4 text-rose-800 bg-rose-50/20">
                          Streaming từng chunk qua WebSocket; mạng chập chờn sẽ bị đứng hình, giật tiếng, vấp âm.
                        </td>
                        <td className="py-2.5 px-4 text-emerald-900 bg-emerald-50/30 font-medium">
                          <strong>Offline-First:</strong> Tải trước 1 lần vào Virtual SD Card (FAT32/IndexedDB); chạy mượt mà 100% không cần mạng.
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-4 font-bold text-ink-900">2. Lượt nói (Turn-Taking)</td>
                        <td className="py-2.5 px-4 text-rose-800 bg-rose-50/20">
                          Bị lỗi "Chưa bật mic đã hiện lắng nghe"; Bống đang nói đã bật viền đỏ và ghi âm tiếng loa.
                        </td>
                        <td className="py-2.5 px-4 text-emerald-900 bg-emerald-50/30 font-medium">
                          <strong>Tuần tự hóa tuyệt đối:</strong> Bống nói xong 100% mới mở lượt bé; <strong>Auto-Mic</strong> tự bật tức thì.
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-4 font-bold text-ink-900">3. Tương tác xúc giác</td>
                        <td className="py-2.5 px-4 text-rose-800 bg-rose-50/20">
                          Chỉ có 1 kênh mic nói chuyện, không có tương tác tay trực tiếp trên mặt robot.
                        </td>
                        <td className="py-2.5 px-4 text-emerald-900 bg-emerald-50/30 font-medium">
                          <strong>Đa phương thức:</strong> Chạm 4 góc phần tư (<code>pie4</code>) + Vuốt 4 hướng (<code>swipe</code>) trên màn hình tròn.
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-4 font-bold text-ink-900">4. Hoạt ảnh biểu cảm</td>
                        <td className="py-2.5 px-4 text-rose-800 bg-rose-50/20">
                          Icon cảm xúc tĩnh hoặc ảnh GIF nặng bộ nhớ, không đồng bộ với chip ESP32.
                        </td>
                        <td className="py-2.5 px-4 text-emerald-900 bg-emerald-50/30 font-medium">
                          <strong>Hoạt ảnh nhị phân .eaf 15fps:</strong> Chuẩn nén chuyên dụng Espressif, canvas mượt mà, tốn cực ít RAM.
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-4 font-bold text-ink-900">5. Bảo mật dữ liệu</td>
                        <td className="py-2.5 px-4 text-rose-800 bg-rose-50/20">
                          File media để trần trên URL public, dễ bị copy bản quyền giọng đọc và kịch bản.
                        </td>
                        <td className="py-2.5 px-4 text-emerald-900 bg-emerald-50/30 font-medium">
                          <strong>Mã hóa Envelope ChaCha20-Poly1305:</strong> Giải mã trực tiếp trên RAM, không lưu file thô xuống đĩa.
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-4 font-bold text-ink-900">6. Trí nhớ & Cá nhân hóa</td>
                        <td className="py-2.5 px-4 text-rose-800 bg-rose-50/20">
                          Không lưu ngữ cảnh; mỗi phiên học là độc lập, không nhớ tên hay sở thích của bé.
                        </td>
                        <td className="py-2.5 px-4 text-emerald-900 bg-emerald-50/30 font-medium">
                          <strong>Context Store:</strong> Lưu <code>user.fav_color</code>, gọi tên màu bé thích ở bước sau; thuật toán lặp ngắt quãng.
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Detailed Breakdown for Phase 1 */}
              <div className="rounded-2xl border border-blue-200 bg-white p-5 shadow-xs">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-4 border-b border-blue-100">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-600 text-white font-black text-xs shadow-xs">
                      GĐ 1
                    </span>
                    <div>
                      <h4 className="font-black text-ink-900 text-sm">
                        Giai Đoạn 1: Hạ Tầng Offline-First, Virtual SD Card & Bảo Mật Bản Quyền
                      </h4>
                      <p className="text-[11px] text-ink-500">Mục tiêu: Đảm bảo thiết bị chạy độc lập 100% không lo mạng yếu hay đứt kết nối</p>
                    </div>
                  </div>
                  <span className="rounded-lg bg-blue-100 px-2.5 py-1 text-xs font-bold text-blue-700">
                    Đã hoàn thành 100%
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div className="rounded-xl bg-cream-50 p-3.5 border border-cream-200">
                    <h5 className="font-bold text-blue-900 mb-1.5 flex items-center gap-1.5">
                      <span>📄</span>
                      <span>1.1. Manifest V3 Tập Trung (/api/v1/device/manifest)</span>
                    </h5>
                    <p className="text-ink-600 leading-relaxed">
                      Được thiết kế theo cấu trúc JSON phân cấp tối ưu hóa cho vi điều khiển: chứa định danh toàn bộ danh sách bài học (<code>scenes</code>), danh mục 50 asset nhị phân (<code>assets</code>), khóa bảo mật (<code>content_keys</code>), và danh mục xưng hô (<code>vocatives</code>). Hỗ trợ kiểm tra băm SHA-256 để phát hiện và tự sửa file lỗi.
                    </p>
                  </div>

                  <div className="rounded-xl bg-cream-50 p-3.5 border border-cream-200">
                    <h5 className="font-bold text-blue-900 mb-1.5 flex items-center gap-1.5">
                      <span>💾</span>
                      <span>1.2. Thẻ Nhớ Ảo (Virtual SD Card - sd_card_v3)</span>
                    </h5>
                    <p className="text-ink-600 leading-relaxed">
                      Trên phần cứng là thẻ micro-SD chuẩn FAT32; trên Web Simulator được giả lập hoàn hảo bằng <strong>IndexedDB</strong> của trình duyệt. Cấu trúc thư mục gồm: <code>/sdcard/scenes/*.json</code> (cây kịch bản), <code>/sdcard/assets/*.bin</code> (file âm thanh & hoạt ảnh), và <code>/sdcard/keys/</code> (chìa khóa giải mã).
                    </p>
                  </div>

                  <div className="rounded-xl bg-cream-50 p-3.5 border border-cream-200">
                    <h5 className="font-bold text-blue-900 mb-1.5 flex items-center gap-1.5">
                      <span>🔐</span>
                      <span>1.3. Mã Hóa Khóa Phong Bì (ChaCha20-Poly1305 Envelope)</span>
                    </h5>
                    <p className="text-ink-600 leading-relaxed">
                      Bảo vệ quyền sở hữu trí tuệ cho các giọng lồng tiếng đắt giá. Mỗi asset được mã hóa bằng 1 Content Key riêng biệt bọc trong Envelope Key. Thiết bị giải mã dữ liệu trực tiếp trong bộ nhớ đệm RAM (In-Memory Streaming Decrypt), tuyệt đối không lưu file giải mã thô xuống ổ đĩa.
                    </p>
                  </div>

                  <div className="rounded-xl bg-cream-50 p-3.5 border border-cream-200">
                    <h5 className="font-bold text-blue-900 mb-1.5 flex items-center gap-1.5">
                      <span>⚡</span>
                      <span>1.4. Cơ Chế Đồng Bộ Một Chạm (One-Click Incremental Sync)</span>
                    </h5>
                    <p className="text-ink-600 leading-relaxed">
                      Khi cắm sạc hoặc người dùng nhấn nút "Đồng bộ SD Card", thiết bị đối soát checksum với server và chỉ tải những file mới cập nhật. Toàn bộ 50 assets bài HAHA (47 WAV + 3 EAF) được tải về lưu trữ an toàn trong vài giây.
                    </p>
                  </div>
                </div>
              </div>

              {/* Detailed Breakdown for Phase 2 */}
              <div className="rounded-2xl border border-coral-200 bg-white p-5 shadow-xs">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-4 border-b border-coral-100">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-coral-500 text-white font-black text-xs shadow-xs">
                      GĐ 2
                    </span>
                    <div>
                      <h4 className="font-black text-ink-900 text-sm">
                        Giai Đoạn 2: Máy Trạng Thái Hữu Hạn FSM, Sửa Lượt Nói & Cảm Ứng Đa Điểm
                      </h4>
                      <p className="text-[11px] text-ink-500">Mục tiêu: Đưa tương tác đạt chuẩn sư phạm mầm non, mượt mà và không gián đoạn</p>
                    </div>
                  </div>
                  <span className="rounded-lg bg-coral-100 px-2.5 py-1 text-xs font-bold text-coral-700">
                    Đã hoàn thành 100%
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div className="rounded-xl bg-cream-50 p-3.5 border border-cream-200">
                    <h5 className="font-bold text-coral-900 mb-1.5 flex items-center gap-1.5">
                      <span>🗣️</span>
                      <span>2.1. Chuẩn Hóa Chu Kỳ Lượt Nói (Turn-Taking Protocol)</span>
                    </h5>
                    <p className="text-ink-600 leading-relaxed">
                      Phân tách rạch ròi 2 trạng thái: <strong>(1) Khi Bống đang nói</strong>: Cờ <code>isAwaitingInput = false</code>, Mic đóng chặt để loa không bị thu vòng lặp (anti-echo), viền màn hình vàng ấm nhẹ, hiển thị phụ đề "Bống đang nói...". <strong>(2) Khi dứt tiếng</strong>: Mới chuyển <code>isAwaitingInput = true</code>, viền đỏ/xanh lá xuất hiện báo tới lượt bé.
                    </p>
                  </div>

                  <div className="rounded-xl bg-cream-50 p-3.5 border border-cream-200">
                    <h5 className="font-bold text-coral-900 mb-1.5 flex items-center gap-1.5">
                      <span>🎙️</span>
                      <span>2.2. Công Nghệ Tự Động Kích Hoạt Mic (Auto-Mic)</span>
                    </h5>
                    <p className="text-ink-600 leading-relaxed">
                      Trẻ nhỏ từ 3–6 tuổi thường không biết bấm nút chuột hay chạm màn hình đúng thời điểm. Khi Bống dứt câu hỏi, tính năng Auto-Mic tự động kích hoạt bộ thu âm Web Speech API, chuyển sang nhãn <strong>🟢 Tới lượt bé nói (Mic đang mở)</strong> để bé cất tiếng trả lời tự nhiên nhất.
                    </p>
                  </div>

                  <div className="rounded-xl bg-cream-50 p-3.5 border border-cream-200">
                    <h5 className="font-bold text-coral-900 mb-1.5 flex items-center gap-1.5">
                      <span>👆</span>
                      <span>2.3. Cảm Ứng Tròn 4 Cung (Layout pie4) & Cử Chỉ Vuốt (swipe)</span>
                    </h5>
                    <p className="text-ink-600 leading-relaxed">
                      Màn hình LCD tròn 240x240 được lập trình 2 cơ chế chạm độc đáo: <strong>pie4</strong> chia 4 góc phần tư nhấp nháy phát sáng phục vụ câu hỏi trắc nghiệm trực quan; <strong>swipe</strong> nhận diện cử chỉ vuốt 4 hướng (Lên/Xuống/Trái/Phải) giúp bé chơi các mini game tương tác ngón tay.
                    </p>
                  </div>

                  <div className="rounded-xl bg-cream-50 p-3.5 border border-cream-200">
                    <h5 className="font-bold text-coral-900 mb-1.5 flex items-center gap-1.5">
                      <span>🎭</span>
                      <span>2.4. Hoạt Ảnh Nhị Phân Espressif Animation Format (.eaf 15fps)</span>
                    </h5>
                    <p className="text-ink-600 leading-relaxed">
                      Thay thế hoàn toàn ảnh tĩnh bằng chuỗi hoạt ảnh biểu cảm động được mã hóa nhị phân chuyên dụng cho ESP32. Canvas giải mã 15 khung hình/giây (15fps) các cử chỉ: nháy mắt, cười vui, ngạc nhiên, suy nghĩ, vỗ tay... đồng bộ khớp với nhịp điệu phát âm thanh.
                    </p>
                  </div>
                </div>
              </div>

              {/* Detailed Breakdown for Phase 3 */}
              <div className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-xs">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-4 border-b border-emerald-100">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-600 text-white font-black text-xs shadow-xs">
                      GĐ 3
                    </span>
                    <div>
                      <h4 className="font-black text-ink-900 text-sm">
                        Giai Đoạn 3: Đàm Thoại Tự Do Free Talk, An Toàn Trẻ Em & Trí Nhớ Cá Nhân Hóa
                      </h4>
                      <p className="text-[11px] text-ink-500">Mục tiêu: Xây dựng Bống thành người bạn tâm tình thông minh, an toàn và thấu hiểu bé</p>
                    </div>
                  </div>
                  <span className="rounded-lg bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800">
                    Đã hoàn thành 100%
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div className="rounded-xl bg-cream-50 p-3.5 border border-cream-200">
                    <h5 className="font-bold text-emerald-950 mb-1.5 flex items-center gap-1.5">
                      <span>🧸</span>
                      <span>3.1. Persona Bống AI Thân Thiện & Đàm Thoại 2 Chiều</span>
                    </h5>
                    <p className="text-ink-600 leading-relaxed">
                      Nhân vật Bống AI được định hình với tính cách vui tươi, ấm áp, kiên nhẫn lắng nghe; luôn xưng "Bống" và gọi "bé" (hoặc tên thật của bé). Trả lời ngắn gọn, giàu hình ảnh, kích thích trí tưởng tượng của trẻ trong độ tuổi 3–10 tuổi.
                    </p>
                  </div>

                  <div className="rounded-xl bg-cream-50 p-3.5 border border-cream-200">
                    <h5 className="font-bold text-emerald-950 mb-1.5 flex items-center gap-1.5">
                      <span>🛡️</span>
                      <span>3.2. Bộ Lọc An Toàn Trẻ Em Đa Tầng (Safety Guardrails)</span>
                    </h5>
                    <p className="text-ink-600 leading-relaxed">
                      Hệ thống kiểm duyệt đa lớp chặn triệt để: nội dung người lớn, bạo lực, rùng rợn, thông tin nhạy cảm của gia đình, và hành vi nguy hiểm (nghịch lửa, điện). Khi gặp chủ đề tiêu cực, Bống nhẹ nhàng chuyển hướng bé sang những thói quen tốt và câu chuyện giáo dục tích cực.
                    </p>
                  </div>

                  <div className="rounded-xl bg-cream-50 p-3.5 border border-cream-200">
                    <h5 className="font-bold text-emerald-950 mb-1.5 flex items-center gap-1.5">
                      <span>🧠</span>
                      <span>3.3. Bộ Nhớ Ngữ Cảnh Dài Hạn (Context Store & DayMemory)</span>
                    </h5>
                    <p className="text-ink-600 leading-relaxed">
                      Lưu trữ các dữ liệu cá nhân hóa của trẻ: màu sắc yêu thích (<code>user.fav_color</code>), con vật cưng (<code>user.fav_animal</code>), bạn thân, sở thích... Các biến nhớ này được nạp tự động vào FSM của các bài học tiếp theo, tạo cảm giác Bống thực sự hiểu và nhớ về bé.
                    </p>
                  </div>

                  <div className="rounded-xl bg-cream-50 p-3.5 border border-cream-200">
                    <h5 className="font-bold text-emerald-950 mb-1.5 flex items-center gap-1.5">
                      <span>📈</span>
                      <span>3.4. Thuật Toán Lặp Lại Ngắt Quãng (Spaced Repetition)</span>
                    </h5>
                    <p className="text-ink-600 leading-relaxed">
                      Theo dõi lịch sử tiếp thu của trẻ (những từ vựng hoặc khái niệm bé còn phát âm ngập ngừng). Hệ thống tự động xếp lịch nhắc lại kiến thức đó vào các bài học sau theo đường cong lãng quên Ebbinghaus (sau 1 ngày, 3 ngày, 7 ngày) giúp bé ghi nhớ sâu tự nhiên.
                    </p>
                  </div>
                </div>
              </div>

              {/* Practical Testing Tips for QA */}
              <div className="rounded-2xl bg-amber-50 p-5 border border-amber-200">
                <h4 className="font-bold text-amber-950 flex items-center gap-2 text-sm mb-2">
                  <span>🎯</span>
                  <span>Lời Khuyên Nghiệm Thu Dành Cho Tester (QA Testing Tips)</span>
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-amber-900/90 leading-relaxed">
                  <div className="rounded-xl bg-white/80 p-3 border border-amber-200/80">
                    <span className="font-bold text-ink-900 block mb-1">1. Test Offline Virtual SD</span>
                    <span>Bấm nút "Đồng bộ SD Card" trên TalkBar hoặc Debug Inspector, xác nhận 50 file asset nhị phân được lưu vào IndexedDB.</span>
                  </div>
                  <div className="rounded-xl bg-white/80 p-3 border border-amber-200/80">
                    <span className="font-bold text-ink-900 block mb-1">2. Test Turn-Taking & Auto-Mic</span>
                    <span>Quan sát Bống nói ở Step 0 bài HAHA: viền vàng ấm $\to$ nói xong dứt điểm $\to$ viền đỏ + Mic tự mở mà không cần click.</span>
                  </div>
                  <div className="rounded-xl bg-white/80 p-3 border border-amber-200/80">
                    <span className="font-bold text-ink-900 block mb-1">3. Test Cảm Ứng pie4 & swipe</span>
                    <span>Dùng chuột click vào 4 góc phần tư ở Step 12 và thực hiện cử chỉ vuốt 4 hướng trên mặt kính tròn ở Step 20 bài HAHA.</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: PRODUCTION LESSON HAHA */}
          {activeTab === 'lesson_haha' && (
            <div className="space-y-6 animate-fade-in">
              <div className="rounded-2xl bg-gradient-to-r from-coral-500/10 via-orange-500/10 to-amber-500/10 p-5 border border-coral-200/60">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base font-black text-coral-950 flex items-center gap-2">
                      <span>📚</span>
                      <span>Kịch Bản Mẫu Chuẩn: HAHA (42 Bước Clone Từ Server)</span>
                    </h3>
                    <p className="mt-1 text-xs text-coral-900/80">
                      Được đồng bộ 100% từ máy chủ Staging (103.186.149.207) với 50 file asset nhị phân thực tế (47 WAV + 3 EAF).
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-xl bg-coral-500 text-white font-mono text-xs font-bold px-3 py-1 shadow-sm">
                      42 Steps • 50 Assets
                    </span>
                  </div>
                </div>
              </div>

              {/* Milestones in Lesson HAHA */}
              <div className="space-y-3">
                <h4 className="font-bold text-ink-900 text-sm flex items-center gap-2">
                  <span>🎯</span>
                  <span>Các Mốc Tương Tác Trọng Điểm Cần Kiểm Thử</span>
                </h4>

                <div className="space-y-3">
                  {/* Milestone 1 */}
                  <div className="flex items-start gap-4 rounded-2xl bg-cream-50 p-4 border border-cream-200">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-500 text-white font-bold text-xs shadow-sm">
                      1
                    </span>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-ink-900 text-sm">Step 0 (b7qsm): Khởi Động & Auto-Mic</span>
                        <span className="rounded bg-blue-100 text-blue-700 text-[10px] font-bold px-2 py-0.5">Audio + Speech</span>
                      </div>
                      <p className="text-xs text-ink-600">
                        Bống cất lời chào bé từ file audio thật trên Virtual SD Card. Khi câu thoại dứt, Auto-Mic tự động kích hoạt để nhận phản hồi từ bé.
                      </p>
                    </div>
                  </div>

                  {/* Milestone 2 */}
                  <div className="flex items-start gap-4 rounded-2xl bg-cream-50 p-4 border border-cream-200">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-purple-500 text-white font-bold text-xs shadow-sm">
                      2
                    </span>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-ink-900 text-sm">Step 4 (bpelu): Phân Loại Phát Âm Tiếng Anh</span>
                        <span className="rounded bg-purple-100 text-purple-700 text-[10px] font-bold px-2 py-0.5">Prompt phan_loai</span>
                      </div>
                      <p className="text-xs text-ink-600">
                        Bống yêu cầu bé đọc từ "cat". Backend dùng prompt <code>phan_loai</code> để phân loại phát âm chuẩn ("cat") hay gần đúng ("cat_near") để đưa ra lời khen hoặc động viên phù hợp.
                      </p>
                    </div>
                  </div>

                  {/* Milestone 3 */}
                  <div className="flex items-start gap-4 rounded-2xl bg-cream-50 p-4 border border-cream-200">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white font-bold text-xs shadow-sm">
                      3
                    </span>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-ink-900 text-sm">Step 12 (b6lk1): Chạm Màn Hình Tròn 4 Góc (Layout pie4)</span>
                        <span className="rounded bg-amber-100 text-amber-700 text-[10px] font-bold px-2 py-0.5">Touch pie4 + haha_h_002.eaf</span>
                      </div>
                      <p className="text-xs text-ink-600">
                        Màn hình hiển thị hoạt ảnh <code>haha_h_002.eaf</code> kèm chia 4 cung tròn (Top, Right, Bottom, Left). Tester click vào bất kỳ góc nào trên mặt kính tròn để trả lời.
                      </p>
                    </div>
                  </div>

                  {/* Milestone 4 */}
                  <div className="flex items-start gap-4 rounded-2xl bg-cream-50 p-4 border border-cream-200">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-teal-500 text-white font-bold text-xs shadow-sm">
                      4
                    </span>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-ink-900 text-sm">Step 20 (bxaft): Cử Chỉ Vuốt 4 Hướng (Layout swipe)</span>
                        <span className="rounded bg-teal-100 text-teal-700 text-[10px] font-bold px-2 py-0.5">Touch swipe + haha_h_003.eaf</span>
                      </div>
                      <p className="text-xs text-ink-600">
                        Hoạt ảnh <code>haha_h_003.eaf</code> xuất hiện, yêu cầu bé vuốt màn hình. Tester kéo chuột trên mặt kính LCD tròn để mô phỏng cử chỉ vuốt ngón tay của trẻ.
                      </p>
                    </div>
                  </div>

                  {/* Milestone 5 */}
                  <div className="flex items-start gap-4 rounded-2xl bg-cream-50 p-4 border border-cream-200">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-pink-500 text-white font-bold text-xs shadow-sm">
                      5
                    </span>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-ink-900 text-sm">Step 29 (boakb) &rarr; Step 36 (bsmjb): Trí Nhớ Cá Nhân Hoá</span>
                        <span className="rounded bg-pink-100 text-pink-700 text-[10px] font-bold px-2 py-0.5">Context user.fav_color</span>
                      </div>
                      <p className="text-xs text-ink-600">
                        Tại Step 29, Bống hỏi màu sắc yêu thích. Câu trả lời được ghi vào <code>user.fav_color</code>. Tới Step 36, câu thoại của Bống tự động gọi tên màu sắc mà bé vừa chọn.
                      </p>
                    </div>
                  </div>

                  {/* Milestone 6 */}
                  <div className="flex items-start gap-4 rounded-2xl bg-cream-50 p-4 border border-cream-200">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-mint-500 text-white font-bold text-xs shadow-sm">
                      6
                    </span>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-ink-900 text-sm">Step 41: Kết Thúc & Chuyển Sang Kịch Bản END</span>
                        <span className="rounded bg-mint-100 text-mint-700 text-[10px] font-bold px-2 py-0.5">FSM Transition</span>
                      </div>
                      <p className="text-xs text-ink-600">
                        Tổng kết số ngôi sao đạt được, phát nhạc vui nhộn và chuyển mượt mà sang phân cảnh chào tạm biệt <code>END</code>.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Pro Tip */}
              <div className="rounded-xl bg-cream-100 p-4 border border-cream-300 text-xs text-ink-700 flex items-center justify-between">
                <span>💡 <strong>Mẹo Test Nhanh:</strong> Bấm nút <strong>"🛠️ Debug"</strong> trên Header để mở danh sách 42 bước. Bạn có thể click vào bất kỳ Step nào để nhảy thẳng tới bước đó mà không cần nghe hết các bước trước!</span>
              </div>
            </div>
          )}

          {/* TAB 3: CHECKLIST MATRIX */}
          {activeTab === 'checklist' && (
            <div className="space-y-4 animate-fade-in">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="🔍 Tìm kiếm ca test (TC-..., từ khoá)..."
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    className="rounded-xl border border-cream-300 bg-white px-3.5 py-1.5 text-xs text-ink-800 placeholder-ink-400 focus:border-indigo-500 focus:outline-none w-64 shadow-xs"
                  />
                  {searchFilter && (
                    <button
                      type="button"
                      onClick={() => setSearchFilter('')}
                      className="text-xs text-ink-500 hover:text-ink-800"
                    >
                      Xoá
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleResetChecklist}
                    className="rounded-xl bg-cream-200 px-3 py-1.5 text-xs font-bold text-ink-700 hover:bg-cream-300 transition"
                  >
                    🔄 Đặt lại
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyReport}
                    className="rounded-xl bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 transition shadow-xs"
                  >
                    {copied ? '✓ Đã copy!' : '📋 Copy Kết Quả'}
                  </button>
                </div>
              </div>

              {/* Test Cases Table / Cards */}
              <div className="space-y-3">
                {filteredTestCases.map((tc) => {
                  const status = testResults[tc.id] || 'pending';
                  return (
                    <div
                      key={tc.id}
                      className={`rounded-2xl border p-4 transition ${
                        status === 'pass'
                          ? 'border-emerald-300 bg-emerald-50/50'
                          : status === 'fail'
                          ? 'border-rose-200 bg-rose-50/40'
                          : 'border-cream-200 bg-white hover:border-cream-300'
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded-lg font-mono text-xs font-bold px-2 py-0.5 ${
                              tc.critical ? 'bg-coral-500 text-white' : 'bg-cream-200 text-ink-700'
                            }`}
                          >
                            {tc.id}
                          </span>
                          <h4 className="font-bold text-ink-900 text-sm">{tc.title}</h4>
                          {tc.critical && (
                            <span className="text-[10px] font-bold text-coral-600 bg-coral-50 px-1.5 py-0.5 rounded border border-coral-200">
                              Trọng yếu
                            </span>
                          )}
                        </div>

                        {/* Status Buttons */}
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => updateTestStatus(tc.id, 'pass')}
                            className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold transition ${
                              status === 'pass'
                                ? 'bg-emerald-600 text-white shadow-xs'
                                : 'bg-cream-100 text-ink-600 hover:bg-emerald-100 hover:text-emerald-800'
                            }`}
                          >
                            <span>✓</span>
                            <span>Đạt</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => updateTestStatus(tc.id, 'fail')}
                            className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold transition ${
                              status === 'fail'
                                ? 'bg-rose-600 text-white shadow-xs'
                                : 'bg-cream-100 text-ink-600 hover:bg-rose-100 hover:text-rose-800'
                            }`}
                          >
                            <span>✕</span>
                            <span>Lỗi</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => updateTestStatus(tc.id, 'pending')}
                            className={`rounded-lg px-2 py-1 text-xs font-bold transition ${
                              status === 'pending'
                                ? 'bg-ink-200 text-ink-800'
                                : 'bg-cream-100 text-ink-400 hover:bg-cream-200'
                            }`}
                            title="Chưa test"
                          >
                            ⏳
                          </button>
                        </div>
                      </div>

                      {/* Steps & Expected */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2 text-xs">
                        <div className="rounded-xl bg-cream-50 p-2.5 border border-cream-200/80">
                          <span className="font-semibold text-ink-500 block mb-0.5">Thao tác kiểm thử:</span>
                          <span className="text-ink-700 leading-relaxed">{tc.steps}</span>
                        </div>
                        <div className="rounded-xl bg-cream-50 p-2.5 border border-cream-200/80">
                          <span className="font-semibold text-ink-500 block mb-0.5">Kết quả mong đợi:</span>
                          <span className="text-ink-900 font-medium leading-relaxed">{tc.expected}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 4: SERVICES & ENVIRONMENT */}
          {activeTab === 'services' && (
            <div className="space-y-6 animate-fade-in">
              <div className="rounded-2xl bg-cream-50 p-5 border border-cream-200">
                <h3 className="text-base font-black text-ink-900 flex items-center gap-2 mb-3">
                  <span>🛠️</span>
                  <span>Bảng Cổng Dịch Vụ & Địa Chỉ Truy Cập Hệ Thống</span>
                </h3>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-cream-300 text-ink-500 font-semibold">
                        <th className="py-2 px-3">Dịch vụ</th>
                        <th className="py-2 px-3">Cổng (Port)</th>
                        <th className="py-2 px-3">Đường dẫn Local</th>
                        <th className="py-2 px-3">Vai trò</th>
                        <th className="py-2 px-3">Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-cream-200">
                      <tr>
                        <td className="py-2.5 px-3 font-bold text-ink-900">Web Demo Simulator</td>
                        <td className="py-2.5 px-3 font-mono font-bold text-coral-600">5180</td>
                        <td className="py-2.5 px-3">
                          <a href="http://localhost:5180/" target="_blank" rel="noreferrer" className="text-indigo-600 underline">
                            http://localhost:5180/
                          </a>
                        </td>
                        <td className="py-2.5 px-3 text-ink-600">Trình giả lập thiết bị phần cứng & kiểm thử bài học</td>
                        <td className="py-2.5 px-3 font-bold text-mint-600">🟢 Hoạt động</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-3 font-bold text-ink-900">Backend API (FastAPI)</td>
                        <td className="py-2.5 px-3 font-mono font-bold text-indigo-600">8000</td>
                        <td className="py-2.5 px-3">
                          <a href="http://localhost:8000/docs" target="_blank" rel="noreferrer" className="text-indigo-600 underline">
                            http://localhost:8000/docs
                          </a>
                        </td>
                        <td className="py-2.5 px-3 text-ink-600">Cung cấp Manifest V3, Blob asset, AI Auth & Memory</td>
                        <td className="py-2.5 px-3 font-bold text-mint-600">🟢 Hoạt động</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-3 font-bold text-ink-900">Web Admin Portal</td>
                        <td className="py-2.5 px-3 font-mono font-bold text-blue-600">5173</td>
                        <td className="py-2.5 px-3">
                          <a href="http://localhost:5173/admin" target="_blank" rel="noreferrer" className="text-indigo-600 underline">
                            http://localhost:5173/admin
                          </a>
                        </td>
                        <td className="py-2.5 px-3 text-ink-600">Quản trị nội dung, kích hoạt thiết bị, tài khoản phụ huynh</td>
                        <td className="py-2.5 px-3 font-bold text-mint-600">🟢 Hoạt động</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-3 font-bold text-ink-900">Bong Producer</td>
                        <td className="py-2.5 px-3 font-mono font-bold text-amber-600">8787</td>
                        <td className="py-2.5 px-3">
                          <a href="http://localhost:8787" target="_blank" rel="noreferrer" className="text-indigo-600 underline">
                            http://localhost:8787
                          </a>
                        </td>
                        <td className="py-2.5 px-3 text-ink-600">Biên soạn và xuất bản kịch bản bài học V3</td>
                        <td className="py-2.5 px-3 font-bold text-mint-600">🟢 Hoạt động</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-3 font-bold text-ink-900">PostgreSQL Database</td>
                        <td className="py-2.5 px-3 font-mono font-bold text-ink-600">5434</td>
                        <td className="py-2.5 px-3 font-mono text-ink-500">localhost:5434</td>
                        <td className="py-2.5 px-3 text-ink-600">Lưu trữ người dùng, thiết bị, manifest, prompt store</td>
                        <td className="py-2.5 px-3 font-bold text-mint-600">🟢 Hoạt động</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-3 font-bold text-ink-900">Redis Cache</td>
                        <td className="py-2.5 px-3 font-mono font-bold text-ink-600">6379</td>
                        <td className="py-2.5 px-3 font-mono text-ink-500">localhost:6379</td>
                        <td className="py-2.5 px-3 text-ink-600">Caching phiên học và dữ liệu tạm thời</td>
                        <td className="py-2.5 px-3 font-bold text-mint-600">🟢 Hoạt động</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Sample Test Accounts */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-2xl bg-cream-50 p-4 border border-cream-200">
                  <h4 className="font-bold text-ink-900 text-sm mb-2 flex items-center gap-1.5">
                    <span>👑</span>
                    <span>Tài Khoản Quản Trị (Admin Portal)</span>
                  </h4>
                  <div className="space-y-1 text-xs text-ink-700">
                    <p>• URL: <a href="http://localhost:5173/admin" className="text-indigo-600 underline font-semibold">http://localhost:5173/admin</a></p>
                    <p>• Email: <code className="bg-cream-200 px-1 py-0.5 rounded font-mono font-bold">admin@example.com</code></p>
                    <p>• Password: <code className="bg-cream-200 px-1 py-0.5 rounded font-mono font-bold">admin123</code></p>
                  </div>
                </div>

                <div className="rounded-2xl bg-cream-50 p-4 border border-cream-200">
                  <h4 className="font-bold text-ink-900 text-sm mb-2 flex items-center gap-1.5">
                    <span>👨‍👩‍👧</span>
                    <span>Tài Khoản Phụ Huynh Mẫu (Parent App)</span>
                  </h4>
                  <div className="space-y-1 text-xs text-ink-700">
                    <p>• Thiết bị: <code className="bg-cream-200 px-1 py-0.5 rounded font-mono font-bold">simulator_v3_dev</code></p>
                    <p>• Số điện thoại: <code className="bg-cream-200 px-1 py-0.5 rounded font-mono font-bold">0123456789</code></p>
                    <p>• Password: <code className="bg-cream-200 px-1 py-0.5 rounded font-mono font-bold">password123</code></p>
                    <p>• Thông tin: Bé Bống (3 tuổi)</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Bar */}
        <div className="flex items-center justify-between border-t border-cream-200 bg-cream-50 px-6 py-3 shrink-0 text-xs text-ink-500">
          <span>Hệ sinh thái Bống AI • Phát triển & Kiểm định chất lượng</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-ink-900 px-4 py-1.5 text-xs font-bold text-white hover:bg-ink-800 transition"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}

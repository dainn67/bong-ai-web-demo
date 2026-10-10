/**
 * K7 Normalization Engine (Hợp đồng Thiết bị GĐ1 §3.2 & Hướng dẫn Firmware IoT V3).
 *
 * Thuật toán 4 bước chuẩn hóa phản hồi từ LLM (/listen):
 * 1. text = raw.lower().strip()
 * 2. Bỏ ngoặc kép bao ngoài (nếu có: ", ', “, ”, «, », `)
 * 3. Bỏ dấu câu cuối câu (. ! ? , 。 …)
 * 4. So khớp:
 *    - Trùng một option.name (không phân biệt hoa thường) -> reply = option.name chuẩn
 *    - Khớp từ khóa đặc biệt hệ thống ('silent', 'unclear', 'error', 'spoke', 'miss') -> giữ nguyên
 *    - Còn lại -> reply = 'other' (nếu options có khai báo)
 */

export interface K7Option {
  name: string;
  desc?: string;
}

/**
 * Làm sạch chuỗi cơ bản theo 3 bước đầu của K7.
 */
export function cleanK7Text(raw: string | null | undefined): string {
  if (!raw) return '';
  // 1. Chuyển chữ thường và cắt khoảng trắng đầu/cuối
  let text = String(raw).toLowerCase().trim();

  // 2. Bỏ ngoặc kép/dấu nháy bao ngoài
  text = text.replace(/^["'`«»“”]+|["'`«»“”]+$/g, '').trim();

  // 3. Bỏ dấu câu cuối câu (. ! ? , 。 …)
  text = text.replace(/[.!?,。…]+$/g, '').trim();

  return text;
}

/**
 * Thực thi đầy đủ 4 bước chuẩn hóa K7 với danh sách options mục tiêu.
 */
export function normalizeK7(
  rawText: string | null | undefined,
  options?: K7Option[] | null,
): string {
  const cleaned = cleanK7Text(rawText);
  if (!cleaned) return 'silent';

  // Giữ nguyên các từ khóa trạng thái đặc biệt
  const RESERVED_KEYWORDS = ['silent', 'unclear', 'error', 'spoke', 'miss'];
  if (RESERVED_KEYWORDS.includes(cleaned)) {
    return cleaned;
  }

  // 4. So khớp với options của step nếu có
  if (options && options.length > 0) {
    const matched = options.find((opt) => opt.name.toLowerCase().trim() === cleaned);
    if (matched) {
      return matched.name;
    }

    // Kiểm tra thêm: nếu LLM trả về tiếng Việt khớp với desc hoặc name bỏ dấu gạch dưới
    const matchedDesc = options.find((opt) => {
      const optDesc = (opt.desc || '').toLowerCase().trim();
      const optCleanName = opt.name.toLowerCase().replace(/_/g, ' ').trim();
      return (optDesc && optDesc === cleaned) || optCleanName === cleaned;
    });
    if (matchedDesc) {
      return matchedDesc.name;
    }

    // Không khớp bất kỳ option nào -> trả về 'other'
    return 'other';
  }

  return cleaned;
}

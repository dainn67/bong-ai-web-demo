/**
 * Diacritic-free Vietnamese, for matching authored labels.
 *
 * Lesson JSON identifies node and branch types with Vietnamese prose — "câu hỏi
 * 2", "phản hồi đúng" — written by hand by content authors. Matching those
 * exactly would break on a missing accent or a stray capital, so everything is
 * compared with the accents stripped.
 */

/**
 * Lowercases and removes tone marks. `đ`/`Đ` become `d`, which the Unicode
 * decomposition does not do for us — it is a distinct letter, not a d with a
 * mark on it.
 */
export function normalizeVietnamese(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

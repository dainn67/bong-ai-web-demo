import { describe, it, expect } from 'vitest';
import { cleanK7Text, normalizeK7 } from './k7-normalizer';

describe('K7 Normalizer (§3.2 Hợp đồng Thiết bị)', () => {
  const sampleOptions = [
    { name: 'qua_tao', desc: 'quả táo' },
    { name: 'con_cho', desc: 'con chó' },
    { name: 'mau_do', desc: 'màu đỏ' },
  ];

  it('làm sạch chuỗi cơ bản: lowercase, trim, strip quotes, strip trailing punctuation', () => {
    expect(cleanK7Text('  "Quả Táo."  ')).toBe('quả táo');
    expect(cleanK7Text('“con_cho!”')).toBe('con_cho');
    expect(cleanK7Text('\'mau_do...\'')).toBe('mau_do');
    expect(cleanK7Text('«qua_tao。»')).toBe('qua_tao');
    expect(cleanK7Text('')).toBe('');
    expect(cleanK7Text(null)).toBe('');
  });

  it('so khớp trúng option.name chuẩn xác', () => {
    expect(normalizeK7('"qua_tao."', sampleOptions)).toBe('qua_tao');
    expect(normalizeK7('  CON_CHO  ', sampleOptions)).toBe('con_cho');
    expect(normalizeK7('mau_do!', sampleOptions)).toBe('mau_do');
  });

  it('so khớp theo mô tả desc hoặc tên không gạch dưới', () => {
    expect(normalizeK7('"Quả táo."', sampleOptions)).toBe('qua_tao');
    expect(normalizeK7('con chó!', sampleOptions)).toBe('con_cho');
    expect(normalizeK7('màu đỏ.', sampleOptions)).toBe('mau_do');
  });

  it('giữ nguyên các từ khóa đặc biệt hệ thống', () => {
    expect(normalizeK7('silent', sampleOptions)).toBe('silent');
    expect(normalizeK7('"unclear."', sampleOptions)).toBe('unclear');
    expect(normalizeK7('error!', sampleOptions)).toBe('error');
    expect(normalizeK7('spoke', sampleOptions)).toBe('spoke');
    expect(normalizeK7('miss', sampleOptions)).toBe('miss');
    expect(normalizeK7('', sampleOptions)).toBe('silent');
  });

  it('trả về "other" khi không khớp bất kỳ option nào', () => {
    expect(normalizeK7('con hươu cao cổ', sampleOptions)).toBe('other');
    expect(normalizeK7('trái dưa hấu', sampleOptions)).toBe('other');
    expect(normalizeK7('không biết', sampleOptions)).toBe('other');
  });

  it('trả về chuỗi cleaned nếu không có options danh sách', () => {
    expect(normalizeK7('  "Xin chào!" ')).toBe('xin chào');
  });
});

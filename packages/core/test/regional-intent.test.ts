import { describe, expect, it } from 'vitest';
import { parseCommand } from '@dutoan/core';

describe('assistant: regional update command', () => {
  it.each([
    'cập nhật đơn giá theo khu vực',
    'Cập nhật định mức và đơn giá theo tỉnh',
    'đổi giá theo khu vực TP. Hồ Chí Minh',
  ])('%s → regionalUpdate', (text) => {
    expect(parseCommand(text)).toEqual({ kind: 'regionalUpdate' });
  });
  it('does not hijack other commands', () => {
    expect(parseCommand('nhập dữ liệu từ excel').kind).toBe('importFile');
  });
});

import { describe, expect, it } from 'vitest';
import {
  formatBitrate,
  formatBytes,
  formatCompact,
  formatCurrency,
  formatDuration,
} from './format';

describe('format helpers', () => {
  it('formats bytes and bit rates', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5.3 * 1024 ** 4)).toBe('5.3 TB');
    expect(formatBitrate(12_500_000)).toBe('100.0 Mbit/s');
  });

  it('formats durations, money and compact numbers', () => {
    expect(formatDuration(65)).toBe('01:05');
    expect(formatDuration(3 * 3600 + 5 * 60)).toBe('3h 05m');
    expect(formatDuration(2 * 86_400 + 3600)).toBe('2d 1h');
    expect(formatCurrency(899, 'eur', 'en')).toBe('€8.99');
    expect(formatCompact(14_382)).toBe('14.4K');
  });
});

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

export function formatBytes(bytes: number | null | undefined, digits = 1): string {
  if (!bytes || bytes <= 0) return '0 B';
  const exponent = Math.min(UNITS.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(exponent === 0 ? 0 : value >= 100 ? 0 : digits)} ${UNITS[exponent]}`;
}

/** Bytes per second → bit rate (network convention). */
export function formatBitrate(bytesPerSecond: number): string {
  const bits = bytesPerSecond * 8;
  if (bits >= 1e9) return `${(bits / 1e9).toFixed(2)} Gbit/s`;
  if (bits >= 1e6) return `${(bits / 1e6).toFixed(1)} Mbit/s`;
  if (bits >= 1e3) return `${(bits / 1e3).toFixed(0)} kbit/s`;
  return `${Math.round(bits)} bit/s`;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const days = Math.floor(s / 86_400);
  const hours = Math.floor((s % 86_400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatCurrency(cents: number, currency: string, locale?: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
}

export function formatCompact(value: number): string {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en').format(value);
}

export function formatDate(value: string | Date | null | undefined, options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, options).format(new Date(value));
}

export function formatDateTime(value: string | Date | null | undefined): string {
  return formatDate(value, { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatRelative(value: string | Date | null | undefined, now = Date.now()): string {
  if (!value) return 'never';
  const diff = (new Date(value).getTime() - now) / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86_400), 'day');
}

export function intervalLabel(interval: string, count: number): string {
  const unit = interval.toLowerCase();
  return count === 1 ? unit : `${count} ${unit}s`;
}

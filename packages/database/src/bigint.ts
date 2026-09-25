/** Converts BigInt counters to JSON-safe numbers (exact up to 9 PB). */
export function toNumber(value: bigint | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === 'bigint' ? Number(value) : value;
}

export function toNullableNumber(value: bigint | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return toNumber(value);
}

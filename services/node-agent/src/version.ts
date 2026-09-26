export const AGENT_VERSION = '1.0.0';

/** Semver comparison (major.minor.patch, pre-release ignored). */
export function isNewerVersion(candidate: string, current: string): boolean {
  const parse = (value: string) =>
    value
      .split(/[-+]/)[0]!
      .split('.')
      .map((part) => Number(part) || 0);
  const a = parse(candidate);
  const b = parse(current);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

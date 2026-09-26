import type { Region } from './enums';

export interface CountryInfo {
  code: string;
  name: string;
  region: Region;
  /** Approximate population-weighted centroid used for latency estimation. */
  lat: number;
  lon: number;
}

const C = (code: string, name: string, region: Region, lat: number, lon: number): CountryInfo => ({
  code,
  name,
  region,
  lat,
  lon,
});

export const COUNTRIES: readonly CountryInfo[] = [
  C('AT', 'Austria', 'EUROPE', 48.2, 16.37),
  C('BE', 'Belgium', 'EUROPE', 50.85, 4.35),
  C('BG', 'Bulgaria', 'EUROPE', 42.7, 23.32),
  C('CH', 'Switzerland', 'EUROPE', 47.37, 8.54),
  C('CZ', 'Czechia', 'EUROPE', 50.08, 14.44),
  C('DE', 'Germany', 'EUROPE', 50.11, 8.68),
  C('DK', 'Denmark', 'EUROPE', 55.68, 12.57),
  C('EE', 'Estonia', 'EUROPE', 59.44, 24.75),
  C('ES', 'Spain', 'EUROPE', 40.42, -3.7),
  C('FI', 'Finland', 'EUROPE', 60.17, 24.94),
  C('FR', 'France', 'EUROPE', 48.86, 2.35),
  C('GB', 'United Kingdom', 'EUROPE', 51.51, -0.13),
  C('GR', 'Greece', 'EUROPE', 37.98, 23.73),
  C('HR', 'Croatia', 'EUROPE', 45.81, 15.98),
  C('HU', 'Hungary', 'EUROPE', 47.5, 19.04),
  C('IE', 'Ireland', 'EUROPE', 53.35, -6.26),
  C('IS', 'Iceland', 'EUROPE', 64.15, -21.94),
  C('IT', 'Italy', 'EUROPE', 45.46, 9.19),
  C('LT', 'Lithuania', 'EUROPE', 54.69, 25.28),
  C('LU', 'Luxembourg', 'EUROPE', 49.61, 6.13),
  C('LV', 'Latvia', 'EUROPE', 56.95, 24.11),
  C('NL', 'Netherlands', 'EUROPE', 52.37, 4.9),
  C('NO', 'Norway', 'EUROPE', 59.91, 10.75),
  C('PL', 'Poland', 'EUROPE', 52.23, 21.01),
  C('PT', 'Portugal', 'EUROPE', 38.72, -9.14),
  C('RO', 'Romania', 'EUROPE', 44.43, 26.1),
  C('RS', 'Serbia', 'EUROPE', 44.79, 20.45),
  C('SE', 'Sweden', 'EUROPE', 59.33, 18.07),
  C('SI', 'Slovenia', 'EUROPE', 46.06, 14.51),
  C('SK', 'Slovakia', 'EUROPE', 48.15, 17.11),
  C('UA', 'Ukraine', 'EUROPE', 50.45, 30.52),
  C('TR', 'Turkey', 'MIDDLE_EAST', 41.01, 28.98),
  C('AE', 'United Arab Emirates', 'MIDDLE_EAST', 25.2, 55.27),
  C('IL', 'Israel', 'MIDDLE_EAST', 32.09, 34.78),
  C('SA', 'Saudi Arabia', 'MIDDLE_EAST', 24.71, 46.68),
  C('US', 'United States', 'NORTH_AMERICA', 39.83, -98.58),
  C('CA', 'Canada', 'NORTH_AMERICA', 43.65, -79.38),
  C('MX', 'Mexico', 'NORTH_AMERICA', 19.43, -99.13),
  C('BR', 'Brazil', 'SOUTH_AMERICA', -23.55, -46.63),
  C('AR', 'Argentina', 'SOUTH_AMERICA', -34.6, -58.38),
  C('CL', 'Chile', 'SOUTH_AMERICA', -33.45, -70.67),
  C('CO', 'Colombia', 'SOUTH_AMERICA', 4.71, -74.07),
  C('JP', 'Japan', 'ASIA_PACIFIC', 35.68, 139.69),
  C('KR', 'South Korea', 'ASIA_PACIFIC', 37.57, 126.98),
  C('SG', 'Singapore', 'ASIA_PACIFIC', 1.35, 103.82),
  C('HK', 'Hong Kong', 'ASIA_PACIFIC', 22.32, 114.17),
  C('TW', 'Taiwan', 'ASIA_PACIFIC', 25.03, 121.57),
  C('IN', 'India', 'ASIA_PACIFIC', 19.08, 72.88),
  C('ID', 'Indonesia', 'ASIA_PACIFIC', -6.21, 106.85),
  C('MY', 'Malaysia', 'ASIA_PACIFIC', 3.14, 101.69),
  C('TH', 'Thailand', 'ASIA_PACIFIC', 13.76, 100.5),
  C('VN', 'Vietnam', 'ASIA_PACIFIC', 10.82, 106.63),
  C('PH', 'Philippines', 'ASIA_PACIFIC', 14.6, 120.98),
  C('AU', 'Australia', 'OCEANIA', -33.87, 151.21),
  C('NZ', 'New Zealand', 'OCEANIA', -36.85, 174.76),
  C('ZA', 'South Africa', 'AFRICA', -26.2, 28.05),
  C('NG', 'Nigeria', 'AFRICA', 6.52, 3.38),
  C('EG', 'Egypt', 'AFRICA', 30.04, 31.24),
  C('KE', 'Kenya', 'AFRICA', -1.29, 36.82),
];

const byCode = new Map(COUNTRIES.map((country) => [country.code, country]));

export function getCountry(code: string | null | undefined): CountryInfo | undefined {
  return code ? byCode.get(code.toUpperCase()) : undefined;
}

export function countryName(code: string): string {
  return getCountry(code)?.name ?? code.toUpperCase();
}

/** Great-circle distance in kilometres. */
export function haversineKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Rough RTT estimate from distance: light in fibre travels ~200 km/ms,
 * real routes are ~1.5x longer than great-circle, plus a base overhead.
 */
export function estimateLatencyMs(distanceKm: number): number {
  return Math.round(5 + ((distanceKm * 1.5) / 200) * 2);
}

/** Converts an ISO country code into its flag emoji. */
export function countryFlag(code: string): string {
  return code
    .toUpperCase()
    .replace(/./g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)));
}

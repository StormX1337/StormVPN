import { estimateLatencyMs, haversineKm } from '@stormvpn/types';
import type { NodeStatus } from '@stormvpn/database';

export interface Candidate {
  id: string;
  name: string;
  countryCode: string;
  city: string;
  region: string;
  serverClass: string;
  latitude: number | null;
  longitude: number | null;
  status: NodeStatus;
  load: number;
  activeConnections: number;
  capacity: number;
}

export interface SelectionContext {
  allowedCountries: string[];
  serverClasses: string[];
  planPriority: number;
  filters: { country?: string; region?: string; city?: string };
  preferences: {
    preferredCountry?: string | null;
    preferredRegion?: string | null;
    favoriteServerIds: Set<string>;
  };
  clientLocation: { lat: number; lon: number } | null;
  /** Client measured RTTs (ms) keyed by server id – preferred over estimates. */
  latencies?: Record<string, number>;
  /** Servers at or above this load never receive new users. */
  overloadThreshold: number;
}

export interface ScoredCandidate {
  candidate: Candidate;
  score: number;
  latencyMs: number | null;
}

export type IneligibleReason =
  'offline' | 'plan_country' | 'plan_class' | 'overloaded' | 'full' | 'filter';

const WEIGHTS = { load: 0.45, latency: 0.35, headroom: 0.2 } as const;
/** High-priority plans get the headroom above this margin below the overload threshold. */
const PRIORITY_RESERVE_MARGIN = 15;
const HIGH_PRIORITY = 50;
/** Candidates within this many points of the best are considered equivalent (spreads load). */
const TIE_WINDOW = 3;

export function ineligibility(
  candidate: Candidate,
  ctx: SelectionContext,
): IneligibleReason | null {
  if (candidate.status !== 'ONLINE' && candidate.status !== 'DEGRADED') return 'offline';
  if (ctx.allowedCountries.length > 0 && !ctx.allowedCountries.includes(candidate.countryCode))
    return 'plan_country';
  if (!ctx.serverClasses.includes(candidate.serverClass)) return 'plan_class';
  if (candidate.activeConnections >= candidate.capacity) return 'full';
  if (candidate.load >= ctx.overloadThreshold) return 'overloaded';
  const { country, region, city } = ctx.filters;
  if (country && candidate.countryCode !== country) return 'filter';
  if (region && candidate.region !== region) return 'filter';
  if (city && candidate.city.toLowerCase() !== city.toLowerCase()) return 'filter';
  return null;
}

export function latencyFor(candidate: Candidate, ctx: SelectionContext): number | null {
  const measured = ctx.latencies?.[candidate.id];
  if (measured !== undefined) return measured;
  if (ctx.clientLocation && candidate.latitude !== null && candidate.longitude !== null) {
    return estimateLatencyMs(
      haversineKm(ctx.clientLocation, { lat: candidate.latitude, lon: candidate.longitude }),
    );
  }
  return null;
}

export function scoreCandidate(candidate: Candidate, ctx: SelectionContext): ScoredCandidate {
  const latencyMs = latencyFor(candidate, ctx);
  const loadScore = 100 - candidate.load;
  const latencyScore = latencyMs === null ? 50 : Math.max(0, 100 - latencyMs / 2);
  const headroom =
    candidate.capacity > 0
      ? ((candidate.capacity - candidate.activeConnections) / candidate.capacity) * 100
      : 0;

  let score =
    WEIGHTS.load * loadScore + WEIGHTS.latency * latencyScore + WEIGHTS.headroom * headroom;
  if (ctx.preferences.favoriteServerIds.has(candidate.id)) score += 8;
  if (
    ctx.preferences.preferredCountry &&
    candidate.countryCode === ctx.preferences.preferredCountry
  )
    score += 10;
  if (ctx.preferences.preferredRegion && candidate.region === ctx.preferences.preferredRegion)
    score += 4;

  const softLimit = ctx.overloadThreshold - PRIORITY_RESERVE_MARGIN;
  if (ctx.planPriority < HIGH_PRIORITY && candidate.load > softLimit)
    score -= (candidate.load - softLimit) * 2;
  if (candidate.status === 'DEGRADED') score -= 20;

  return { candidate, score: Math.round(score * 100) / 100, latencyMs };
}

/**
 * Picks the best server: only healthy, permitted, non-overloaded nodes are
 * eligible (degraded nodes only as a last resort). Near-equal candidates are
 * chosen randomly so simultaneous Quick Connects don't pile onto one node.
 */
export function selectServer(
  candidates: Candidate[],
  ctx: SelectionContext,
  random: () => number = Math.random,
): { selected: ScoredCandidate; ranked: ScoredCandidate[] } | null {
  const eligible = candidates.filter((candidate) => ineligibility(candidate, ctx) === null);
  const online = eligible.filter((candidate) => candidate.status === 'ONLINE');
  const pool = online.length > 0 ? online : eligible;
  if (pool.length === 0) return null;

  const ranked = pool
    .map((candidate) => scoreCandidate(candidate, ctx))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0]!.score;
  const top = ranked.filter((entry) => best - entry.score <= TIE_WINDOW);
  const selected = top[Math.min(top.length - 1, Math.floor(random() * top.length))]!;
  return { selected, ranked };
}

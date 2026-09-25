export interface LoadInput {
  activeConnections: number;
  capacity: number;
  cpuPercent: number;
  rxBps: number;
  txBps: number;
  bandwidthCapacityMbps: number;
}

/**
 * Server load (0–100) = the most constrained resource among connection slots,
 * CPU and bandwidth. A node is as loaded as its bottleneck.
 */
export function computeServerLoad(input: LoadInput): number {
  const connectionLoad = input.capacity > 0 ? (input.activeConnections / input.capacity) * 100 : 100;
  const bandwidthBps = Math.max(input.rxBps, input.txBps) * 8;
  const bandwidthCapacity = input.bandwidthCapacityMbps * 1_000_000;
  const bandwidthLoad = bandwidthCapacity > 0 ? (bandwidthBps / bandwidthCapacity) * 100 : 0;
  const load = Math.max(connectionLoad, input.cpuPercent, bandwidthLoad);
  return Math.round(Math.min(100, Math.max(0, load)) * 10) / 10;
}

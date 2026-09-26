/**
 * Development helper: keeps the seeded demo nodes alive by sending realistic
 * heartbeats through the real agent API (same code path as production agents).
 *
 *   pnpm db:seed && pnpm demo:fleet
 *
 * Never run against production – it only uses tokens from packages/database/.demo-nodes.json.
 */
import { readFile } from 'node:fs/promises';

const API = process.env.STORMVPN_API_URL ?? 'http://localhost:4000';
const INTERVAL_MS = 15_000;
const applied = new Map<string, number>();

interface DemoNode {
  serverName: string;
  nodeToken: string;
}

const jitter = (base: number, spread: number) => Math.max(0, base + (Math.random() - 0.5) * spread);

async function beat(node: DemoNode, index: number, tick: number): Promise<void> {
  const base = [30, 45, 22, 58, 37, 18, 64, 27][index % 8]!;
  const load = jitter(base + 8 * Math.sin(tick / 6 + index), 6);
  const body = {
    agentVersion: '1.0.0',
    metrics: {
      cpuPercent: Math.min(100, load * 0.8),
      memoryPercent: jitter(40 + index * 3, 4),
      memoryTotalBytes: 8 * 1024 ** 3,
      diskPercent: 15 + index * 2,
      rxBps: Math.round(load * 380_000),
      txBps: Math.round(load * 1_500_000),
      uptimeSeconds: 86_400 * 7 + tick * 15,
      loadAverage: [load / 25, load / 28, load / 30],
    },
    wireguard: {
      interfaceUp: true,
      listenPort: 51820,
      peerCount: Math.round(load * 4),
      appliedRevision: applied.get(node.serverName) ?? 0,
      totalRxBytes: 0,
      totalTxBytes: 0,
    },
    health: { wireguard: { ok: true }, ipForward: { ok: true }, nat: { ok: true } },
    peers: [],
  };
  const response = await fetch(`${API}/api/v1/agent/heartbeat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${node.nodeToken}` },
    body: JSON.stringify(body),
  });
  const result = (await response.json()) as { desiredRevision?: number };
  if (!response.ok) throw new Error(`${node.serverName}: HTTP ${response.status}`);
  // Report the desired revision as applied on the next beat (simulated sync).
  applied.set(node.serverName, result.desiredRevision ?? 0);
}

async function main(): Promise<void> {
  const nodes = JSON.parse(
    await readFile(new URL('../packages/database/.demo-nodes.json', import.meta.url), 'utf8'),
  ) as DemoNode[];
  console.log(`Simulating ${nodes.length} nodes against ${API} (Ctrl+C to stop)`);
  let tick = 0;
  const run = async () => {
    const results = await Promise.allSettled(nodes.map((node, index) => beat(node, index, tick)));
    const failed = results.filter((result) => result.status === 'rejected');
    console.log(`tick ${tick}: ${nodes.length - failed.length}/${nodes.length} heartbeats ok`);
    for (const failure of failed) console.error((failure as PromiseRejectedResult).reason);
    tick++;
  };
  await run();
  setInterval(() => void run(), INTERVAL_MS);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

import type { AgentPeerStat } from '@stormvpn/validation';
import type { WgPeerStatus } from '../wireguard/dump';

const ACTIVE_HANDSHAKE_SECONDS = 180;

/**
 * Converts cumulative WireGuard counters into per-interval deltas. Counters
 * reset when a peer is re-added; in that case the new value is the delta.
 */
export class PeerTrafficTracker {
  private previous = new Map<string, { rx: number; tx: number }>();

  /** Returns stats for peers with traffic or a recent handshake and remembers counters. */
  collect(peers: WgPeerStatus[], nowSeconds = Math.floor(Date.now() / 1000)): AgentPeerStat[] {
    const next = new Map<string, { rx: number; tx: number }>();
    const stats: AgentPeerStat[] = [];
    for (const peer of peers) {
      const before = this.previous.get(peer.publicKey);
      const rxDelta = before && peer.rxBytes >= before.rx ? peer.rxBytes - before.rx : peer.rxBytes;
      const txDelta = before && peer.txBytes >= before.tx ? peer.txBytes - before.tx : peer.txBytes;
      next.set(peer.publicKey, { rx: peer.rxBytes, tx: peer.txBytes });
      const recent =
        peer.latestHandshake > 0 && nowSeconds - peer.latestHandshake < ACTIVE_HANDSHAKE_SECONDS;
      if (rxDelta > 0 || txDelta > 0 || recent) {
        stats.push({
          publicKey: peer.publicKey,
          latestHandshake: peer.latestHandshake,
          rxBytesDelta: rxDelta,
          txBytesDelta: txDelta,
        });
      }
    }
    this.previous = next;
    return stats;
  }

  /** Called when a report failed so deltas are resent with the next heartbeat. */
  rollback(stats: AgentPeerStat[]): void {
    for (const stat of stats) {
      const entry = this.previous.get(stat.publicKey);
      if (entry)
        this.previous.set(stat.publicKey, {
          rx: entry.rx - stat.rxBytesDelta,
          tx: entry.tx - stat.txBytesDelta,
        });
    }
  }
}

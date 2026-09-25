export interface WgPeerStatus {
  publicKey: string;
  endpoint: string | null;
  allowedIps: string[];
  /** Unix seconds, 0 = never. */
  latestHandshake: number;
  rxBytes: number;
  txBytes: number;
}

export interface WgInterfaceStatus {
  publicKey: string;
  listenPort: number;
  peers: WgPeerStatus[];
}

/**
 * Parses `wg show <iface> dump` (tab separated). The first line describes the
 * interface, every following line a peer:
 *   public-key preshared-key endpoint allowed-ips latest-handshake rx tx keepalive
 */
export function parseWgDump(output: string): WgInterfaceStatus {
  const lines = output.split('\n').filter((line) => line.trim().length > 0);
  const header = lines.shift()?.split('\t');
  if (!header || header.length < 3) throw new Error('Unexpected wg dump output');
  const peers = lines.map((line) => {
    const [publicKey, , endpoint, allowedIps, handshake, rx, tx] = line.split('\t');
    return {
      publicKey: publicKey!,
      endpoint: endpoint && endpoint !== '(none)' ? endpoint : null,
      allowedIps: allowedIps && allowedIps !== '(none)' ? allowedIps.split(',') : [],
      latestHandshake: Number(handshake) || 0,
      rxBytes: Number(rx) || 0,
      txBytes: Number(tx) || 0,
    };
  });
  return { publicKey: header[1]!, listenPort: Number(header[2]) || 0, peers };
}

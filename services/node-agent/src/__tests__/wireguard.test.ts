import { mkdtemp, readFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLogger } from '@stormvpn/config';
import { generateWireGuardKeyPair } from '@stormvpn/crypto';
import type { AgentConfigResponse } from '@stormvpn/validation';
import type { CommandRunner } from '../exec';
import { StateStore } from '../state';
import { parseWgDump } from '../wireguard/dump';
import { WgToolsManager } from '../wireguard/manager';
import { renderInterfaceConfig, renderSyncConfig } from '../wireguard/render';

const logger = createLogger({ name: 'test', level: 'silent' });

const DUMP = [
  'SERVERPRIV=\tSERVERPUB=\t51820\toff',
  'PEERA=\tPSKA=\t198.51.100.4:40211\t10.80.0.2/32,fd80:1::2/128\t1790000000\t1024\t4096\toff',
  'PEERB=\t(none)\t(none)\t10.80.0.3/32\t0\t0\t0\toff',
].join('\n');

describe('wg dump parser', () => {
  it('parses interface and peers', () => {
    const status = parseWgDump(DUMP);
    expect(status.listenPort).toBe(51820);
    expect(status.peers).toHaveLength(2);
    expect(status.peers[0]).toMatchObject({ publicKey: 'PEERA=', endpoint: '198.51.100.4:40211', latestHandshake: 1790000000, rxBytes: 1024, txBytes: 4096 });
    expect(status.peers[0]!.allowedIps).toEqual(['10.80.0.2/32', 'fd80:1::2/128']);
    expect(status.peers[1]).toMatchObject({ endpoint: null, latestHandshake: 0 });
  });
});

describe('config rendering', () => {
  const peer = { publicKey: generateWireGuardKeyPair().publicKey, presharedKey: generateWireGuardKeyPair().publicKey, allowedIps: ['10.80.0.2/32'] };

  it('renders a syncconf file', () => {
    const text = renderSyncConfig('PRIV=', 51820, [peer]);
    expect(text).toContain('[Interface]\nPrivateKey = PRIV=\nListenPort = 51820');
    expect(text).toContain(`[Peer]\nPublicKey = ${peer.publicKey}\nPresharedKey = ${peer.presharedKey}\nAllowedIPs = 10.80.0.2/32`);
  });

  it('refuses injection attempts from a compromised control plane', () => {
    expect(() => renderSyncConfig('PRIV=', 51820, [{ ...peer, allowedIps: ['0.0.0.0/0\nPostUp = rm -rf /'] }])).toThrow(/unsafe/i);
    expect(() =>
      renderInterfaceConfig('PRIV=', { listenPort: 51820, addressV4: '10.80.0.1/20; touch /tmp/x', addressV6: null, subnetV4: '', subnetV6: null, dns: [] }),
    ).toThrow(/unsafe/i);
  });
});

class RecordingRunner implements CommandRunner {
  readonly calls: { command: string; args: string[]; file?: string }[] = [];
  up = false;

  async run(command: string, args: string[]) {
    const entry: { command: string; args: string[]; file?: string } = { command, args };
    if (command === 'wg' && args[0] === 'syncconf') entry.file = await readFile(args[2]!, 'utf8');
    this.calls.push(entry);
    if (command === 'wg' && args[0] === 'show' && !this.up) throw new Error('no such device');
    if (command === 'wg-quick' && args[0] === 'up') this.up = true;
    return { stdout: '', stderr: '' };
  }
}

describe('WgToolsManager', () => {
  it('brings the interface up, syncs peers atomically and removes the temp file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'stormvpn-agent-'));
    const state = new StateStore(join(dir, 'state'));
    const runner = new RecordingRunner();
    const manager = new WgToolsManager('wg0', dir, runner, state, logger);
    const config: AgentConfigResponse = {
      revision: 3,
      interface: { listenPort: 51820, addressV4: '10.80.0.1/20', addressV6: 'fd80:1::1/64', subnetV4: '10.80.0.0/20', subnetV6: 'fd80:1::/64', dns: [] },
      peers: [{ publicKey: generateWireGuardKeyPair().publicKey, presharedKey: null, allowedIps: ['10.80.0.2/32'] }],
    };
    await manager.apply(config);

    const commands = runner.calls.map((call) => `${call.command} ${call.args.slice(0, 2).join(' ')}`);
    expect(commands).toContain('wg-quick up wg0');
    const sync = runner.calls.find((call) => call.args[0] === 'syncconf')!;
    expect(sync.file).toContain(config.peers[0]!.publicKey);

    const interfaceFile = await readFile(join(dir, 'wg0.conf'), 'utf8');
    expect(interfaceFile).toContain('Address = 10.80.0.1/20, fd80:1::1/64');
    expect((await stat(join(dir, 'wg0.conf'))).mode & 0o777).toBe(0o600);
    expect((await stat(join(dir, 'state', 'server.key'))).mode & 0o777).toBe(0o600);
    expect(await readdir(join(dir, 'state'))).not.toContain('wg-sync.conf');

    // Unchanged interface config: no restart, only a peer sync.
    runner.calls.length = 0;
    await manager.apply({ ...config, revision: 4, peers: [] });
    expect(runner.calls.some((call) => call.command === 'wg-quick')).toBe(false);
    expect(runner.calls.find((call) => call.args[0] === 'syncconf')!.file).not.toContain('[Peer]');
  });
});

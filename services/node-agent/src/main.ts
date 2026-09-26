import { createLogger } from '@stormvpn/config';
import { ControlPlaneClient } from './api-client';
import { loadAgentConfig } from './config';
import { ExecFileRunner } from './exec';
import { HealthChecker } from './health';
import { SystemMetricsCollector } from './metrics/system';
import { NodeAgent } from './agent';
import { detectWanInterface } from './network';
import { startMetricsServer } from './prometheus';
import { StateStore } from './state';
import { Updater } from './updater';
import { AGENT_VERSION } from './version';
import { DryRunManager, WgToolsManager } from './wireguard/manager';

const USAGE = `stormvpn-agent ${AGENT_VERSION}

Usage: stormvpn-agent <command>

Commands:
  run        register (if needed) and start the control loop
  register   register this node with STORMVPN_ENROLLMENT_TOKEN and exit
  status     print registration and WireGuard status
  version    print the agent version`;

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'run';
  if (command === 'version' || command === '--version') {
    process.stdout.write(`${AGENT_VERSION}\n`);
    return;
  }
  if (!['run', 'register', 'status'].includes(command)) {
    process.stdout.write(`${USAGE}\n`);
    process.exitCode = command === 'help' || command === '--help' ? 0 : 1;
    return;
  }

  const config = loadAgentConfig();
  const logger = createLogger({ name: 'stormvpn-agent', level: config.LOG_LEVEL });
  const runner = new ExecFileRunner();
  const state = new StateStore(config.STORMVPN_STATE_DIR);
  const wireguard = config.AGENT_DRY_RUN
    ? new DryRunManager(logger)
    : new WgToolsManager(config.WG_INTERFACE, config.WG_CONFIG_DIR, runner, state, logger);
  const client = new ControlPlaneClient(config.STORMVPN_API_URL, config.HTTP_TIMEOUT_MS);
  let wan: string | null | undefined;
  const agent = new NodeAgent({
    config,
    client,
    state,
    wireguard,
    metrics: new SystemMetricsCollector(
      async () => (wan ??= await detectWanInterface(config.WAN_INTERFACE)),
    ),
    health: new HealthChecker(wireguard, runner, config.AGENT_DRY_RUN),
    updater: new Updater(config.AGENT_AUTO_UPDATE, config.AGENT_UPDATE_COMMAND, runner, logger),
    logger,
  });

  if (command === 'register') {
    const credentials = await agent.ensureRegistered();
    process.stdout.write(`Registered as ${credentials.serverName} (node ${credentials.nodeId})\n`);
    return;
  }
  if (command === 'status') {
    const credentials = await state.readCredentials();
    const status = await wireguard.status();
    process.stdout.write(
      `${JSON.stringify(
        {
          version: AGENT_VERSION,
          registered: credentials !== null,
          server: credentials?.serverName ?? null,
          nodeId: credentials?.nodeId ?? null,
          wireguard: status
            ? { listenPort: status.listenPort, peers: status.peers.length }
            : 'down',
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  const metricsServer = config.METRICS_ENABLED
    ? startMetricsServer(
        config.METRICS_HOST,
        config.METRICS_PORT,
        () => agent.snapshot,
        () => ({ server: agent.serverName }),
      )
    : null;
  const shutdown = () => {
    logger.info('stopping agent (WireGuard keeps running)');
    agent.stop();
    metricsServer?.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  logger.info(
    { version: AGENT_VERSION, dryRun: config.AGENT_DRY_RUN, api: config.STORMVPN_API_URL },
    'stormvpn-agent starting',
  );
  await agent.start();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

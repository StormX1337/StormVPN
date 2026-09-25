import type { MaintenanceJobName } from '../queues';
import { runAbuseScan } from './abuse-scan';
import { runCleanup } from './cleanup';
import { runConnectionReaper } from './connection-reaper';
import type { JobHandler } from './context';
import { runNodeHealth } from './node-health';
import { runSubscriptionLifecycle } from './subscription-lifecycle';
import { runTrafficEnforcement } from './traffic-enforcement';

export * from './context';
export { computeRiskScore, type RiskSignals } from './abuse-scan';
export {
  runAbuseScan,
  runCleanup,
  runConnectionReaper,
  runNodeHealth,
  runSubscriptionLifecycle,
  runTrafficEnforcement,
};

export const MAINTENANCE_HANDLERS: Record<MaintenanceJobName, JobHandler> = {
  'node-health': runNodeHealth,
  'connection-reaper': runConnectionReaper,
  'traffic-enforcement': runTrafficEnforcement,
  'subscription-lifecycle': runSubscriptionLifecycle,
  cleanup: runCleanup,
  'abuse-scan': runAbuseScan,
};

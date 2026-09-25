import { readFile, statfs } from 'node:fs/promises';
import os from 'node:os';

export interface CpuSample {
  idle: number;
  total: number;
}

/** Parses the aggregate `cpu` line of /proc/stat. */
export function parseProcStat(content: string): CpuSample {
  const line = content.split('\n').find((entry) => entry.startsWith('cpu '));
  if (!line) throw new Error('No cpu line in /proc/stat');
  const values = line.trim().split(/\s+/).slice(1).map(Number);
  const idle = (values[3] ?? 0) + (values[4] ?? 0);
  return { idle, total: values.reduce((sum, value) => sum + value, 0) };
}

export function cpuPercent(previous: CpuSample, current: CpuSample): number {
  const total = current.total - previous.total;
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, ((total - (current.idle - previous.idle)) / total) * 100));
}

/** Parses /proc/meminfo (kB values) into total/available bytes. */
export function parseMeminfo(content: string): { totalBytes: number; availableBytes: number } {
  const value = (key: string) => {
    const match = new RegExp(`^${key}:\\s+(\\d+)`, 'm').exec(content);
    return match ? Number(match[1]) * 1024 : 0;
  };
  return { totalBytes: value('MemTotal'), availableBytes: value('MemAvailable') };
}

export interface SystemMetrics {
  cpuPercent: number;
  memoryPercent: number;
  memoryTotalBytes: number;
  diskPercent: number;
  rxBps: number;
  txBps: number;
  uptimeSeconds: number;
  loadAverage: [number, number, number];
}

const round = (value: number) => Math.round(value * 10) / 10;

/** Collects host metrics from procfs/sysfs with portable fallbacks. */
export class SystemMetricsCollector {
  private lastCpu: CpuSample | null = null;
  private lastNet: { rx: number; tx: number; at: number } | null = null;

  constructor(private readonly wanInterface: () => Promise<string | null>) {}

  private async cpu(): Promise<number> {
    let sample: CpuSample;
    try {
      sample = parseProcStat(await readFile('/proc/stat', 'utf8'));
    } catch {
      const cpus = os.cpus();
      sample = cpus.reduce(
        (acc, cpu) => {
          const total = Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
          return { idle: acc.idle + cpu.times.idle, total: acc.total + total };
        },
        { idle: 0, total: 0 },
      );
    }
    const result = this.lastCpu ? cpuPercent(this.lastCpu, sample) : 0;
    this.lastCpu = sample;
    return result;
  }

  private async memory(): Promise<{ percent: number; total: number }> {
    try {
      const info = parseMeminfo(await readFile('/proc/meminfo', 'utf8'));
      if (info.totalBytes > 0) return { percent: ((info.totalBytes - info.availableBytes) / info.totalBytes) * 100, total: info.totalBytes };
    } catch {
      /* fall back to os module */
    }
    return { percent: ((os.totalmem() - os.freemem()) / os.totalmem()) * 100, total: os.totalmem() };
  }

  private async disk(): Promise<number> {
    try {
      const stats = await statfs('/');
      return stats.blocks > 0 ? ((stats.blocks - stats.bavail) / stats.blocks) * 100 : 0;
    } catch {
      return 0;
    }
  }

  private async network(): Promise<{ rxBps: number; txBps: number }> {
    const iface = await this.wanInterface();
    if (!iface) return { rxBps: 0, txBps: 0 };
    try {
      const base = `/sys/class/net/${iface}/statistics`;
      const [rx, tx] = await Promise.all([readFile(`${base}/rx_bytes`, 'utf8'), readFile(`${base}/tx_bytes`, 'utf8')]);
      const now = Date.now();
      const current = { rx: Number(rx), tx: Number(tx), at: now };
      const previous = this.lastNet;
      this.lastNet = current;
      if (!previous || current.rx < previous.rx || current.tx < previous.tx) return { rxBps: 0, txBps: 0 };
      const seconds = Math.max(1, (now - previous.at) / 1000);
      return { rxBps: (current.rx - previous.rx) / seconds, txBps: (current.tx - previous.tx) / seconds };
    } catch {
      return { rxBps: 0, txBps: 0 };
    }
  }

  async collect(): Promise<SystemMetrics> {
    const [cpu, memory, disk, network] = await Promise.all([this.cpu(), this.memory(), this.disk(), this.network()]);
    const [l1, l5, l15] = os.loadavg();
    return {
      cpuPercent: round(cpu),
      memoryPercent: round(memory.percent),
      memoryTotalBytes: memory.total,
      diskPercent: round(disk),
      rxBps: Math.round(network.rxBps),
      txBps: Math.round(network.txBps),
      uptimeSeconds: Math.round(os.uptime()),
      loadAverage: [round(l1 ?? 0), round(l5 ?? 0), round(l15 ?? 0)],
    };
  }
}

import { pino, type Logger, type LoggerOptions } from 'pino';

export type { Logger } from 'pino';

/** Paths that must never appear in logs. */
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.privateKey',
  '*.presharedKey',
  '*.secret',
  '*.nodeToken',
  '*.enrollmentToken',
  '*.totpSecret',
  '*.code',
];

export interface CreateLoggerOptions {
  name: string;
  level?: string;
  pretty?: boolean;
}

/** Structured JSON logger (pino) with secret redaction. */
export function createLogger({
  name,
  level = 'info',
  pretty = false,
}: CreateLoggerOptions): Logger {
  const options: LoggerOptions = {
    name,
    level,
    redact: { paths: LOG_REDACT_PATHS, censor: '[REDACTED]' },
    base: { service: name },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
  };
  if (pretty) {
    options.transport = {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
    };
  }
  return pino(options);
}

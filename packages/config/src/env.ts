import { z } from 'zod';

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'EnvValidationError';
  }
}

/**
 * Parses and validates environment variables against a zod schema.
 * Fails fast with a readable error listing every invalid variable
 * (values are never echoed to avoid leaking secrets into logs).
 */
export function loadEnv<S extends z.ZodType>(
  schema: S,
  source: Record<string, string | undefined> = process.env,
): z.infer<S> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new EnvValidationError(issues);
  }
  return result.data;
}

/** Boolean env parser accepting true/false/1/0/yes/no. */
export const envBoolean = (defaultValue: boolean) =>
  z
    .enum(['true', 'false', '1', '0', 'yes', 'no', ''])
    .optional()
    .transform((value) => {
      if (value === undefined || value === '') return defaultValue;
      return value === 'true' || value === '1' || value === 'yes';
    });

/** Comma separated list parser. */
export const envList = (defaultValue: string[] = []) =>
  z
    .string()
    .optional()
    .transform((value) =>
      value === undefined || value.trim() === ''
        ? defaultValue
        : value
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean),
    );

/** Secret with a minimum length, rejecting obvious placeholder values in production. */
export const envSecret = (minLength = 32) =>
  z
    .string()
    .min(minLength, `must be at least ${minLength} characters`)
    .refine((value) => !/^(change[-_]?me|secret|password|placeholder)/i.test(value), {
      message: 'looks like a placeholder value – generate a real secret',
    });

import { z } from 'zod';
import { displayNameSchema, emailSchema, passwordSchema } from './common';

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: displayNameSchema.optional(),
  acceptTerms: z.literal(true, { message: 'You must accept the terms of service' }),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const mfaCodeSchema = z
  .string()
  .trim()
  .regex(/^(\d{6}|[A-Za-z0-9]{4}-?[A-Za-z0-9]{4})$/, 'Enter a 6 digit code or a backup code');

export const mfaLoginSchema = z.object({
  mfaToken: z.string().min(20).max(200),
  code: mfaCodeSchema,
});
export type MfaLoginInput = z.infer<typeof mfaLoginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(20).max(300).optional(),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

export const tokenSchema = z.object({ token: z.string().min(20).max(200) });
export type TokenInput = z.infer<typeof tokenSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const resendVerificationSchema = z.object({ email: emailSchema });

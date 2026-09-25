import { z } from 'zod';
import { Region } from '@stormvpn/types';
import { countryCodeSchema, displayNameSchema, passwordSchema } from './common';
import { mfaCodeSchema } from './auth';

export const updateProfileSchema = z
  .object({
    name: displayNameSchema.nullable(),
    preferredCountry: countryCodeSchema.nullable(),
    preferredRegion: z.enum(Region).nullable(),
  })
  .partial();
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: passwordSchema,
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: 'New password must differ from the current password',
    path: ['newPassword'],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const enableTwoFactorSchema = z.object({ code: z.string().regex(/^\d{6}$/) });
export const disableTwoFactorSchema = z.object({
  password: z.string().min(1).max(128),
  code: mfaCodeSchema,
});
export const regenerateBackupCodesSchema = z.object({ code: z.string().regex(/^\d{6}$/) });
export const deleteAccountSchema = z.object({
  password: z.string().min(1).max(128),
  confirm: z.literal('DELETE'),
});

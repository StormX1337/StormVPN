import { z } from 'zod';
import { idSchema } from './common';

export const couponCodeSchema = z
  .string()
  .trim()
  .min(3)
  .max(40)
  .regex(/^[A-Za-z0-9_-]+$/)
  .transform((value) => value.toUpperCase());

export const checkoutSchema = z.object({
  planId: idSchema,
  couponCode: couponCodeSchema.optional(),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const changePlanSchema = z.object({ planId: idSchema });
export type ChangePlanInput = z.infer<typeof changePlanSchema>;

export const validateCouponSchema = z.object({
  code: couponCodeSchema,
  planId: idSchema.optional(),
});

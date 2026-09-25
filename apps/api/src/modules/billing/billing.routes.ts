import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { changePlanSchema, checkoutSchema, validateCouponSchema } from '@stormvpn/validation';
import { authOf } from '../../lib/auth-context';
import { badRequest, serviceUnavailable } from '../../lib/errors';
import { toCouponDto } from './coupon.service';

/** `/api/v1/plans` – public plan catalogue. */
export async function planRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/', async () => fastify.services.billing.listPlans());
}

/** `/api/v1/subscription` */
export async function subscriptionRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.get('/', async (request) => fastify.services.billing.overview(authOf(request).userId));
}

/** `/api/v1/billing` */
export async function billingRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const { billing, coupons } = app.services;

  await app.register(async (secured) => {
    const routes = secured.withTypeProvider<ZodTypeProvider>();
    routes.addHook('preHandler', app.authenticate);

    routes.post('/checkout', { schema: { body: checkoutSchema } }, async (request) =>
      billing.checkout(authOf(request).userId, request.body),
    );
    routes.post('/portal', async (request) => billing.portal(authOf(request).userId));
    routes.post('/change-plan', { schema: { body: changePlanSchema } }, async (request) =>
      billing.changePlan(authOf(request).userId, request.body.planId),
    );
    routes.post('/cancel', async (request) => billing.setCancellation(authOf(request).userId, true));
    routes.post('/resume', async (request) => billing.setCancellation(authOf(request).userId, false));
    routes.get('/invoices', async (request) => billing.invoices(authOf(request).userId));
    routes.post('/coupons/validate', { schema: { body: validateCouponSchema } }, async (request) =>
      toCouponDto(await coupons.validate(request.body.code, authOf(request).userId, request.body.planId)),
    );
  });

  // Stripe webhook: raw body for signature verification, no CSRF/cookies, not rate limited per IP.
  await app.register(async (webhook) => {
    webhook.removeAllContentTypeParsers();
    webhook.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: 1024 * 1024 }, (_request, body, done) => {
      done(null, body);
    });
    webhook.post('/webhook', { config: { csrf: false, rateLimit: false } }, async (request, reply) => {
      const { stripeWebhooks, stripeGateway } = app.services;
      if (!stripeWebhooks || !stripeGateway) throw serviceUnavailable('billing_unavailable', 'Stripe is not configured');
      const signature = request.headers['stripe-signature'];
      if (typeof signature !== 'string' || !Buffer.isBuffer(request.body)) {
        throw badRequest('invalid_signature', 'Missing Stripe signature');
      }
      let event;
      try {
        event = stripeGateway.constructEvent(request.body, signature);
      } catch {
        throw badRequest('invalid_signature', 'Invalid Stripe signature');
      }
      const outcome = await stripeWebhooks.handle(event);
      return reply.status(200).send({ received: true, outcome });
    });
  });
}

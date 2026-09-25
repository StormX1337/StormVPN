import { describe, expect, it } from 'vitest';
import type { EmailTemplate } from '@stormvpn/core';
import { renderEmail } from '../email/templates';

const templates: EmailTemplate[] = [
  'verify-email',
  'password-reset',
  'password-changed',
  'welcome',
  'new-login',
  'payment-failed',
  'subscription-canceled',
  'trial-ending',
  'account-suspended',
  'traffic-limit-reached',
];

describe('email templates', () => {
  it.each(templates)('renders %s', (template) => {
    const email = renderEmail({ template, to: 'a@b.c', data: { link: 'https://app.test/x?token=abc', name: 'Ann' } }, 'https://app.test');
    expect(email.subject.length).toBeGreaterThan(5);
    expect(email.html).toContain('STORMVPN');
    expect(email.text).toContain('StormVPN');
  });

  it('escapes user controlled values and refuses non-http links', () => {
    const email = renderEmail(
      { template: 'verify-email', to: 'a@b.c', data: { name: '<img src=x onerror=alert(1)>', link: 'javascript:alert(1)' } },
      'https://app.test',
    );
    expect(email.html).not.toContain('<img src=x');
    expect(email.html).toContain('&lt;img');
    expect(email.html).not.toContain('javascript:');
  });
});

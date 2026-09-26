import type { EmailJob, EmailTemplate } from '@stormvpn/core';

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );

const str = (value: unknown): string =>
  value === null || value === undefined ? '' : String(value);

interface TemplateContent {
  subject: string;
  heading: string;
  paragraphs: string[];
  action?: { label: string; url: string };
  footnote?: string;
}

function content(job: EmailJob, appUrl: string): TemplateContent {
  const d = job.data;
  const templates: Record<EmailTemplate, () => TemplateContent> = {
    'verify-email': () => ({
      subject: 'Confirm your StormVPN email address',
      heading: 'Confirm your email',
      paragraphs: [
        `Hi${d.name ? ` ${str(d.name)}` : ''}, welcome to StormVPN!`,
        'Please confirm your email address to activate your account.',
      ],
      action: { label: 'Confirm email', url: str(d.link) },
      footnote:
        'This link expires in 24 hours. If you did not create an account, ignore this email.',
    }),
    'password-reset': () => ({
      subject: 'Reset your StormVPN password',
      heading: 'Reset your password',
      paragraphs: ['We received a request to reset the password of your StormVPN account.'],
      action: { label: 'Choose a new password', url: str(d.link) },
      footnote:
        'This link expires in 1 hour. If you did not request a reset, you can safely ignore this email.',
    }),
    'password-changed': () => ({
      subject: 'Your StormVPN password was changed',
      heading: 'Password changed',
      paragraphs: [
        `Your password was changed at ${str(d.time)}. Other sessions have been signed out.`,
        'If this was not you, reset your password immediately and contact support.',
      ],
      action: { label: 'Review account security', url: `${appUrl}/account` },
    }),
    welcome: () => ({
      subject: 'Your StormVPN account is ready',
      heading: 'You are all set',
      paragraphs: ['Your email is confirmed. Choose a plan, add a device and connect in seconds.'],
      action: { label: 'Open dashboard', url: `${appUrl}/dashboard` },
    }),
    'new-login': () => ({
      subject: 'New sign-in to your StormVPN account',
      heading: 'New sign-in detected',
      paragraphs: [
        `We noticed a sign-in from ${str(d.ipAddress)} (${str(d.userAgent)}) at ${str(d.time)}.`,
        'If this was you, no action is needed.',
      ],
      action: { label: 'Review sessions', url: `${appUrl}/account` },
    }),
    'payment-failed': () => ({
      subject: 'Payment failed for your StormVPN subscription',
      heading: 'We could not process your payment',
      paragraphs: [
        `The payment of ${str(d.amount)} ${str(d.currency)} failed. Please update your payment method to keep your protection active.`,
      ],
      action: {
        label: 'Update payment method',
        url: d.invoiceUrl ? str(d.invoiceUrl) : `${appUrl}/subscription`,
      },
    }),
    'subscription-canceled': () => ({
      subject: 'Your StormVPN subscription was cancelled',
      heading: 'Subscription cancelled',
      paragraphs: ['Your subscription has ended. You can resubscribe at any time.'],
      action: { label: 'View plans', url: `${appUrl}/subscription` },
    }),
    'trial-ending': () => ({
      subject: 'Your StormVPN trial ends soon',
      heading: 'Your trial is ending',
      paragraphs: [
        `Your ${str(d.plan)} trial ends on ${str(d.trialEnd).slice(0, 10)}. Your subscription continues automatically unless you cancel.`,
      ],
      action: { label: 'Manage subscription', url: `${appUrl}/subscription` },
    }),
    'account-suspended': () => ({
      subject: 'Your StormVPN account has been suspended',
      heading: 'Account suspended',
      paragraphs: [
        `Your account was suspended (${str(d.reason)}). Contact support if you believe this is a mistake.`,
      ],
    }),
    'traffic-limit-reached': () => ({
      subject: 'You reached your monthly StormVPN traffic',
      heading: 'Traffic allowance used up',
      paragraphs: [
        `You used your ${str(d.limitGb)} GB monthly allowance. Upgrade for unlimited traffic or wait until next month.`,
      ],
      action: { label: 'Upgrade now', url: `${appUrl}/subscription` },
    }),
  };
  return templates[job.template]();
}

/** Renders branded plain-text + HTML emails. All dynamic values are HTML-escaped. */
export function renderEmail(job: EmailJob, appUrl: string): RenderedEmail {
  const c = content(job, appUrl);
  const text = [
    c.heading,
    '',
    ...c.paragraphs,
    ...(c.action ? ['', `${c.action.label}: ${c.action.url}`] : []),
    ...(c.footnote ? ['', c.footnote] : []),
    '',
    '— StormVPN',
  ].join('\n');

  const safeUrl = c.action && /^https?:\/\//.test(c.action.url) ? escapeHtml(c.action.url) : null;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(c.subject)}</title></head>
<body style="margin:0;background:#0b1020;font-family:Inter,Segoe UI,Arial,sans-serif;color:#e2e8f0">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:560px;background:#111831;border:1px solid #1e2a4a;border-radius:16px;padding:32px">
        <tr><td style="font-size:14px;font-weight:800;letter-spacing:4px;color:#38bdf8">STORMVPN</td></tr>
        <tr><td style="padding-top:24px;font-size:22px;font-weight:700;color:#f8fafc">${escapeHtml(c.heading)}</td></tr>
        ${c.paragraphs.map((p) => `<tr><td style="padding-top:12px;font-size:15px;line-height:1.6">${escapeHtml(p)}</td></tr>`).join('\n        ')}
        ${safeUrl ? `<tr><td style="padding-top:24px"><a href="${safeUrl}" style="display:inline-block;background:#0ea5e9;color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:10px">${escapeHtml(c.action!.label)}</a></td></tr>` : ''}
        ${c.footnote ? `<tr><td style="padding-top:24px;font-size:12px;color:#94a3b8">${escapeHtml(c.footnote)}</td></tr>` : ''}
      </table>
      <p style="font-size:11px;color:#64748b;margin-top:16px">You receive this email because of your StormVPN account.</p>
    </td></tr>
  </table>
</body></html>`;
  return { subject: c.subject, text, html };
}

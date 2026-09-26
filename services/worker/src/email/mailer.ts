import nodemailer, { type Transporter } from 'nodemailer';
import type { WorkerEnv } from '@stormvpn/config';
import type { RenderedEmail } from './templates';

export interface Mailer {
  send(to: string, email: RenderedEmail): Promise<void>;
  verify(): Promise<boolean>;
}

export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;

  constructor(private readonly env: WorkerEnv) {
    this.transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
      requireTLS: env.NODE_ENV === 'production' && !env.SMTP_SECURE,
    });
  }

  async send(to: string, email: RenderedEmail): Promise<void> {
    await this.transport.sendMail({
      from: this.env.MAIL_FROM,
      to,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });
  }

  async verify(): Promise<boolean> {
    try {
      await this.transport.verify();
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Transactional email transport.
 *
 * Two providers, chosen by `EMAIL_PROVIDER`:
 *
 *  - `resend` (default) — HTTP API, needs a **verified domain**. Resend will not
 *    send from a `gmail.com` address, because that domain cannot be verified by
 *    anyone but Google.
 *  - `smtp` — sends through a real mailbox (Gmail, Fastmail, Workspace, Mailgun
 *    SMTP…). This is the only way to have mail genuinely come *from* an address
 *    you do not control a domain for, because the mailbox itself authenticates
 *    the sender.
 *
 * Both paths stay silent until `EMAIL_ENABLED=true` and the provider's own
 * credentials are present, so a half-configured environment cannot send.
 *
 * Delivery is idempotent at the caller's level (`email_deliveries.notification_id`
 * is unique); the `Idempotency-Key` below is a second line of defence for retries
 * within Resend's window.
 */
import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env';
import { ApiError } from './errors';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export function isEmailConfigured(): boolean {
  if (!env.EMAIL_ENABLED || !env.EMAIL_FROM) return false;
  if (env.EMAIL_PROVIDER === 'smtp') return Boolean(env.SMTP_USER && env.SMTP_PASS);
  return Boolean(env.RESEND_API_KEY);
}

export interface OutboundEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Stable key so a retry cannot produce a duplicate message (Resend only). */
  idempotencyKey?: string;
}

export interface SentEmail {
  providerId: string | null;
}

/* -------------------------------------------------------------------------- */
/* SMTP                                                                        */
/* -------------------------------------------------------------------------- */

let cachedTransport: { key: string; transport: Transporter } | null = null;

function smtpTransport(): Transporter {
  // Reuse the pooled connection, but rebuild if the credentials change.
  const key = `${env.SMTP_HOST}:${env.SMTP_PORT}:${env.SMTP_USER}:${env.SMTP_PASS?.length}`;
  if (cachedTransport?.key === key) return cachedTransport.transport;

  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: { user: env.SMTP_USER!, pass: env.SMTP_PASS! },
    connectionTimeout: env.EMAIL_TIMEOUT_MS,
    greetingTimeout: env.EMAIL_TIMEOUT_MS,
    socketTimeout: env.EMAIL_TIMEOUT_MS,
  });

  cachedTransport = { key, transport };
  return transport;
}

async function sendViaSmtp(email: OutboundEmail): Promise<SentEmail> {
  try {
    const info = await smtpTransport().sendMail({
      from: env.EMAIL_FROM,
      to: email.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
      ...(env.EMAIL_REPLY_TO ? { replyTo: env.EMAIL_REPLY_TO } : {}),
    });
    return { providerId: info.messageId ?? null };
  } catch (error) {
    const candidate = error as { code?: string; response?: string; message?: string };

    /*
     * Gmail refuses a `From` that differs from the authenticated account, and
     * reports weak app passwords as EAUTH. Both are configuration mistakes worth
     * naming exactly rather than burying in a generic failure.
     */
    if (candidate.code === 'EAUTH' || candidate.code === 'EENVELOPE') {
      throw new ApiError(
        503,
        'EMAIL_UNAVAILABLE',
        'The SMTP server rejected the credentials or the sender address.',
        { providerStatus: candidate.code ?? null, providerMessage: (candidate.response ?? candidate.message ?? '').slice(0, 300) },
      );
    }

    throw new ApiError(503, 'EMAIL_FAILED', 'The SMTP server did not accept the message.', {
      providerStatus: candidate.code ?? null,
      providerMessage: (candidate.message ?? '').slice(0, 300),
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Resend                                                                      */
/* -------------------------------------------------------------------------- */

async function sendViaResend(email: OutboundEmail): Promise<SentEmail> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.EMAIL_TIMEOUT_MS);

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        ...(email.idempotencyKey ? { 'Idempotency-Key': email.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [email.to],
        subject: email.subject,
        html: email.html,
        text: email.text,
        ...(env.EMAIL_REPLY_TO ? { reply_to: env.EMAIL_REPLY_TO } : {}),
      }),
      signal: controller.signal,
    });

    if (response.status === 401 || response.status === 403) {
      /*
       * 403 is not only "bad key": Resend also uses it for an unverified sending
       * domain and for test-mode recipient restrictions. The provider's own
       * message is passed through so the difference is visible.
       */
      const detail = await response.text().catch(() => '');
      throw new ApiError(
        503,
        'EMAIL_UNAVAILABLE',
        response.status === 401
          ? 'The email provider rejected the configured API key.'
          : 'The email provider refused the sender or recipient.',
        { providerStatus: response.status, providerMessage: detail.slice(0, 400) || null },
      );
    }
    if (response.status === 429) {
      throw new ApiError(503, 'EMAIL_FAILED', 'The email provider is rate limiting this server.');
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new ApiError(503, 'EMAIL_FAILED', `The email provider returned an error (${response.status}).`, {
        providerStatus: response.status,
        providerMessage: detail.slice(0, 300) || null,
      });
    }

    const payload = (await response.json().catch(() => ({}))) as { id?: string };
    return { providerId: payload.id ?? null };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError(503, 'EMAIL_FAILED', 'The email provider did not respond in time.');
    }
    throw new ApiError(503, 'EMAIL_FAILED', 'Could not reach the email provider.');
  } finally {
    clearTimeout(timer);
  }
}

/* -------------------------------------------------------------------------- */

export async function sendEmail(email: OutboundEmail): Promise<SentEmail> {
  if (!isEmailConfigured()) {
    throw new ApiError(
      503,
      'EMAIL_UNAVAILABLE',
      env.EMAIL_PROVIDER === 'smtp'
        ? 'SMTP email is not configured (SMTP_USER / SMTP_PASS).'
        : 'Email is not configured on this server.',
    );
  }

  return env.EMAIL_PROVIDER === 'smtp' ? sendViaSmtp(email) : sendViaResend(email);
}

/** Exposed so diagnostics can report which transport is live without sending. */
export function emailTransportName(): string {
  return env.EMAIL_PROVIDER;
}

import nodemailer, { type Transporter } from 'nodemailer';
import { db } from './db.ts';

/**
 * Transactional email delivery over generic SMTP (works with Brevo, Gmail, OVH,
 * AWS SES, Resend SMTP relay, ...). When no SMTP host is configured, emails stay
 * queued in outbox_emails (demo mode) and remain visible/relayable from the
 * admin console — exactly the pre-SMTP behaviour.
 *
 * Env vars:
 *   SMTP_HOST   — e.g. smtp-relay.brevo.com
 *   SMTP_PORT   — 465 (TLS implicite) ou 587 (STARTTLS), défaut 587
 *   SMTP_SECURE — "true" pour forcer le TLS implicite (auto si port 465)
 *   SMTP_USER   — identifiant SMTP
 *   SMTP_PASS   — mot de passe ou clé SMTP
 *   SMTP_FROM   — expéditeur, ex. "SIMCOVA <no-reply@simcova.africa>"
 */

const MAX_ATTEMPTS = 20;

let cachedTransporter: Transporter | null = null;
let transporterKey = '';

export function isSmtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST?.trim() && process.env.SMTP_FROM?.trim());
}

/**
 * Builds (and caches) the SMTP transporter from env vars. Exposed separately so
 * tests can inject a jsonTransport without touching the environment.
 */
export function getSmtpTransporter(): Transporter | null {
  // Test-injected transporter (jsonTransport) takes precedence over env configuration.
  if (transporterKey === 'injected' && cachedTransporter) {
    return cachedTransporter;
  }
  if (!isSmtpConfigured()) return null;
  const host = process.env.SMTP_HOST!.trim();
  const port = Number(process.env.SMTP_PORT?.trim() || 587);
  const key = `${host}:${port}:${process.env.SMTP_USER || ''}`;
  if (cachedTransporter && transporterKey === key) {
    return cachedTransporter;
  }
  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
    auth: process.env.SMTP_USER?.trim()
      ? { user: process.env.SMTP_USER.trim(), pass: process.env.SMTP_PASS || '' }
      : undefined,
  });
  transporterKey = key;
  return cachedTransporter;
}

/** Test hook: injects a custom transporter (e.g. nodemailer jsonTransport). */
export function setSmtpTransporterForTests(transporter: Transporter | null): void {
  cachedTransporter = transporter;
  transporterKey = transporter ? 'injected' : '';
}

function buildEmailBody(bodyText: string, actionUrl?: string | null, actionLabel?: string | null): { text: string; html: string } {
  const lines = bodyText.split('\n').filter(Boolean);
  const text = [...lines, actionUrl ? `\n→ ${actionLabel || 'Ouvrir le lien'} : ${actionUrl}` : ''].join('\n');
  const html = `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#0F1111">
  <div style="background:#131921;color:#fff;padding:16px 20px;border-radius:6px 6px 0 0;font-weight:700;letter-spacing:.5px">
    SIMCOVA — Machines &amp; Matériel Pro
  </div>
  <div style="border:1px solid #D5D9D9;border-top:none;border-radius:0 0 6px 6px;padding:20px;font-size:14px;line-height:1.6">
    ${lines.map((l) => `<p style="margin:0 0 10px">${l}</p>`).join('')}
    ${
      actionUrl
        ? `<p style="margin:24px 0 8px"><a href="${actionUrl}" style="background:#F59E0B;color:#131921;font-weight:700;padding:12px 22px;border-radius:6px;text-decoration:none;display:inline-block">${actionLabel || 'Ouvrir le lien'}</a></p>
           <p style="font-size:12px;color:#565959;word-break:break-all">${actionUrl}</p>`
        : ''
    }
    <p style="font-size:11px;color:#565959;margin-top:24px;border-top:1px solid #D5D9D9;padding-top:12px">
      Message automatique de la place de marché SIMCOVA — achats sans compte, suivi sécurisé par lien personnel.
    </p>
  </div>
</div>`;
  return { text, html };
}

/**
 * Sends every unsent outbox email through SMTP. Rows are marked sent_at on
 * success; failures record the error and increment attempts (capped) so a
 * dead SMTP server never blocks the loop.
 */
export async function flushOutbox(): Promise<{ sent: number; failed: number; skipped: number }> {
  const transporter = getSmtpTransporter();
  if (!transporter) return { sent: 0, failed: 0, skipped: 0 };

  const pending = db
    .prepare('SELECT * FROM outbox_emails WHERE sent_at IS NULL AND attempts < ? ORDER BY created_at ASC LIMIT 20')
    .all(MAX_ATTEMPTS) as Array<{
    id: string;
    to_email: string;
    subject: string;
    body_text: string;
    action_url: string | null;
    action_label: string | null;
    attempts: number;
  }>;

  let sent = 0;
  let failed = 0;
  for (const mail of pending) {
    const { text, html } = buildEmailBody(mail.body_text, mail.action_url, mail.action_label);
    try {
      await transporter.sendMail({
        from: process.env.SMTP_FROM?.trim() || 'SIMCOVA <no-reply@simcova.africa>',
        to: mail.to_email,
        subject: mail.subject,
        text,
        html,
      });
      db.prepare('UPDATE outbox_emails SET sent_at = ?, attempts = attempts + 1, last_error = NULL WHERE id = ?').run(
        new Date().toISOString(),
        mail.id
      );
      sent += 1;
    } catch (err) {
      db.prepare('UPDATE outbox_emails SET attempts = attempts + 1, last_error = ? WHERE id = ?').run(
        err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
        mail.id
      );
      failed += 1;
    }
  }
  return { sent, failed, skipped: pending.length };
}

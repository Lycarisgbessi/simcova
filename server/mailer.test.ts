import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import nodemailer from 'nodemailer';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'simcova-mailer-'));
process.env.SIMCOVA_DB_PATH = path.join(tmpDir, 'mailer-test.db');
delete process.env.SMTP_HOST;
delete process.env.SMTP_FROM;

const { initDatabase, db, closeDatabase, queueTransactionalEmail } = await import('./db.ts');
const { flushOutbox, isSmtpConfigured, setSmtpTransporterForTests } = await import('./mailer.ts');

before(async () => { await initDatabase();
  initDatabase();
});

after(async () => {
  try {
    await closeDatabase();
  } catch {
    // ignore
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('outbox email lifecycle: queued without SMTP, sent via SMTP, retried on failure', async () => {
  // Phase 1 — no SMTP configured: emails stay queued (demo mode preserved)
  assert.equal(isSmtpConfigured(), false);
  queueTransactionalEmail({
    toEmail: 'demo@simcova.test',
    subject: 'Démo sans SMTP',
    bodyText: 'Cet email doit rester en file.',
  });
  const idle = await flushOutbox();
  assert.equal(idle.sent, 0);
  const queuedRow = await db.prepare('SELECT sent_at, attempts FROM outbox_emails WHERE to_email = ?')
    .get('demo@simcova.test') as { sent_at: string | null; attempts: number };
  assert.equal(queuedRow.sent_at, null);
  assert.equal(queuedRow.attempts, 0);

  // Phase 2 — SMTP available (jsonTransport, offline): pending emails are sent & marked
  setSmtpTransporterForTests(nodemailer.createTransport({ jsonTransport: true }));
  queueTransactionalEmail({
    toEmail: 'acheteur@simcova.test',
    subject: 'SIMCOVA — Confirmation de commande CMD-TEST',
    bodyText: 'Merci ! Votre commande est enregistrée.',
    actionUrl: 'https://simcova.africa/?suivi=tok-123',
    actionLabel: 'Suivre ma commande',
  });
  const sent = await flushOutbox();
  assert.ok(sent.sent >= 2, `au moins la file démo + acheteur envoyées (reçu ${sent.sent})`);
  const sentRow = await db.prepare('SELECT sent_at, attempts, last_error FROM outbox_emails WHERE to_email = ?')
    .get('acheteur@simcova.test') as { sent_at: string | null; attempts: number; last_error: string | null };
  assert.ok(sentRow.sent_at);
  assert.equal(sentRow.last_error, null);
  const reflush = await flushOutbox();
  assert.equal(reflush.sent, 0); // rien de déjà envoyé n'est renvoyé

  // Phase 3 — SMTP outage: error recorded, attempt counted, email stays retryable
  const failing = nodemailer.createTransport({ jsonTransport: true });
  failing.sendMail = async () => {
    throw new Error('connexion SMTP perdue (test)');
  };
  setSmtpTransporterForTests(failing);
  queueTransactionalEmail({
    toEmail: 'echec@simcova.test',
    subject: 'Test échec envoi',
    bodyText: 'Doit rester en file avec une erreur.',
  });
  const failed = await flushOutbox();
  assert.equal(failed.failed, 1);
  const failedRow = await db.prepare('SELECT sent_at, attempts, last_error FROM outbox_emails WHERE to_email = ?')
    .get('echec@simcova.test') as { sent_at: string | null; attempts: number; last_error: string | null };
  assert.equal(failedRow.sent_at, null);
  assert.equal(failedRow.attempts, 1);
  assert.match(failedRow.last_error || '', /SMTP perdue/);

  setSmtpTransporterForTests(null);
});

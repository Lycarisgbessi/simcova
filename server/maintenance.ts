import crypto from 'node:crypto';
import { db, writeAuditLog } from './db.ts';
import { pruneRateBuckets } from './rateLimit.ts';
import { sseHeartbeat } from './sse.ts';
import { flushOutbox } from './mailer.ts';
import { isOrderExpired } from '../src/shared/rulesEngine.ts';
import type { OrderEventStatus } from '../src/shared/types.ts';

/**
 * Applies RG-10 expiration to a single pending order if its deadline has passed.
 * Returns true when the order was transitioned to 'expired'.
 */
export async function expireOrderIfDue(orderRow: Record<string, unknown>): Promise<boolean > {
  if (
    !isOrderExpired({
      paymentStatus: String(orderRow.payment_status),
      expiresAt: orderRow.expires_at ? String(orderRow.expires_at) : null,
    })
  ) {
    return false;
  }
  const now = new Date().toISOString();
  await db.prepare("UPDATE orders SET payment_status = 'expired' WHERE id = ?").run(String(orderRow.id));
  await db.prepare("UPDATE order_items SET item_status = 'expiree' WHERE order_id = ?").run(String(orderRow.id));
  await db.prepare('INSERT INTO order_events (id, order_id, status, note, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    `ev-${crypto.randomUUID().slice(0, 8)}`,
    String(orderRow.id),
    'expiree',
    'Commande expirée automatiquement après dépassement du délai de paiement (RG-10).',
    'Système',
    now
  );
  orderRow.payment_status = 'expired';
  return true;
}

/** RG-10 sweep across all stale pending orders (the tracking endpoint only checks lazily). */
export async function sweepExpiredOrders(): Promise<number > {
  const rows = await db.prepare("SELECT id, payment_status, expires_at FROM orders WHERE payment_status = 'pending' AND expires_at IS NOT NULL")
    .all() as Array<Record<string, unknown>>;
  let expired = 0;
  for (const row of rows) {
    if (await expireOrderIfDue(row)) expired += 1;
  }
  return expired;
}

/** EXNF-05: purge KYC documents whose retention deadline (purge_scheduled_at) has passed. */
export async function purgeExpiredKycDocs(): Promise<number > {
  const now = new Date().toISOString();
  const due = await db.prepare('SELECT id, vendor_id, doc_type FROM kyc_documents WHERE purge_scheduled_at IS NOT NULL AND purge_scheduled_at <= ?')
    .all(now) as Array<{ id: string; vendor_id: string; doc_type: string }>;
  for (const doc of due) {
    await db.prepare('DELETE FROM kyc_documents WHERE id = ?').run(doc.id);
    await writeAuditLog({
      actorId: 'system',
      actorEmail: 'system@simcova.africa',
      action: 'KYC_AUTO_PURGED',
      targetType: 'kyc_document',
      targetId: doc.id,
      details: `Purge automatique après expiration du délai de rétention (${doc.doc_type})`,
    });
  }
  return due.length;
}

/**
 * Background maintenance loop (single-instance deployment):
 * - every 5 min: RG-10 order expiration sweep + KYC retention purge
 * - every 60 s: rate-limiter bucket pruning + SSE heartbeat + outbox email flush
 * All timers are unref'd so tests and CLI processes can exit cleanly.
 */

// Last-run telemetry exposed to the admin system health endpoint (in-memory, single instance).
let lastStats = {
  lastSweepAt: null as string | null,
  lastSweepExpiredOrders: 0,
  lastSweepPurgedKyc: 0,
  lastEmailFlushAt: null as string | null,
  lastEmailFlushSent: 0,
  lastEmailFlushFailed: 0,
  totalSweeps: 0,
};

export function getMaintenanceStats(): typeof lastStats {
  return { ...lastStats };
}

export function startMaintenanceJobs(): void {
  const sweep = setInterval(async () => {
    try {
      const expired = await sweepExpiredOrders();
      const purged = await purgeExpiredKycDocs();
      lastStats = {
        ...lastStats,
        lastSweepAt: new Date().toISOString(),
        lastSweepExpiredOrders: expired,
        lastSweepPurgedKyc: purged,
        totalSweeps: lastStats.totalSweeps + 1,
      };
      if (expired > 0 || purged > 0) {
        console.log(`[SIMCOVA] Maintenance : ${expired} commande(s) expirée(s), ${purged} pièce(s) KYC purgée(s).`);
      }
    } catch (err) {
      console.error('[SIMCOVA] Erreur lors du balayage de maintenance :', err);
    }
  }, 5 * 60 * 1000);

  const heartbeat = setInterval(async () => {
    pruneRateBuckets();
    sseHeartbeat();
    try {
      // Transactional email delivery (no-op unless SMTP_HOST/SMTP_FROM are configured)
      const result = await flushOutbox();
      lastStats = {
        ...lastStats,
        lastEmailFlushAt: new Date().toISOString(),
        lastEmailFlushSent: result.sent,
        lastEmailFlushFailed: result.failed,
      };
      if (result.sent > 0) {
        console.log(`[SIMCOVA] Emails envoyés : ${result.sent} envoyé(s), ${result.failed} en échec.`);
      }
    } catch (err) {
      console.error('[SIMCOVA] Erreur lors du flush de la file email :', err);
    }
  }, 60 * 1000);

  sweep.unref?.();
  heartbeat.unref?.();
}

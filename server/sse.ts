import type { Response } from 'express';
import type { PushAlertItem } from '../src/shared/types.ts';

// SSE subscribers for real-time PWA push alerts (EXF-208, EXF-608).
// Kept in its own module so the maintenance jobs can heartbeat clients
// without creating an import cycle with the API router.
export const sseClients = new Set<Response>();

export function registerSseClient(res: Response): void {
  sseClients.add(res);
  res.on('close', () => {
    sseClients.delete(res);
  });
}

export function broadcastSseAlert(alert: PushAlertItem): void {
  const payload = `event: simcova_alert\ndata: ${JSON.stringify(alert)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

/** Periodic comment ping: detects dead connections and keeps proxies from closing the stream. */
export function sseHeartbeat(): void {
  for (const res of sseClients) {
    try {
      res.write(': ping\n\n');
    } catch {
      sseClients.delete(res);
    }
  }
}

import React, { useCallback, useEffect, useState } from 'react';
import { Database, HardDriveDownload, Mail, RefreshCw, Send, ShieldAlert, Activity } from 'lucide-react';
import { api, getAuthToken } from '../../lib/api';
import { formatCurrency } from '../../shared/rulesEngine';
import type { AdminSystemInfo } from '../../shared/adminTypes';

interface SystemViewProps {
  currency: string;
  settings: { maintenanceMode: boolean };
  onToggleMaintenance: (on: boolean) => void;
  onToast: (type: 'success' | 'error' | 'info', title: string, description?: string) => void;
}

function fmtBytes(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} Mo`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${bytes} o`;
}

function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d > 0 ? `${d} j ${h} h` : h > 0 ? `${h} h ${m} min` : `${m} min`;
}

export const SystemView: React.FC<SystemViewProps> = ({ currency, settings, onToggleMaintenance, onToast }) => {
  const [info, setInfo] = useState<AdminSystemInfo | null>(null);
  const [backups, setBackups] = useState<Array<{ fileName: string; sizeBytes: number; createdAt: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [campaign, setCampaign] = useState({ segment: 'all', subject: '', body: '' });
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setInfo(await api.adminSystem());
      setBackups((await api.adminBackups()).backups);
    } catch (err) {
      onToast('error', 'Erreur système', err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }, [onToast]);

  useEffect(() => {
    load();
  }, [load]);

  const createBackup = async () => {
    try {
      const res = await api.adminCreateBackup();
      onToast('success', 'Sauvegarde créée', `${res.fileName} (${fmtBytes(res.sizeBytes)})`);
      load();
    } catch (err) {
      onToast('error', 'Sauvegarde impossible', err instanceof Error ? err.message : undefined);
    }
  };

  const downloadBackup = (fileName: string) => {
    const token = getAuthToken();
    const a = document.createElement('a');
    a.href = `/api/admin/backups/${encodeURIComponent(fileName)}/download`;
    // fetch with auth then blob (direct link would lack the Authorization header)
    fetch(a.href, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => {
        if (!r.ok) throw new Error('Téléchargement impossible.');
        return r.blob();
      })
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
      })
      .catch((err) => onToast('error', 'Téléchargement', err instanceof Error ? err.message : undefined));
  };

  const sendCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    try {
      const res = await api.adminEmailCampaign({
        segment: campaign.segment as 'buyers' | 'vendors' | 'all',
        subject: campaign.subject,
        body: campaign.body,
      });
      onToast('success', 'Campagne en file d’envoi', `${res.queued} destinataire(s) (${res.segment}) — départ effectif à la configuration SMTP.`);
      setCampaign({ segment: 'all', subject: '', body: '' });
    } catch (err) {
      onToast('error', 'Campagne impossible', err instanceof Error ? err.message : undefined);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-bold text-[var(--sim-text-primary)]">Système, sauvegardes &amp; communication</h2>
        <button type="button" onClick={load} className="sim-btn-secondary py-1.5 px-3">
          <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
          <span>Actualiser</span>
        </button>
      </div>

      {/* Mode maintenance */}
      <div className={`rounded-[var(--sim-radius-lg)] border p-4 flex flex-wrap items-center justify-between gap-3 ${settings.maintenanceMode ? 'bg-[var(--sim-error-bg)] border-red-300' : 'bg-[var(--sim-bg-surface)] border-[var(--sim-border-hairline)]'}`}>
        <div className="flex items-start gap-3">
          <ShieldAlert className={`w-5 h-5 mt-0.5 ${settings.maintenanceMode ? 'text-[var(--sim-error-text)]' : 'text-[var(--sim-text-muted)]'}`} />
          <div>
            <p className="font-display text-sm font-bold text-[var(--sim-text-primary)]">Mode maintenance</p>
            <p className="text-xs text-[var(--sim-text-secondary)] max-w-xl">
              Bloque l’accès API à tous les non-administrateurs (catalogue, commandes, messagerie) pendant une intervention. Les administrateurs gardent l’accès complet.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onToggleMaintenance(!settings.maintenanceMode)}
          className={`px-4 py-2 rounded-[var(--sim-radius-md)] text-xs font-bold ${settings.maintenanceMode ? 'bg-[var(--sim-error-text)] text-white' : 'bg-[var(--sim-steel-950)] text-white'}`}
        >
          {settings.maintenanceMode ? 'Désactiver la maintenance' : 'Activer la maintenance'}
        </button>
      </div>

      {info && (
        <>
          {/* Santé */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-[var(--sim-radius-lg)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-4">
              <p className="text-[10px] font-bold uppercase text-[var(--sim-text-muted)] flex items-center gap-1.5"><Activity className="w-3 h-3" /> Disponibilité</p>
              <p className="font-mono-nums text-lg font-bold">{fmtUptime(info.uptimeSec)}</p>
              <p className="text-[11px] text-[var(--sim-text-muted)]">Node {info.nodeVersion} · {info.memoryMb} Mo RSS · {info.sseClients} flux SSE</p>
            </div>
            <div className="rounded-[var(--sim-radius-lg)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-4">
              <p className="text-[10px] font-bold uppercase text-[var(--sim-text-muted)] flex items-center gap-1.5"><Database className="w-3 h-3" /> Base SQLite</p>
              <p className="font-mono-nums text-lg font-bold">{fmtBytes(info.database.sizeBytes)}</p>
              <p className="text-[11px] text-[var(--sim-text-muted)]">WAL {fmtBytes(info.database.walBytes)} · {info.database.orders} commandes · {info.database.products} produits</p>
            </div>
            <div className="rounded-[var(--sim-radius-lg)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-4">
              <p className="text-[10px] font-bold uppercase text-[var(--sim-text-muted)]">File emails</p>
              <p className="font-mono-nums text-lg font-bold">{info.database.outboxPending}</p>
              <p className="text-[11px] text-[var(--sim-text-muted)]">{info.database.outboxFailed} en échec · dernier envoi {info.maintenance.lastEmailFlushAt ? new Date(info.maintenance.lastEmailFlushAt).toLocaleTimeString('fr-FR') : '—'}</p>
            </div>
            <div className="rounded-[var(--sim-radius-lg)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-4">
              <p className="text-[10px] font-bold uppercase text-[var(--sim-text-muted)]">Médias uploadés</p>
              <p className="font-mono-nums text-lg font-bold">{info.uploads.count}</p>
              <p className="text-[11px] text-[var(--sim-text-muted)]">{fmtBytes(info.uploads.sizeBytes)} · {info.database.vendors} vendeurs · {info.database.payouts} reversements</p>
            </div>
          </div>

          <div className="rounded-[var(--sim-radius-lg)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-4 text-xs text-[var(--sim-text-secondary)]">
            <p className="font-display text-sm font-bold text-[var(--sim-text-primary)] mb-1">Jobs de maintenance</p>
            <p>
              Dernier balayage : {info.maintenance.lastSweepAt ? new Date(info.maintenance.lastSweepAt).toLocaleString('fr-FR') : 'pas encore exécuté'} ·{' '}
              {info.maintenance.totalSweeps} balayage(s) cumulé(s) · dernière purge : {info.maintenance.lastSweepExpiredOrders} commande(s) expirée(s), {info.maintenance.lastSweepPurgedKyc} pièce(s) KYC ·
              emails : {info.maintenance.lastEmailFlushSent} envoyé(s) / {info.maintenance.lastEmailFlushFailed} échec(s).
            </p>
          </div>
        </>
      )}

      {/* Sauvegardes */}
      <div className="rounded-[var(--sim-radius-lg)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-display text-sm font-bold text-[var(--sim-text-primary)]">Sauvegardes de la base (instantanés SQLite)</p>
          <button type="button" onClick={createBackup} className="sim-btn-primary py-2 px-4 text-xs">
            <HardDriveDownload className="w-3.5 h-3.5" />
            <span>Créer une sauvegarde</span>
          </button>
        </div>
        {backups.length === 0 ? (
          <p className="text-xs text-[var(--sim-text-muted)]">Aucune sauvegarde pour l’instant — créez-en une avant chaque opération sensible.</p>
        ) : (
          <div className="divide-y divide-[var(--sim-border-hairline)] text-xs">
            {backups.map((b) => (
              <div key={b.fileName} className="py-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-mono font-semibold text-[var(--sim-text-primary)]">{b.fileName}</p>
                  <p className="text-[11px] text-[var(--sim-text-muted)]">{fmtBytes(b.sizeBytes)} · {new Date(b.createdAt).toLocaleString('fr-FR')}</p>
                </div>
                <button type="button" onClick={() => downloadBackup(b.fileName)} className="sim-btn-secondary py-1.5 px-3 text-[11px]">
                  <HardDriveDownload className="w-3 h-3" />
                  <span>Télécharger</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Campagne email */}
      <form onSubmit={sendCampaign} className="rounded-[var(--sim-radius-lg)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-4 space-y-3">
        <p className="font-display text-sm font-bold text-[var(--sim-text-primary)] flex items-center gap-2">
          <Mail className="w-4 h-4 text-[var(--sim-accent-500)]" /> Campagne email segmentée
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="sim-label">Segment</label>
            <select value={campaign.segment} onChange={(e) => setCampaign((c) => ({ ...c, segment: e.target.value }))} className="sim-input">
              <option value="all">Tout le monde</option>
              <option value="buyers">Acheteurs (emails de commande)</option>
              <option value="vendors">Vendeurs</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="sim-label">Objet</label>
            <input type="text" value={campaign.subject} onChange={(e) => setCampaign((c) => ({ ...c, subject: e.target.value }))} required placeholder="Nouveaux arrivages tracteurs…" className="sim-input" />
          </div>
        </div>
        <div>
          <label className="sim-label">Message</label>
          <textarea rows={3} value={campaign.body} onChange={(e) => setCampaign((c) => ({ ...c, body: e.target.value }))} required placeholder="Bonjour, découvrez…" className="sim-input" />
        </div>
        <button type="submit" disabled={sending} className="sim-btn-primary py-2 px-5 text-xs">
          <Send className="w-3.5 h-3.5" />
          <span>{sending ? 'Mise en file…' : 'Mettre en file d’envoi'}</span>
        </button>
        <p className="text-[11px] text-[var(--sim-text-muted)]">
          Les emails partagent la file transactionnelle (envoi réel dès que SMTP est configuré ; sinon visibles dans l’outbox). Devise de référence : {currency}.
        </p>
      </form>
    </div>
  );
};

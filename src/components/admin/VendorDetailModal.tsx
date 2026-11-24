import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Award, Landmark, Star, X } from 'lucide-react';
import { api } from '../../lib/api';
import { formatCurrency } from '../../shared/rulesEngine';
import type { AdminVendorDetail } from '../../shared/adminTypes';
import { useEscapeKey } from '../../hooks/useEscapeKey';

interface VendorDetailModalProps {
  vendorId: string | null;
  currency: string;
  onClose: () => void;
  onToast: (type: 'success' | 'error' | 'info', title: string, description?: string) => void;
}

export const VendorDetailModal: React.FC<VendorDetailModalProps> = ({ vendorId, currency, onClose, onToast }) => {
  const [detail, setDetail] = useState<AdminVendorDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEscapeKey(() => onClose(), Boolean(vendorId));

  useEffect(() => {
    if (!vendorId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api
      .adminVendorDetail(vendorId)
      .then((res) => {
        if (!cancelled) setDetail(res);
      })
      .catch((err) => {
        onToast('error', 'Fiche vendeur impossible', err instanceof Error ? err.message : undefined);
        onClose();
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [vendorId, onClose, onToast]);

  const v = detail?.vendor;
  const k = detail?.kpis;

  return (
    <AnimatePresence>
      {vendorId && (
        <div role="dialog" aria-modal="true" onClick={onClose} className="fixed inset-0 z-[var(--sim-z-modal)] flex items-center justify-center bg-black/60 backdrop-blur-[2px] p-4">
          <motion.div
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.97, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 10 }}
            className="w-full max-w-3xl max-h-[88vh] overflow-y-auto rounded-[var(--sim-radius-xl)] bg-[var(--sim-bg-surface)] border border-[var(--sim-border-strong)] shadow-[var(--sim-shadow-3)]"
          >
            {loading || !v || !k ? (
              <div className="p-10 text-center text-sm text-[var(--sim-text-secondary)]">Chargement de la fiche vendeur…</div>
            ) : (
              <>
                <div className="bg-[var(--sim-steel-950)] text-white px-6 py-4 flex items-center justify-between sticky top-0 z-10">
                  <div>
                    <h2 className="font-display text-lg font-bold">{detail?.shop?.name || v.fullName}</h2>
                    <p className="text-xs text-slate-400">
                      {v.fullName} · {v.email} · inscrit le {new Date(v.createdAt).toLocaleDateString('fr-FR')}
                    </p>
                  </div>
                  <button type="button" aria-label="Fermer" onClick={onClose} className="p-1.5 text-slate-300 hover:text-white border border-[var(--sim-steel-800)] rounded">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="p-6 space-y-5">
                  <div className="flex flex-wrap gap-2 text-[11px]">
                    <span className={`rounded px-2 py-1 font-bold uppercase ${v.status === 'certifie' ? 'bg-[var(--sim-success-bg)] text-[var(--sim-success-text)]' : v.status === 'suspendu' ? 'bg-[var(--sim-error-bg)] text-[var(--sim-error-text)]' : 'bg-[var(--sim-info-bg)] text-[var(--sim-info-text)]'}`}>
                      {v.status}
                    </span>
                    {v.emailVerified ? <span className="rounded bg-[var(--sim-success-bg)] px-2 py-1 font-semibold text-[var(--sim-success-text)]">Courriel vérifié</span> : <span className="rounded bg-[var(--sim-warning-bg)] px-2 py-1 font-semibold text-[var(--sim-warning-text)]">Courriel non vérifié</span>}
                    {v.badges.map((b) => (
                      <span key={b} className="rounded bg-[var(--sim-accent-50)] px-2 py-1 font-semibold text-[var(--sim-accent-700)] inline-flex items-center gap-1">
                        <Award className="w-3 h-3" /> {b}
                      </span>
                    ))}
                    {detail?.shop?.hasBankDetails && (
                      <span className="rounded bg-[var(--sim-bg-muted)] px-2 py-1 font-semibold text-[var(--sim-text-secondary)] inline-flex items-center gap-1">
                        <Landmark className="w-3 h-3" /> RIB configuré
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="rounded border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-subtle)] p-3">
                      <p className="text-[10px] font-bold uppercase text-[var(--sim-text-muted)]">CA encaissé</p>
                      <p className="font-mono-nums text-lg font-bold">{formatCurrency(k.revenue, currency)}</p>
                    </div>
                    <div className="rounded border border-[var(--sim-accent-ring)] bg-[var(--sim-accent-50)] p-3">
                      <p className="text-[10px] font-bold uppercase text-[var(--sim-accent-700)]">Commission prélevée</p>
                      <p className="font-mono-nums text-lg font-bold text-[var(--sim-accent-700)]">{formatCurrency(k.attributedCommission, currency)}</p>
                    </div>
                    <div className="rounded border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-subtle)] p-3">
                      <p className="text-[10px] font-bold uppercase text-[var(--sim-text-muted)]">Net cumulé</p>
                      <p className="font-mono-nums text-lg font-bold">{formatCurrency(k.net, currency)}</p>
                    </div>
                    <div className="rounded border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-subtle)] p-3">
                      <p className="text-[10px] font-bold uppercase text-[var(--sim-text-muted)]">Reste à reverser</p>
                      <p className={`font-mono-nums text-lg font-bold ${k.outstanding > 0 ? 'text-[var(--sim-warning-text)]' : 'text-[var(--sim-success-text)]'}`}>
                        {formatCurrency(k.outstanding, currency)}
                      </p>
                      <p className="text-[10px] text-[var(--sim-text-muted)]">déjà reversé {formatCurrency(k.paidOut, currency)}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-[11px]">
                    <div className="rounded border border-[var(--sim-border-hairline)] p-2.5"><p className="text-[var(--sim-text-muted)]">Commandes payées</p><p className="font-mono-nums font-bold text-sm">{k.ordersCount}</p></div>
                    <div className="rounded border border-[var(--sim-border-hairline)] p-2.5"><p className="text-[var(--sim-text-muted)]">Remboursements</p><p className="font-mono-nums font-bold text-sm">{k.refundedOrders} ({k.refundRatePct} %)</p></div>
                    <div className="rounded border border-[var(--sim-border-hairline)] p-2.5"><p className="text-[var(--sim-text-muted)]">Produits publiés</p><p className="font-mono-nums font-bold text-sm">{k.publishedProducts}</p></div>
                    <div className="rounded border border-[var(--sim-border-hairline)] p-2.5"><p className="text-[var(--sim-text-muted)]">Note boutique</p><p className="font-mono-nums font-bold text-sm inline-flex items-center gap-1"><Star className="w-3 h-3 text-amber-500" />{k.avgRating || '—'} ({k.reviewCount})</p></div>
                    <div className="rounded border border-[var(--sim-border-hairline)] p-2.5"><p className="text-[var(--sim-text-muted)]">Ville</p><p className="font-bold text-sm">{detail?.shop?.city || v.customFields?.city || '—'}</p></div>
                  </div>

                  {detail && detail.kycDocs.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="font-display text-sm font-bold">Pièces KYC ({detail.kycDocs.length})</p>
                      {detail.kycDocs.map((d) => (
                        <div key={d.id} className="flex items-center justify-between rounded border border-[var(--sim-border-hairline)] px-3 py-2 text-xs">
                          <div>
                            <p className="font-semibold text-[var(--sim-text-primary)]">{d.docType} — {d.fileName}</p>
                            <p className="text-[11px] text-[var(--sim-text-muted)]">dépôt {new Date(d.uploadedAt).toLocaleDateString('fr-FR')}{d.purgeScheduledAt ? ` · purge prévue ${new Date(d.purgeScheduledAt).toLocaleDateString('fr-FR')}` : ''}</p>
                          </div>
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${d.reviewStatus === 'approuve' ? 'bg-[var(--sim-success-bg)] text-[var(--sim-success-text)]' : d.reviewStatus === 'rejete' ? 'bg-[var(--sim-error-bg)] text-[var(--sim-error-text)]' : 'bg-[var(--sim-warning-bg)] text-[var(--sim-warning-text)]'}`}>
                            {d.reviewStatus}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {detail && detail.decisions.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="font-display text-sm font-bold">Historique des décisions</p>
                      <div className="max-h-52 overflow-auto divide-y divide-[var(--sim-border-hairline)] text-xs">
                        {detail.decisions.map((d, i) => (
                          <div key={i} className="py-2 flex items-center justify-between gap-2">
                            <div>
                              <span className="font-mono font-semibold text-[var(--sim-accent-600)]">{d.action}</span>
                              <p className="text-[var(--sim-text-secondary)]">{d.details}</p>
                            </div>
                            <span className="text-[10px] text-[var(--sim-text-muted)] whitespace-nowrap">{new Date(d.createdAt).toLocaleString('fr-FR')} · {d.actorEmail}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

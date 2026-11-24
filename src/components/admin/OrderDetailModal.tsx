import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Banknote, Clock, MapPin, Package, Receipt, X } from 'lucide-react';
import { api } from '../../lib/api';
import { formatCurrency, ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from '../../shared/rulesEngine';
import type { AdminOrderDetail } from '../../shared/adminTypes';
import { useEscapeKey } from '../../hooks/useEscapeKey';

interface OrderDetailModalProps {
  orderId: string | null;
  currency: string;
  onClose: () => void;
  onToast: (type: 'success' | 'error' | 'info', title: string, description?: string) => void;
}

export const OrderDetailModal: React.FC<OrderDetailModalProps> = ({ orderId, currency, onClose, onToast }) => {
  const [detail, setDetail] = useState<AdminOrderDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEscapeKey(() => onClose(), Boolean(orderId));

  useEffect(() => {
    if (!orderId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api
      .adminOrderDetail(orderId)
      .then((res) => {
        if (!cancelled) setDetail(res);
      })
      .catch((err) => {
        onToast('error', 'Commande introuvable', err instanceof Error ? err.message : undefined);
        onClose();
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orderId, onClose, onToast]);

  const o = detail?.order;

  return (
    <AnimatePresence>
      {orderId && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={onClose}
          className="fixed inset-0 z-[var(--sim-z-modal)] flex items-center justify-center bg-black/60 backdrop-blur-[2px] p-4"
        >
          <motion.div
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.97, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 10 }}
            className="w-full max-w-4xl max-h-[88vh] overflow-y-auto rounded-[var(--sim-radius-xl)] bg-[var(--sim-bg-surface)] border border-[var(--sim-border-strong)] shadow-[var(--sim-shadow-3)]"
          >
            {loading || !o ? (
              <div className="p-10 text-center text-sm text-[var(--sim-text-secondary)]">Chargement de la commande…</div>
            ) : (
              <>
                {/* En-tête */}
                <div className="bg-[var(--sim-steel-950)] text-white px-6 py-4 flex items-center justify-between sticky top-0 z-10">
                  <div>
                    <p className="font-mono text-xs text-slate-400">{o.providerRef || 'sans session PSP'}</p>
                    <h2 className="font-display text-lg font-bold">
                      {o.orderNumber}
                      <span
                        className={`ml-3 rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                          o.paymentStatus === 'paid'
                            ? 'bg-emerald-600 text-white'
                            : o.paymentStatus === 'refunded'
                            ? 'bg-red-600 text-white'
                            : 'bg-amber-500 text-[#131921]'
                        }`}
                      >
                        {PAYMENT_STATUS_LABELS[o.paymentStatus] || o.paymentStatus}
                      </span>
                    </h2>
                  </div>
                  <button type="button" aria-label="Fermer" onClick={onClose} className="p-1.5 text-slate-300 hover:text-white border border-[var(--sim-steel-800)] rounded">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="p-6 space-y-6">
                  {/* Ventilation financière complète */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="rounded-[var(--sim-radius-lg)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-subtle)] p-4 space-y-1.5 text-xs">
                      <p className="font-display text-sm font-bold flex items-center gap-2 text-[var(--sim-text-primary)]">
                        <Receipt className="w-4 h-4 text-[var(--sim-accent-500)]" /> Ventilation financière
                      </p>
                      <div className="flex justify-between"><span>Sous-total produits</span><span className="font-mono-nums">{formatCurrency(o.subtotal, currency)}</span></div>
                      <div className="flex justify-between"><span>Livraison</span><span className="font-mono-nums">{formatCurrency(o.deliveryTotal, currency)}</span></div>
                      <div className="flex justify-between font-semibold border-t border-[var(--sim-border-hairline)] pt-1.5"><span>Total HT</span><span className="font-mono-nums">{formatCurrency(o.totalHT, currency)}</span></div>
                      <div className="flex justify-between"><span>TVA</span><span className="font-mono-nums">{formatCurrency(o.vatAmount, currency)}</span></div>
                      <div className="flex justify-between font-bold text-sm border-t border-[var(--sim-border-hairline)] pt-1.5"><span>Total TTC</span><span className="font-mono-nums">{formatCurrency(o.grandTotal, currency)}</span></div>
                      <div className="flex justify-between text-[var(--sim-accent-700)] font-semibold"><span>Commission plateforme</span><span className="font-mono-nums">{formatCurrency(o.commissionAmount, currency)}</span></div>
                      <div className="flex justify-between"><span>Net vendeurs</span><span className="font-mono-nums">{formatCurrency(o.netVendors, currency)}</span></div>
                      {o.paymentMode === 'deposit' && (
                        <>
                          <div className="flex justify-between pt-1.5 border-t border-[var(--sim-border-hairline)]"><span>Acompte ({o.depositPercent} %)</span><span className="font-mono-nums">{formatCurrency(o.paidAmount, currency)}</span></div>
                          <div className="flex justify-between"><span>Solde à la livraison</span><span className="font-mono-nums">{formatCurrency(o.balanceDue, currency)}</span></div>
                        </>
                      )}
                      {o.paymentMode === 'bank_transfer' && o.bankTransferRef && (
                        <div className="flex justify-between pt-1.5 border-t border-[var(--sim-border-hairline)]"><span>Réf. virement</span><span className="font-mono text-[11px]">{o.bankTransferRef}</span></div>
                      )}
                    </div>

                    <div className="rounded-[var(--sim-radius-lg)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-subtle)] p-4 space-y-1.5 text-xs">
                      <p className="font-display text-sm font-bold flex items-center gap-2 text-[var(--sim-text-primary)]">
                        <MapPin className="w-4 h-4 text-[var(--sim-accent-500)]" /> Acheteur & livraison
                      </p>
                      <p className="text-[var(--sim-text-primary)] font-semibold">{o.buyerName}</p>
                      <p className="text-[var(--sim-text-secondary)]">{o.buyerEmail}{o.buyerPhone ? ` · ${o.buyerPhone}` : ''}</p>
                      <p className="text-[var(--sim-text-secondary)]">{o.shippingAddress}</p>
                      <p className="text-[var(--sim-text-muted)]">Zone : {o.deliveryZone}</p>
                      <p className="text-[var(--sim-text-muted)] flex items-center gap-1.5 pt-1.5">
                        <Clock className="w-3.5 h-3.5" /> Créée le {new Date(o.createdAt).toLocaleString('fr-FR')}
                      </p>
                      <p className="text-[var(--sim-text-muted)]">Règlement : {o.paymentMethod} · {o.paymentMode === 'deposit' ? 'acompte' : o.paymentMode === 'quote' ? 'devis' : o.paymentMode === 'bank_transfer' ? 'virement' : 'intégral'}</p>
                    </div>
                  </div>

                  {/* Articles */}
                  <div className="space-y-2">
                    <p className="font-display text-sm font-bold flex items-center gap-2 text-[var(--sim-text-primary)]">
                      <Package className="w-4 h-4 text-[var(--sim-accent-500)]" /> Articles ({detail.items.length})
                    </p>
                    {detail.items.map((it) => (
                      <div key={it.id} className="rounded-[var(--sim-radius-md)] border border-[var(--sim-border-hairline)] p-3 text-xs space-y-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="font-semibold text-[var(--sim-text-primary)]">
                              {it.productTitle}
                              {it.variantLabel ? ` — ${it.variantLabel}` : ''}
                            </p>
                            <p className="text-[11px] text-[var(--sim-text-muted)]">
                              {it.shopName || it.vendorName}{it.categoryName ? ` · ${it.categoryName}` : ''} · Statut : {ORDER_STATUS_LABELS[it.itemStatus] || it.itemStatus}
                            </p>
                          </div>
                          <p className="font-mono-nums font-semibold text-[var(--sim-text-primary)]">
                            {it.quantity} × {formatCurrency(it.unitPrice, currency)}
                            {it.deliveryFee > 0 ? ` + ${formatCurrency(it.deliveryFee, currency)} livr.` : ''}
                          </p>
                        </div>
                        {it.customSpecs && (
                          <div className="rounded bg-[var(--sim-accent-50)] px-2 py-1 text-[11px] text-[var(--sim-accent-700)] space-y-0.5">
                            {it.customSpecs.dimensions && <p>Dimensions : {it.customSpecs.dimensions}</p>}
                            {it.customSpecs.technicalSpecs && <p>Spécificités : {it.customSpecs.technicalSpecs}</p>}
                            {it.customSpecs.notes && <p>Notes : {it.customSpecs.notes}</p>}
                          </div>
                        )}
                        {(it.carrier || it.trackingNumber) && (
                          <p className="text-[11px] text-[var(--sim-text-muted)]">
                            {it.carrier}{it.trackingNumber ? ` · suivi ${it.trackingNumber}` : ''}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Timeline */}
                  <div className="space-y-2">
                    <p className="font-display text-sm font-bold flex items-center gap-2 text-[var(--sim-text-primary)]">
                      <Banknote className="w-4 h-4 text-[var(--sim-accent-500)]" /> Chronologie horodatée ({detail.events.length} événements)
                    </p>
                    <div className="relative pl-4 space-y-3">
                      <div className="absolute left-0 top-1 bottom-1 w-px bg-[var(--sim-border-strong)]" />
                      {detail.events.map((ev) => (
                        <div key={ev.id} className="relative">
                          <span className="absolute -left-[17px] top-1 w-2.5 h-2.5 rounded-full bg-[var(--sim-accent-500)] border-2 border-[var(--sim-bg-surface)]" />
                          <p className="text-xs font-semibold text-[var(--sim-text-primary)]">
                            {ORDER_STATUS_LABELS[ev.status] || ev.status}
                            <span className="ml-2 font-normal text-[var(--sim-text-muted)]">
                              {new Date(ev.createdAt).toLocaleString('fr-FR')}
                            </span>
                          </p>
                          <p className="text-[11px] text-[var(--sim-text-secondary)]">{ev.note}</p>
                          <p className="text-[10px] text-[var(--sim-text-muted)]">par {ev.actor}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

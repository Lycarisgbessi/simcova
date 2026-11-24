import React, { useCallback, useEffect, useState } from 'react';
import { ArrowDownToLine, Banknote, Filter, Landmark, RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';
import { formatCurrency, PAYMENT_STATUS_LABELS } from '../../shared/rulesEngine';
import type { AdminPayoutsResponse, AdminPayoutStatement, AdminTransactionsResponse } from '../../shared/adminTypes';

interface FinanceViewProps {
  currency: string;
  onExportCsv: (type: 'orders' | 'vendors' | 'transactions' | 'accounting' | 'buyers' | 'audit', from?: string, to?: string) => void;
  onOpenOrder: (orderId: string) => void;
  onToast: (type: 'success' | 'error' | 'info', title: string, description?: string) => void;
}

const PERIODS: Array<{ id: '7d' | '30d' | '90d' | 'all'; label: string }> = [
  { id: '7d', label: '7 jours' },
  { id: '30d', label: '30 jours' },
  { id: '90d', label: '90 jours' },
  { id: 'all', label: 'Tout' },
];

const STATUS_OPTIONS = [
  { id: '', label: 'Tous les statuts' },
  { id: 'paid', label: 'Confirmé' },
  { id: 'pending', label: 'En attente' },
  { id: 'failed', label: 'Refusé' },
  { id: 'refunded', label: 'Remboursé' },
  { id: 'expired', label: 'Expiré' },
];

const METHOD_OPTIONS = [
  { id: '', label: 'Tous les moyens' },
  { id: 'mobile_money_orange', label: 'Orange Money' },
  { id: 'mobile_money_mtn', label: 'MTN MoMo' },
  { id: 'mobile_money_wave', label: 'Wave' },
  { id: 'jumia_card', label: 'Carte (JumiaPay)' },
  { id: 'bank_transfer', label: 'Virement' },
  { id: 'quote', label: 'Devis' },
];

export const FinanceView: React.FC<FinanceViewProps> = ({ currency, onExportCsv, onOpenOrder, onToast }) => {
  const [subTab, setSubTab] = useState<'transactions' | 'payouts'>('transactions');

  // ---- Transactions filters
  const [period, setPeriod] = useState<'7d' | '30d' | '90d' | 'all'>('30d');
  const [status, setStatus] = useState('');
  const [method, setMethod] = useState('');
  const [q, setQ] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [txData, setTxData] = useState<AdminTransactionsResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const loadTransactions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.adminTransactions({
        period,
        status: status || undefined,
        method: method || undefined,
        q: q.trim() || undefined,
        minAmount: minAmount.trim() ? Number(minAmount) : undefined,
      });
      setTxData(res);
    } catch (err) {
      onToast('error', 'Erreur transactions', err instanceof Error ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  }, [period, status, method, q, minAmount, onToast]);

  useEffect(() => {
    if (subTab === 'transactions') loadTransactions();
  }, [subTab, loadTransactions]);

  // ---- Payouts
  const [payoutPeriod, setPayoutPeriod] = useState<'7d' | '30d' | '90d' | 'all'>('30d');
  const [payoutData, setPayoutData] = useState<AdminPayoutsResponse | null>(null);
  const [payoutForm, setPayoutForm] = useState<{ statement: AdminPayoutStatement; amount: string; method: string; reference: string; note: string } | null>(null);
  const [savingPayout, setSavingPayout] = useState(false);

  const loadPayouts = useCallback(async () => {
    setLoading(true);
    try {
      setPayoutData(await api.adminPayouts(payoutPeriod));
    } catch (err) {
      onToast('error', 'Erreur reversements', err instanceof Error ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  }, [payoutPeriod, onToast]);

  useEffect(() => {
    if (subTab === 'payouts') loadPayouts();
  }, [subTab, loadPayouts]);

  const submitPayout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payoutForm) return;
    setSavingPayout(true);
    try {
      await api.adminRecordPayout({
        vendorId: payoutForm.statement.vendorId,
        amount: Number(payoutForm.amount),
        method: payoutForm.method,
        reference: payoutForm.reference || undefined,
        note: payoutForm.note || undefined,
      });
      onToast('success', 'Reversement enregistré', `${payoutForm.statement.shopName || payoutForm.statement.vendorName} — ${formatCurrency(Number(payoutForm.amount), currency)}`);
      setPayoutForm(null);
      loadPayouts();
    } catch (err) {
      onToast('error', 'Enregistrement impossible', err instanceof Error ? err.message : undefined);
    } finally {
      setSavingPayout(false);
    }
  };

  const exportFrom = period !== 'all' ? new Date(Date.now() - ({ '7d': 7, '30d': 30, '90d': 90 } as Record<string, number>)[period] * 86_400_000).toISOString().slice(0, 10) : undefined;

  return (
    <div className="space-y-5">
      {/* Sous-navigation Finances */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-[var(--sim-radius-md)] border border-[var(--sim-border-strong)] bg-[var(--sim-bg-surface)] p-1">
          <button
            type="button"
            onClick={() => setSubTab('transactions')}
            className={`rounded-[var(--sim-radius-sm)] px-4 py-1.5 text-xs font-bold uppercase tracking-wide ${subTab === 'transactions' ? 'bg-[var(--sim-steel-950)] text-white' : 'text-[var(--sim-text-secondary)] hover:text-[var(--sim-text-primary)]'}`}
          >
            Journal des transactions
          </button>
          <button
            type="button"
            onClick={() => setSubTab('payouts')}
            className={`rounded-[var(--sim-radius-sm)] px-4 py-1.5 text-xs font-bold uppercase tracking-wide ${subTab === 'payouts' ? 'bg-[var(--sim-steel-950)] text-white' : 'text-[var(--sim-text-secondary)] hover:text-[var(--sim-text-primary)]'}`}
          >
            Reversements vendeurs
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => (subTab === 'transactions' ? loadTransactions() : loadPayouts())} className="sim-btn-secondary py-1.5 px-3">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Actualiser</span>
          </button>
          {subTab === 'transactions' && (
            <button type="button" onClick={() => onExportCsv('accounting', exportFrom)} className="sim-btn-secondary py-1.5 px-3">
              <ArrowDownToLine className="w-3.5 h-3.5" />
              <span>Export comptable (période)</span>
            </button>
          )}
        </div>
      </div>

      {/* ============ TRANSACTIONS ============ */}
      {subTab === 'transactions' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 rounded-[var(--sim-radius-lg)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-4">
            <div>
              <label className="sim-label">Période</label>
              <select value={period} onChange={(e) => setPeriod(e.target.value as '7d' | '30d' | '90d' | 'all')} className="sim-input">
                {PERIODS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="sim-label">Statut</label>
              <select value={status} onChange={(e) => setStatus(e.target.value)} className="sim-input">
                {STATUS_OPTIONS.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="sim-label">Moyen</label>
              <select value={method} onChange={(e) => setMethod(e.target.value)} className="sim-input">
                {METHOD_OPTIONS.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="sim-label">Montant min.</label>
              <input type="number" min={0} value={minAmount} onChange={(e) => setMinAmount(e.target.value)} placeholder="0" className="sim-input font-mono-nums" />
            </div>
            <div className="col-span-2">
              <label className="sim-label">Recherche (n°, acheteur, vendeur)</label>
              <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="CMD-2026-…, nom, email, boutique" className="sim-input" />
            </div>
          </div>

          {/* Barre de totaux */}
          {txData && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="rounded-[var(--sim-radius-md)] bg-[var(--sim-bg-subtle)] border border-[var(--sim-border-hairline)] p-3">
                <p className="text-[10px] font-bold uppercase text-[var(--sim-text-muted)]">Encaissé TTC (payées)</p>
                <p className="font-mono-nums text-lg font-bold text-[var(--sim-text-primary)]">{formatCurrency(txData.totals.grandTotalPaid, currency)}</p>
                <p className="text-[11px] text-[var(--sim-text-muted)]">{txData.totals.paidCount}/{txData.totals.count} transactions</p>
              </div>
              <div className="rounded-[var(--sim-radius-md)] bg-[var(--sim-bg-subtle)] border border-[var(--sim-border-hairline)] p-3">
                <p className="text-[10px] font-bold uppercase text-[var(--sim-text-muted)]">dont TVA collectée</p>
                <p className="font-mono-nums text-lg font-bold text-[var(--sim-text-primary)]">{formatCurrency(txData.totals.vatPaid, currency)}</p>
              </div>
              <div className="rounded-[var(--sim-radius-md)] bg-[var(--sim-accent-50)] border border-[var(--sim-accent-ring)] p-3">
                <p className="text-[10px] font-bold uppercase text-[var(--sim-accent-700)]">Commission plateforme</p>
                <p className="font-mono-nums text-lg font-bold text-[var(--sim-accent-700)]">{formatCurrency(txData.totals.commissionPaid, currency)}</p>
              </div>
              <div className="rounded-[var(--sim-radius-md)] bg-[var(--sim-bg-subtle)] border border-[var(--sim-border-hairline)] p-3">
                <p className="text-[10px] font-bold uppercase text-[var(--sim-text-muted)]">Net vendeurs</p>
                <p className="font-mono-nums text-lg font-bold text-[var(--sim-text-primary)]">{formatCurrency(txData.totals.netVendorsPaid, currency)}</p>
              </div>
              <div className="rounded-[var(--sim-radius-md)] bg-[var(--sim-bg-subtle)] border border-[var(--sim-border-hairline)] p-3">
                <p className="text-[10px] font-bold uppercase text-[var(--sim-text-muted)]">Remboursements</p>
                <p className="font-mono-nums text-lg font-bold text-[var(--sim-text-primary)]">{txData.totals.refundedCount}</p>
              </div>
            </div>
          )}

          <div className="rounded-[var(--sim-radius-lg)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[var(--sim-bg-subtle)] text-[var(--sim-text-muted)]">
                <tr>
                  <th className="px-3 py-3 font-semibold">Date</th>
                  <th className="px-3 py-3 font-semibold">Commande / Acheteur</th>
                  <th className="px-3 py-3 font-semibold">Vendeur(s)</th>
                  <th className="px-3 py-3 font-semibold text-right">HT</th>
                  <th className="px-3 py-3 font-semibold text-right">TVA</th>
                  <th className="px-3 py-3 font-semibold text-right">TTC</th>
                  <th className="px-3 py-3 font-semibold text-right">Commission</th>
                  <th className="px-3 py-3 font-semibold text-right">Net vendeurs</th>
                  <th className="px-3 py-3 font-semibold">Moyen / Mode</th>
                  <th className="px-3 py-3 font-semibold">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--sim-border-hairline)]">
                {!txData || txData.transactions.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-8 text-center text-sm text-[var(--sim-text-secondary)]">
                      Aucune transaction ne correspond aux filtres.
                    </td>
                  </tr>
                ) : (
                  txData.transactions.map((t) => (
                    <tr
                      key={t.orderId}
                      onClick={() => onOpenOrder(t.orderId)}
                      className="cursor-pointer hover:bg-[var(--sim-bg-subtle)] transition-colors"
                      title="Ouvrir la fiche commande 360°"
                    >
                      <td className="px-3 py-2.5 font-mono text-[11px] text-[var(--sim-text-muted)] whitespace-nowrap">
                        {new Date(t.createdAt).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="px-3 py-2.5">
                        <p className="font-mono font-semibold text-[var(--sim-text-primary)]">{t.orderNumber}</p>
                        <p className="text-[11px] text-[var(--sim-text-muted)]">{t.buyerEmail}</p>
                      </td>
                      <td className="px-3 py-2.5 text-[var(--sim-text-secondary)]">{t.vendorNames.join(', ') || '—'}</td>
                      <td className="px-3 py-2.5 text-right font-mono-nums">{formatCurrency(t.totalHT, currency)}</td>
                      <td className="px-3 py-2.5 text-right font-mono-nums text-[var(--sim-text-muted)]">{t.vatAmount > 0 ? formatCurrency(t.vatAmount, currency) : '—'}</td>
                      <td className="px-3 py-2.5 text-right font-mono-nums font-bold">{formatCurrency(t.grandTotal, currency)}</td>
                      <td className="px-3 py-2.5 text-right font-mono-nums font-bold text-[var(--sim-accent-600)]">
                        {t.commission > 0 ? formatCurrency(t.commission, currency) : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono-nums">{formatCurrency(t.netVendors, currency)}</td>
                      <td className="px-3 py-2.5 text-[11px] text-[var(--sim-text-secondary)]">
                        <p>{t.paymentMethod}</p>
                        <p className="text-[var(--sim-text-muted)]">
                          {t.paymentMode === 'deposit' ? 'Acompte' : t.paymentMode === 'quote' ? 'Devis' : t.paymentMode === 'bank_transfer' ? 'Virement' : 'Intégral'}
                          {t.balanceDue > 0 && t.paymentStatus === 'paid' ? ` · reste ${formatCurrency(t.balanceDue, currency)}` : ''}
                        </p>
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                            t.paymentStatus === 'paid'
                              ? 'bg-[var(--sim-success-bg)] text-[var(--sim-success-text)]'
                              : t.paymentStatus === 'refunded'
                              ? 'bg-[var(--sim-error-bg)] text-[var(--sim-error-text)]'
                              : t.paymentStatus === 'expired'
                              ? 'bg-[var(--sim-bg-muted)] text-[var(--sim-text-muted)]'
                              : 'bg-[var(--sim-warning-bg)] text-[var(--sim-warning-text)]'
                          }`}
                        >
                          {PAYMENT_STATUS_LABELS[t.paymentStatus] || t.paymentStatus}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-[var(--sim-text-muted)] flex items-center gap-1.5">
            <Filter className="w-3 h-3" /> Cliquez sur une ligne pour ouvrir la fiche commande 360° (timeline, spécificités, ventilation complète).
          </p>
        </div>
      )}

      {/* ============ REVERSEMENTS ============ */}
      {subTab === 'payouts' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-[var(--sim-radius-md)] border border-[var(--sim-border-strong)] bg-[var(--sim-bg-surface)] p-1">
              {PERIODS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPayoutPeriod(p.id)}
                  className={`rounded-[var(--sim-radius-sm)] px-3 py-1 text-xs font-bold uppercase ${payoutPeriod === p.id ? 'bg-[var(--sim-steel-950)] text-white' : 'text-[var(--sim-text-secondary)]'}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {payoutData && (
              <div className="flex flex-wrap gap-3 text-xs">
                <span className="rounded bg-[var(--sim-bg-subtle)] border border-[var(--sim-border-hairline)] px-3 py-1.5 font-mono-nums">
                  Volume vendeurs : <strong>{formatCurrency(payoutData.totals.totalRevenue, currency)}</strong>
                </span>
                <span className="rounded bg-[var(--sim-accent-50)] border border-[var(--sim-accent-ring)] px-3 py-1.5 font-mono-nums">
                  Commission : <strong>{formatCurrency(payoutData.totals.totalCommission, currency)}</strong>
                </span>
                <span className="rounded bg-[var(--sim-bg-subtle)] border border-[var(--sim-border-hairline)] px-3 py-1.5 font-mono-nums">
                  Déjà reversé : <strong>{formatCurrency(payoutData.totals.totalPaidOut, currency)}</strong>
                </span>
                <span className="rounded bg-[var(--sim-warning-bg)] border border-amber-300 px-3 py-1.5 font-mono-nums text-[var(--sim-warning-text)]">
                  Restant à payer : <strong>{formatCurrency(payoutData.totals.netToPay, currency)}</strong>
                </span>
              </div>
            )}
          </div>

          {payoutForm && (
            <form onSubmit={submitPayout} className="rounded-[var(--sim-radius-lg)] border border-[var(--sim-accent-ring)] bg-[var(--sim-bg-surface)] p-4 space-y-3">
              <p className="font-display text-sm font-bold text-[var(--sim-text-primary)] flex items-center gap-2">
                <Banknote className="w-4 h-4 text-[var(--sim-accent-600)]" />
                Enregistrer un reversement — {payoutForm.statement.shopName || payoutForm.statement.vendorName}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label className="sim-label">Montant ({currency})</label>
                  <input type="number" min={1} value={payoutForm.amount} onChange={(e) => setPayoutForm((f) => (f ? { ...f, amount: e.target.value } : f))} className="sim-input font-mono-nums" required />
                </div>
                <div>
                  <label className="sim-label">Méthode</label>
                  <select value={payoutForm.method} onChange={(e) => setPayoutForm((f) => (f ? { ...f, method: e.target.value } : f))} className="sim-input">
                    <option value="bank_transfer">Virement bancaire</option>
                    <option value="mobile_money">Mobile money</option>
                    <option value="cash">Espèces</option>
                    <option value="other">Autre</option>
                  </select>
                </div>
                <div>
                  <label className="sim-label">Référence</label>
                  <input type="text" value={payoutForm.reference} onChange={(e) => setPayoutForm((f) => (f ? { ...f, reference: e.target.value } : f))} placeholder="N° virement…" className="sim-input font-mono text-xs" />
                </div>
                <div>
                  <label className="sim-label">Note</label>
                  <input type="text" value={payoutForm.note} onChange={(e) => setPayoutForm((f) => (f ? { ...f, note: e.target.value } : f))} placeholder="Période couverte…" className="sim-input" />
                </div>
              </div>
              <p className="text-[11px] text-[var(--sim-text-muted)]">
                Net cumulé à reverser : <strong className="font-mono-nums">{formatCurrency(payoutForm.statement.net, currency)}</strong> · Déjà reversé :{' '}
                <strong className="font-mono-nums">{formatCurrency(payoutForm.statement.alreadyPaid, currency)}</strong> · Reste :{' '}
                <strong className="font-mono-nums">{formatCurrency(payoutForm.statement.outstanding, currency)}</strong>
              </p>
              <div className="flex gap-2.5">
                <button type="submit" disabled={savingPayout} className="sim-btn-primary py-2 px-5 text-xs">
                  {savingPayout ? 'Enregistrement…' : 'Valider le reversement'}
                </button>
                <button type="button" onClick={() => setPayoutForm(null)} className="sim-btn-secondary py-2 px-4 text-xs">
                  Annuler
                </button>
              </div>
            </form>
          )}

          <div className="rounded-[var(--sim-radius-lg)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[var(--sim-bg-subtle)] text-[var(--sim-text-muted)]">
                <tr>
                  <th className="px-3 py-3 font-semibold">Vendeur / Boutique</th>
                  <th className="px-3 py-3 font-semibold text-right">CA (période)</th>
                  <th className="px-3 py-3 font-semibold text-right">Commission (période)</th>
                  <th className="px-3 py-3 font-semibold text-right">Net (période)</th>
                  <th className="px-3 py-3 font-semibold text-right">Net cumulé</th>
                  <th className="px-3 py-3 font-semibold text-right">Déjà reversé</th>
                  <th className="px-3 py-3 font-semibold text-right">Reste à payer</th>
                  <th className="px-3 py-3 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--sim-border-hairline)]">
                {!payoutData || payoutData.statements.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-sm text-[var(--sim-text-secondary)]">
                      Aucune vente encaissée pour l'instant — les relevés apparaîtront dès la première commande payée.
                    </td>
                  </tr>
                ) : (
                  payoutData.statements.map((s) => (
                    <tr key={s.vendorId} className={s.outstanding > 0 ? '' : 'opacity-60'}>
                      <td className="px-3 py-2.5">
                        <p className="font-semibold text-[var(--sim-text-primary)]">{s.shopName || s.vendorName}</p>
                        <p className="text-[11px] text-[var(--sim-text-muted)]">{s.vendorName} · {s.ordersCount} commande(s) encaissée(s)</p>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono-nums">{formatCurrency(s.revenuePeriod, currency)}</td>
                      <td className="px-3 py-2.5 text-right font-mono-nums text-[var(--sim-accent-600)]">-{formatCurrency(s.commissionPeriod, currency)}</td>
                      <td className="px-3 py-2.5 text-right font-mono-nums">{formatCurrency(s.netPeriod, currency)}</td>
                      <td className="px-3 py-2.5 text-right font-mono-nums font-semibold">{formatCurrency(s.net, currency)}</td>
                      <td className="px-3 py-2.5 text-right font-mono-nums text-[var(--sim-text-secondary)]">{formatCurrency(s.alreadyPaid, currency)}</td>
                      <td className={`px-3 py-2.5 text-right font-mono-nums font-bold ${s.outstanding > 0 ? 'text-[var(--sim-warning-text)]' : 'text-[var(--sim-success-text)]'}`}>
                        {formatCurrency(s.outstanding, currency)}
                      </td>
                      <td className="px-3 py-2.5">
                        <button
                          type="button"
                          onClick={() =>
                            setPayoutForm({
                              statement: s,
                              amount: String(Math.max(0, s.outstanding)),
                              method: 'bank_transfer',
                              reference: '',
                              note: payoutPeriod === 'all' ? 'Cumul à ce jour' : `Période ${payoutPeriod}`,
                            })
                          }
                          className="inline-flex items-center gap-1 rounded bg-[var(--sim-steel-950)] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[var(--sim-steel-800)]"
                        >
                          <Landmark className="w-3 h-3" />
                          <span>Reverser</span>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {payoutData && payoutData.payouts.length > 0 && (
            <div className="rounded-[var(--sim-radius-lg)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-4 space-y-2">
              <p className="font-display text-sm font-bold text-[var(--sim-text-primary)]">Historique des reversements ({payoutData.payouts.length})</p>
              <div className="max-h-64 overflow-auto divide-y divide-[var(--sim-border-hairline)] text-xs">
                {payoutData.payouts.map((p) => (
                  <div key={p.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold text-[var(--sim-text-primary)]">
                        {p.shop_name || p.vendor_name} — <span className="font-mono-nums">{formatCurrency(Number(p.amount), currency)}</span>
                      </p>
                      <p className="text-[11px] text-[var(--sim-text-muted)]">
                        {p.method}{p.reference ? ` · réf. ${p.reference}` : ''}{p.note ? ` · ${p.note}` : ''}
                      </p>
                    </div>
                    <span className="text-[11px] text-[var(--sim-text-muted)]">
                      {new Date(p.created_at).toLocaleString('fr-FR')} · par {p.created_by}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

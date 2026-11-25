import React, { useCallback, useEffect, useState } from 'react';
import { ArrowDownToLine, RefreshCw, Search } from 'lucide-react';
import { api } from '../../lib/api';
import { formatCurrency } from '../../shared/rulesEngine';
import type { AdminBuyersResponse } from '../../shared/adminTypes';

interface BuyersViewProps {
  currency: string;
  onExportCsv: (type: 'orders' | 'vendors' | 'transactions' | 'accounting' | 'buyers' | 'audit') => void;
  onToast: (type: 'success' | 'error' | 'info', title: string, description?: string) => void;
}

export const BuyersView: React.FC<BuyersViewProps> = ({ currency, onExportCsv, onToast }) => {
  const [q, setQ] = useState('');
  const [minOrders, setMinOrders] = useState('');
  const [data, setData] = useState<AdminBuyersResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(
        await api.adminBuyers({
          q: q.trim() || undefined,
          minOrders: minOrders.trim() ? Number(minOrders) : undefined,
        })
      );
    } catch (err) {
      onToast('error', 'Erreur annuaire acheteurs', err instanceof Error ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  }, [q, minOrders, onToast]);

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3">
        <div className="w-full sm:flex-1 sm:min-w-64">
          <label className="sim-label">Rechercher un acheteur (email ou nom)</label>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--sim-text-muted)]" />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="client@entreprise.ci…"
              className="sim-input pl-9"
            />
          </div>
        </div>
        <div>
          <label className="sim-label">Commandes min.</label>
          <input type="number" min={1} value={minOrders} onChange={(e) => setMinOrders(e.target.value)} placeholder="1" className="sim-input font-mono-nums w-32" />
        </div>
        <button type="button" onClick={load} className="sim-btn-secondary py-2 px-3">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
        <button type="button" onClick={() => onExportCsv('buyers')} className="sim-btn-secondary py-2 px-3">
          <ArrowDownToLine className="w-3.5 h-3.5" />
          <span>Export CSV</span>
        </button>
      </div>

      {data && (
        <div className="flex flex-wrap gap-3 text-xs">
          <span className="rounded bg-[var(--sim-bg-subtle)] border border-[var(--sim-border-hairline)] px-3 py-1.5">
            <strong className="font-mono-nums">{data.totals.count}</strong> acheteur(s)
          </span>
          <span className="rounded bg-[var(--sim-bg-subtle)] border border-[var(--sim-border-hairline)] px-3 py-1.5">
            Dépense cumulée : <strong className="font-mono-nums">{formatCurrency(data.totals.totalSpent, currency)}</strong>
          </span>
          <span className="rounded bg-[var(--sim-success-bg)] px-3 py-1.5 text-[var(--sim-success-text)]">
            <strong className="font-mono-nums">{data.totals.repeatBuyers}</strong> acheteur(s) récurrent(s) (2+ commandes)
          </span>
        </div>
      )}

      <div className="sim-table-wrap rounded-[var(--sim-radius-lg)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)]">
        <table className="w-full text-left text-xs">
          <thead className="bg-[var(--sim-bg-subtle)] text-[var(--sim-text-muted)]">
            <tr>
              <th className="px-3 py-3 font-semibold">Acheteur (sans compte)</th>
              <th className="px-3 py-3 font-semibold">Zone principale</th>
              <th className="px-3 py-3 font-semibold text-right">Commandes</th>
              <th className="px-3 py-3 font-semibold text-right">Payées</th>
              <th className="px-3 py-3 font-semibold text-right">Dépensé (TTC)</th>
              <th className="px-3 py-3 font-semibold text-right">Panier moyen</th>
              <th className="px-3 py-3 font-semibold">Dernière commande</th>
              <th className="px-3 py-3 font-semibold text-right">Devis / Remb.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--sim-border-hairline)]">
            {!data || data.buyers.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-sm text-[var(--sim-text-secondary)]">
                  Aucun acheteur ne correspond à la recherche.
                </td>
              </tr>
            ) : (
              data.buyers.map((b) => (
                <tr key={b.email}>
                  <td className="px-3 py-2.5">
                    <p className="font-semibold text-[var(--sim-text-primary)]">{b.name}</p>
                    <p className="text-[11px] text-[var(--sim-text-muted)]">{b.email}</p>
                  </td>
                  <td className="px-3 py-2.5 text-[var(--sim-text-secondary)]">{b.zone}</td>
                  <td className="px-3 py-2.5 text-right font-mono-nums font-semibold">{b.orders}</td>
                  <td className="px-3 py-2.5 text-right font-mono-nums">{b.paidOrders}</td>
                  <td className="px-3 py-2.5 text-right font-mono-nums font-bold">{formatCurrency(b.spent, currency)}</td>
                  <td className="px-3 py-2.5 text-right font-mono-nums">{formatCurrency(b.avgBasket, currency)}</td>
                  <td className="px-3 py-2.5 text-[11px] text-[var(--sim-text-muted)]">
                    {new Date(b.lastAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono-nums text-[11px] text-[var(--sim-text-secondary)]">
                    {b.customOrders > 0 ? `${b.customOrders} devis` : '—'}
                    {b.refunded > 0 ? ` · ${b.refunded} remb.` : ''}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

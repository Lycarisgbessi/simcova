import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Star, Timer, TrendingUp, Users, Wallet } from 'lucide-react';
import { api } from '../../lib/api';
import { formatCurrency } from '../../shared/rulesEngine';
import type { AdminAnalyticsResponse } from '../../shared/adminTypes';

interface AnalyticsViewProps {
  currency: string;
  onToast: (type: 'success' | 'error' | 'info', title: string, description?: string) => void;
}

const PERIODS: Array<{ id: '7d' | '30d' | '90d' | 'all'; label: string }> = [
  { id: '7d', label: '7 jours' },
  { id: '30d', label: '30 jours' },
  { id: '90d', label: '90 jours' },
  { id: 'all', label: 'Tout' },
];

function Kpi({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className={`rounded-[var(--sim-radius-lg)] border p-4 ${highlight ? 'bg-[var(--sim-accent-50)] border-[var(--sim-accent-ring)]' : 'bg-[var(--sim-bg-surface)] border-[var(--sim-border-hairline)]'}`}>
      <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--sim-text-muted)]">{label}</p>
      <p className={`mt-1.5 font-mono-nums text-xl font-bold ${highlight ? 'text-[var(--sim-accent-700)]' : 'text-[var(--sim-text-primary)]'}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-[var(--sim-text-muted)]">{sub}</p>}
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[var(--sim-radius-lg)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-4 space-y-3">
      <p className="font-display text-sm font-bold uppercase tracking-wide text-[var(--sim-text-primary)]">{title}</p>
      {children}
    </div>
  );
}

function BarRow({ label, value, max, valueLabel }: { label: string; value: number; max: number; valueLabel: string }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-[var(--sim-text-secondary)] truncate pr-2">{label}</span>
        <span className="font-mono-nums font-semibold text-[var(--sim-text-primary)] shrink-0">{valueLabel}</span>
      </div>
      <div className="h-2 rounded bg-[var(--sim-bg-muted)] overflow-hidden">
        <div className="h-full rounded bg-[var(--sim-accent-500)]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({ currency, onToast }) => {
  const [period, setPeriod] = useState<'7d' | '30d' | '90d' | 'all'>('30d');
  const [data, setData] = useState<AdminAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.adminAnalytics(period));
    } catch (err) {
      onToast('error', 'Erreur statistiques', err instanceof Error ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  }, [period, onToast]);

  useEffect(() => {
    load();
  }, [load]);

  const maxSeries = data ? Math.max(1, ...data.dailySeries.map((s) => s.grand)) : 1;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="sim-tabs-bar rounded-[var(--sim-radius-md)] border border-[var(--sim-border-strong)] bg-[var(--sim-bg-surface)] p-1">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPeriod(p.id)}
              className={`rounded-[var(--sim-radius-sm)] px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide ${period === p.id ? 'bg-[var(--sim-steel-950)] text-white' : 'text-[var(--sim-text-secondary)] hover:text-[var(--sim-text-primary)]'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <button type="button" onClick={load} className="sim-btn-secondary py-1.5 px-3">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Actualiser</span>
        </button>
      </div>

      {data && (
        <>
          {/* KPIs principaux */}
          <div className="grid grid-cols-1 min-[400px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5 sm:gap-3">
            <Kpi label="Encaissé TTC" value={formatCurrency(data.kpis.totalGrandPaid, currency)} sub={`${data.kpis.paidCount} commande(s) payée(s)`} />
            <Kpi label="Panier moyen" value={formatCurrency(data.kpis.avgBasket, currency)} sub="commandes payées" />
            <Kpi label="Commission plateforme" value={formatCurrency(data.kpis.commissionEarned, currency)} sub={`TVA collectée ${formatCurrency(data.kpis.vatCollected, currency)}`} highlight />
            <Kpi label="Acheteurs uniques" value={String(data.kpis.uniqueBuyers)} sub={`${data.kpis.repeatBuyers} récurrent(s) · ${data.kpis.repeatRatePct} %`} />
            <Kpi label="Soldes acomptes en attente" value={formatCurrency(data.kpis.pendingBalanceTotal, currency)} sub="à encaisser à la livraison" />
            <Kpi label="Remboursements / Expirations" value={`${data.kpis.refundRatePct} % / ${data.kpis.expirationRatePct} %`} sub={`${data.kpis.refundedCount} remboursée(s) · ${data.kpis.expiredCount} expirée(s)`} />
          </div>

          {/* Délais */}
          <SectionCard title="Délais moyens du cycle de commande">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="flex items-center gap-2.5 rounded border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-subtle)] p-3">
                <Timer className="w-4 h-4 text-[var(--sim-accent-500)] shrink-0" />
                <div>
                  <p className="text-[var(--sim-text-muted)]">Commande → Paiement</p>
                  <p className="font-mono-nums font-bold text-[var(--sim-text-primary)]">{data.delays.avgHoursToPayment} h</p>
                </div>
              </div>
              <div className="flex items-center gap-2.5 rounded border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-subtle)] p-3">
                <TrendingUp className="w-4 h-4 text-[var(--sim-accent-500)] shrink-0" />
                <div>
                  <p className="text-[var(--sim-text-muted)]">Paiement → Expédition</p>
                  <p className="font-mono-nums font-bold text-[var(--sim-text-primary)]">{data.delays.avgHoursToShipment} h</p>
                </div>
              </div>
              <div className="flex items-center gap-2.5 rounded border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-subtle)] p-3">
                <Wallet className="w-4 h-4 text-[var(--sim-accent-500)] shrink-0" />
                <div>
                  <p className="text-[var(--sim-text-muted)]">Expédition → Livraison</p>
                  <p className="font-mono-nums font-bold text-[var(--sim-text-primary)]">{data.delays.avgHoursToDelivery} h</p>
                </div>
              </div>
            </div>
          </SectionCard>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
            <SectionCard title="Top produits (CA encaissé)">
              {data.topProducts.length === 0 ? (
                <p className="text-xs text-[var(--sim-text-muted)]">Pas encore de ventes sur la période.</p>
              ) : (
                data.topProducts.map((p) => (
                  <BarRow key={p.id} label={`${p.title} — ${p.shopName || p.shopName || ''} (x${p.qty})`} value={p.revenue} max={data.topProducts[0].revenue} valueLabel={formatCurrency(p.revenue, currency)} />
                ))
              )}
            </SectionCard>

            <SectionCard title="Top vendeurs (CA encaissé)">
              {data.topVendors.length === 0 ? (
                <p className="text-xs text-[var(--sim-text-muted)]">Pas encore de ventes sur la période.</p>
              ) : (
                data.topVendors.map((v) => (
                  <BarRow key={v.vendorId} label={`${v.shopName || v.name}`} value={v.revenue} max={data.topVendors[0].revenue} valueLabel={formatCurrency(v.revenue, currency)} />
                ))
              )}
            </SectionCard>

            <SectionCard title="Commission par moyen de paiement">
              {data.commissionByMethod.length === 0 ? (
                <p className="text-xs text-[var(--sim-text-muted)]">Pas encore de commission sur la période.</p>
              ) : (
                data.commissionByMethod.map((m) => (
                  <BarRow key={m.method} label={`${m.method} (${m.orders} cmd)`} value={m.commission} max={data.commissionByMethod[0].commission} valueLabel={formatCurrency(m.commission, currency)} />
                ))
              )}
            </SectionCard>

            <SectionCard title="Rayons par chiffre d'affaires">
              {data.topCategories.length === 0 ? (
                <p className="text-xs text-[var(--sim-text-muted)]">Pas encore de ventes sur la période.</p>
              ) : (
                data.topCategories.map((c) => (
                  <BarRow key={c.name} label={`${c.name} (x${c.qty})`} value={c.revenue} max={data.topCategories[0].revenue} valueLabel={formatCurrency(c.revenue, currency)} />
                ))
              )}
            </SectionCard>

            <SectionCard title="Répartition par zone de livraison">
              {data.zoneDistribution.length === 0 ? (
                <p className="text-xs text-[var(--sim-text-muted)]">Pas encore de livraison.</p>
              ) : (
                data.zoneDistribution.map((z) => (
                  <BarRow key={z.zone} label={z.zone} value={z.orders} max={data.zoneDistribution[0].orders} valueLabel={`${z.orders} cmd · ${formatCurrency(z.grand, currency)}`} />
                ))
              )}
            </SectionCard>

            <SectionCard title="Distribution des notes (avis vérifiés)">
              {data.ratingDistribution.length === 0 ? (
                <p className="text-xs text-[var(--sim-text-muted)]">Pas encore d'avis.</p>
              ) : (
                data.ratingDistribution.map((r) => (
                  <BarRow
                    key={r.rating}
                    label={`${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}`}
                    value={r.count}
                    max={data.ratingDistribution[0].count}
                    valueLabel={`${r.count} avis`}
                  />
                ))
              )}
            </SectionCard>
          </div>

          {/* Série journalière */}
          <SectionCard title="Évolution journalière (TTC encaissé & commission)">
            {data.dailySeries.length === 0 ? (
              <p className="text-xs text-[var(--sim-text-muted)]">Aucune commande sur la période.</p>
            ) : (
              <div className="flex items-end gap-1.5 h-40">
                {data.dailySeries.map((s) => (
                  <div key={s.date} className="flex-1 flex flex-col items-center gap-1 group relative" title={`${s.date} · ${s.orders} cmd · ${formatCurrency(s.grand, currency)} · commission ${formatCurrency(s.commission, currency)}`}>
                    <div
                      className="w-full rounded-t bg-[var(--sim-steel-800)] group-hover:bg-[var(--sim-accent-500)] transition-colors"
                      style={{ height: `${Math.max(4, Math.round((s.grand / maxSeries) * 120))}px` }}
                    />
                    <span className="text-[9px] font-mono text-[var(--sim-text-muted)]">{s.date.slice(8, 10)}/{s.date.slice(5, 7)}</span>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <div className="flex items-center gap-2 text-[11px] text-[var(--sim-text-muted)]">
            <Users className="w-3.5 h-3.5" />
            {data.kpis.ordersCount} commande(s) sur la période dont {data.kpis.paidCount} encaissée(s) · {data.kpis.uniqueBuyers} acheteur(s) unique(s) ·{' '}
            <Star className="w-3.5 h-3.5" />
            {data.ratingDistribution.reduce((s, r) => s + r.count, 0)} avis cumulés
          </div>
        </>
      )}
    </div>
  );
};

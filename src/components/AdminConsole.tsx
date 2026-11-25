import React, { useCallback, useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Users,
  Sliders,
  Tags,
  ShieldAlert,
  BellRing,
  Receipt,
  Settings,
  Download,
  Eye,
  Trash2,
  CheckCircle2,
  Award,
  Ban,
  XCircle,
  Send,
  Lock,
  FileText,
  RefreshCw,
  Banknote,
  TrendingUp,
  Contact,
  Percent,
  Database,
} from 'lucide-react';
import { api, getAuthToken } from '../lib/api';
import { formatCurrency } from '../shared/rulesEngine';
import { PAYMENT_METHOD_CATALOG } from '../shared/constants';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { FinanceView } from './admin/FinanceView';
import { AnalyticsView } from './admin/AnalyticsView';
import { BuyersView } from './admin/BuyersView';
import { OrderDetailModal } from './admin/OrderDetailModal';
import { ProductsAdminView } from './admin/ProductsAdminView';
import { VendorDetailModal } from './admin/VendorDetailModal';
import { SystemView } from './admin/SystemView';
import { PromoView } from './admin/PromoView';
import type {
  AuditLogItem,
  Category,
  DeliveryZoneFee,
  OutboxEmail,
  PaymentMethodId,
  PlatformRule,
  PlatformSettings,
  PushAlertItem,
  ReviewItem,
  RuleId,
  UserAccount,
  VendorStatus,
} from '../shared/types';

interface AdminConsoleProps {
  categories: Category[];
  rules: Record<RuleId, PlatformRule>;
  settings: PlatformSettings;
  onRefreshBootstrap: () => void;
  onToast: (type: 'success' | 'error' | 'info', title: string, description?: string) => void;
}

type AdminTab =
  | 'overview'
  | 'finance'
  | 'analytics'
  | 'buyers'
  | 'products'
  | 'promos'
  | 'system'
  | 'vendors'
  | 'rules'
  | 'categories'
  | 'moderation'
  | 'push'
  | 'orders'
  | 'settings';

type VendorRow = UserAccount & {
  shopId: string | null;
  shopName: string | null;
  shopSlug: string | null;
  shopCity: string | null;
  publishedCount: number;
  kycDocs: Array<{
    id: string;
    vendorId: string;
    docType: string;
    fileName: string;
    mimeType: string;
    reviewStatus: 'en_attente' | 'approuve' | 'rejete';
    rejectionReason: string | null;
    uploadedAt: string;
    reviewedAt: string | null;
    purgeScheduledAt: string | null;
  }>;
};

const RG04_ALL_FIELDS: Array<{ id: string; label: string }> = [
  { id: 'fullName', label: 'Nom complet' },
  { id: 'email', label: 'Courriel' },
  { id: 'password', label: 'Mot de passe' },
  { id: 'shopName', label: 'Nom de boutique' },
  { id: 'phone', label: 'Téléphone' },
  { id: 'city', label: 'Ville' },
  { id: 'shopDescription', label: 'Présentation activité' },
];

const PAYMENT_METHOD_OPTIONS: Array<{ id: PaymentMethodId; label: string }> = PAYMENT_METHOD_CATALOG.map(
  (m) => ({ id: m.id, label: m.label })
);

export const AdminConsole: React.FC<AdminConsoleProps> = ({
  categories,
  rules,
  settings,
  onRefreshBootstrap,
  onToast,
}) => {
  const [tab, setTab] = useState<AdminTab>('overview');
  const [loading, setLoading] = useState(false);

  // Overview
  const [period, setPeriod] = useState<'7d' | '30d' | '90d' | 'all'>('30d');
  const [kpis, setKpis] = useState<{
    totalSales: number;
    vatCollected: number;
    commissionEarned: number;
    totalOrders: number;
    statusCounts: Record<string, number>;
    publishedProducts: number;
    activeVendors: number;
    pendingVendors: number;
    pendingModeration: number;
    evolution?: Array<{ label: string; sales: number; orders: number }>;
  } | null>(null);
  const [confirmPurgeId, setConfirmPurgeId] = useState<string | null>(null);
  const [confirmRefundOrderId, setConfirmRefundOrderId] = useState<string | null>(null);

  // Vendors & Restricted KYC Viewer
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});
  const [kycPreview, setKycPreview] = useState<{
    id: string;
    docType: string;
    fileName: string;
    mimeType: string;
    textPreview: string | null;
    dataUrl: string | null;
  } | null>(null);

  // Rules local draft state
  const [ruleDrafts, setRuleDrafts] = useState<Record<string, PlatformRule>>({});

  // Categories
  const [newCatName, setNewCatName] = useState('');
  const [newCatBadge, setNewCatBadge] = useState('');
  const [catBadgeDrafts, setCatBadgeDrafts] = useState<Record<string, string>>({});

  // Moderation
  const [modReviews, setModReviews] = useState<ReviewItem[]>([]);
  const [modThreads, setModThreads] = useState<
    Array<{
      threadId: string;
      buyerName: string;
      buyerEmail: string;
      shopName: string;
      lastMessage: string;
      reported: boolean;
      reportCount: number;
      hiddenByModeration: boolean;
      isBlocked: boolean;
      createdAt: string;
    }>
  >([]);

  // Push alerts
  const [pushAlerts, setPushAlerts] = useState<PushAlertItem[]>([]);
  const [pushStats, setPushStats] = useState({ subscriberCount: 0, liveConnections: 0 });
  const [pushTitle, setPushTitle] = useState('');
  const [pushBody, setPushBody] = useState('');
  const [pushDeepLink, setPushDeepLink] = useState('/');
  const [pushType, setPushType] = useState<'nouveautes' | 'promotions' | 'annonces'>('nouveautes');

  // Orders
  const [orders, setOrders] = useState<Array<Record<string, unknown>>>([]);
  const [ordersSearch, setOrdersSearch] = useState('');
  const [detailOrderId, setDetailOrderId] = useState<string | null>(null);
  const [detailVendorId, setDetailVendorId] = useState<string | null>(null);

  // Settings & Audit
  const [settingsForm, setSettingsForm] = useState<PlatformSettings>(settings);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [outboxEmails, setOutboxEmails] = useState<Array<OutboxEmail & { sentAt: string | null; attempts: number; lastError: string | null }>>([]);

  useEffect(() => {
    setRuleDrafts(rules);
  }, [rules]);

  useEffect(() => {
    setSettingsForm(settings);
  }, [settings]);

  const loadTab = useCallback(
    async (targetTab: AdminTab, targetPeriod: '7d' | '30d' | '90d' | 'all' = period) => {
      setLoading(true);
      try {
        if (targetTab === 'overview') {
          const res = await api.adminOverview(targetPeriod);
          setKpis(res.kpis);
        } else if (targetTab === 'vendors') {
          const res = await api.adminVendors();
          setVendors(res.vendors);
        } else if (targetTab === 'moderation') {
          const res = await api.adminModeration();
          setModReviews(res.reviews);
          setModThreads(res.threads);
        } else if (targetTab === 'push') {
          const res = await api.adminGetPushAlerts();
          setPushAlerts(res.alerts);
          setPushStats({ subscriberCount: res.subscriberCount, liveConnections: res.liveConnections });
        } else if (targetTab === 'orders') {
          const res = await api.adminOrders();
          setOrders(res.orders);
        } else if (targetTab === 'settings') {
          const res = await api.adminAuditLogs();
          setAuditLogs(res.logs);
          setOutboxEmails(res.emails);
        }
      } catch (err) {
        onToast('error', 'Erreur de chargement', err instanceof Error ? err.message : undefined);
      } finally {
        setLoading(false);
      }
    },
    [onToast, period]
  );

  useEffect(() => {
    loadTab(tab, period);
  }, [tab, period, loadTab]);

  useEscapeKey(() => setKycPreview(null), Boolean(kycPreview));

  const handleVendorDecision = async (vendorId: string, status: VendorStatus) => {
    const reason = rejectReasons[vendorId];
    if (status === 'rejete' && !reason?.trim()) {
      onToast('error', 'Motif requis', 'Saisissez un motif clair avant de rejeter une candidature.');
      return;
    }
    try {
      await api.adminVendorDecision(vendorId, status, reason);
      onToast('success', 'Statut vendeur mis à jour', `Décision enregistrée (${status}).`);
      loadTab('vendors');
      onRefreshBootstrap();
    } catch (err) {
      onToast('error', 'Erreur', err instanceof Error ? err.message : undefined);
    }
  };

  const handleViewKyc = async (docId: string) => {
    try {
      const data = await api.adminViewKyc(docId);
      setKycPreview(data);
    } catch (err) {
      onToast('error', 'Accès KYC impossible', err instanceof Error ? err.message : undefined);
    }
  };

  const handlePurgeKyc = async (docId: string) => {
    try {
      await api.adminPurgeKyc(docId);
      setKycPreview(null);
      setConfirmPurgeId(null);
      onToast('success', 'Pièce purgée', 'Le document chiffré a été supprimé définitivement.');
      loadTab('vendors');
    } catch (err) {
      onToast('error', 'Erreur purge', err instanceof Error ? err.message : undefined);
    }
  };

  const handleSaveRule = async (ruleId: RuleId) => {
    const draft = ruleDrafts[ruleId];
    if (!draft) return;
    try {
      await api.adminUpdateRule(ruleId, draft.enabled, draft.valueJson);
      onToast('success', `Règle ${ruleId} mise à jour`, 'Les vendeurs concernés ont été notifiés.');
      onRefreshBootstrap();
    } catch (err) {
      onToast('error', 'Erreur règle', err instanceof Error ? err.message : undefined);
    }
  };

  const updateDraftRule = (ruleId: RuleId, patch: Partial<PlatformRule>) => {
    setRuleDrafts((prev) => ({
      ...prev,
      [ruleId]: { ...prev[ruleId], ...patch },
    }));
  };

  const updateDraftRuleValue = (ruleId: RuleId, key: string, val: unknown) => {
    setRuleDrafts((prev) => ({
      ...prev,
      [ruleId]: {
        ...prev[ruleId],
        valueJson: { ...(prev[ruleId]?.valueJson || {}), [key]: val },
      },
    }));
  };

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatName.trim()) return;
    try {
      await api.adminCreateCategory(newCatName.trim(), newCatBadge.trim() || null);
      setNewCatName('');
      setNewCatBadge('');
      onToast('success', 'Catégorie créée');
      onRefreshBootstrap();
    } catch (err) {
      onToast('error', 'Erreur', err instanceof Error ? err.message : undefined);
    }
  };

  const handleToggleCategory = async (cat: Category, field: 'active' | 'forbidden') => {
    try {
      await api.adminUpdateCategory(cat.id, { [field]: !cat[field] });
      onToast('success', 'Catégorie mise à jour');
      onRefreshBootstrap();
    } catch (err) {
      onToast('error', 'Erreur', err instanceof Error ? err.message : undefined);
    }
  };

  const handleSaveCategoryBadge = async (cat: Category) => {
    const nextBadge = (catBadgeDrafts[cat.id] ?? cat.requiredBadge ?? '').trim() || null;
    try {
      await api.adminUpdateCategory(cat.id, { requiredBadge: nextBadge });
      onToast('success', 'Badge catégorie mis à jour (RG-02)');
      onRefreshBootstrap();
    } catch (err) {
      onToast('error', 'Erreur', err instanceof Error ? err.message : undefined);
    }
  };

  const handleSendPush = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.adminSendPushAlert({
        title: pushTitle,
        body: pushBody,
        deepLink: pushDeepLink || '/',
        alertType: pushType,
      });
      setPushTitle('');
      setPushBody('');
      setPushDeepLink('/');
      onToast(
        'success',
        'Alerte push diffusée',
        `Envoyée à ${res.alert.sentCount} appareil(s) et canaux temps réel.`
      );
      loadTab('push');
    } catch (err) {
      onToast('error', 'Erreur diffusion', err instanceof Error ? err.message : undefined);
    }
  };

  const handleRefund = async (orderId: string) => {
    try {
      await api.adminRefundOrder(orderId, 'Remboursement validé par l’administration SIMCOVA');
      setConfirmRefundOrderId(null);
      onToast('success', 'Remboursement effectué via Jumia Africa');
      loadTab('orders');
    } catch (err) {
      onToast('error', 'Erreur remboursement', err instanceof Error ? err.message : undefined);
    }
  };

  const handleExportCsv = async (type: 'orders' | 'vendors' | 'transactions' | 'accounting' | 'buyers' | 'audit', from?: string, to?: string) => {
    try {
      const token = getAuthToken();
      const qs = new URLSearchParams();
      if (from) qs.set('from', from);
      if (to) qs.set('to', to);
      const qStr = qs.toString();
      const res = await fetch(`/api/admin/export/${type}${qStr ? `?${qStr}` : ''}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Export impossible.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `simcova-${type}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onToast('success', `Export CSV ${type} téléchargé`);
    } catch (err) {
      onToast('error', 'Erreur export', err instanceof Error ? err.message : undefined);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.adminUpdateSettings(settingsForm);
      onToast('success', 'Paramètres plateforme enregistrés');
      onRefreshBootstrap();
    } catch (err) {
      onToast('error', 'Erreur sauvegarde', err instanceof Error ? err.message : undefined);
    }
  };

  const navTabs: Array<{ id: AdminTab; label: string; icon: React.ReactNode }> = [
    { id: 'overview', label: 'Vue globale', icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'finance', label: 'Finances & Reversements', icon: <Banknote className="w-4 h-4" /> },
    { id: 'analytics', label: 'Statistiques', icon: <TrendingUp className="w-4 h-4" /> },
    { id: 'buyers', label: 'Acheteurs', icon: <Contact className="w-4 h-4" /> },
    { id: 'products', label: 'Catalogue', icon: <Tags className="w-4 h-4" /> },
    { id: 'promos', label: 'Promotions', icon: <Percent className="w-4 h-4" /> },
    { id: 'system', label: 'Système', icon: <Database className="w-4 h-4" /> },
    { id: 'vendors', label: 'Vendeurs & KYC', icon: <Users className="w-4 h-4" /> },
    { id: 'rules', label: 'Règles RG-01..10', icon: <Sliders className="w-4 h-4" /> },
    { id: 'categories', label: 'Catégories', icon: <Tags className="w-4 h-4" /> },
    { id: 'moderation', label: 'Modération', icon: <ShieldAlert className="w-4 h-4" /> },
    { id: 'push', label: 'Alertes Push', icon: <BellRing className="w-4 h-4" /> },
    { id: 'orders', label: 'Commandes & CSV', icon: <Receipt className="w-4 h-4" /> },
    { id: 'settings', label: 'Paramètres & Audit', icon: <Settings className="w-4 h-4" /> },
  ];

  return (
    <div className="space-y-6">
      {/* Sous-navigation console Admin */}
      <div className="sim-tabs-bar items-center gap-2 pb-3 border-b border-[var(--sim-border-hairline)]">
        {navTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-2 rounded-[var(--sim-radius-md)] px-3.5 py-2 text-xs font-bold uppercase tracking-wide transition-colors whitespace-nowrap shrink-0 ${
              tab === t.id
                ? 'bg-[var(--sim-steel-950)] text-white'
                : 'bg-[var(--sim-bg-surface)] text-[var(--sim-text-secondary)] border border-[var(--sim-border-hairline)] hover:border-[var(--sim-border-strong)] hover:text-[var(--sim-text-primary)]'
            }`}
          >
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {loading && tab !== 'rules' && tab !== 'categories' && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 rounded-[var(--sim-radius-lg)] sim-skeleton" />
          ))}
        </div>
      )}

      {/* 1. OVERVIEW */}
      {tab === 'overview' && kpis && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-xl font-extrabold uppercase tracking-wide text-[var(--sim-text-primary)]">
              Tableau de pilotage global
            </h2>
            <div className="inline-flex rounded-[var(--sim-radius-md)] border border-[var(--sim-border-strong)] bg-[var(--sim-bg-surface)] p-1">
              {(
                [
                  ['7d', '7 jours'],
                  ['30d', '30 jours'],
                  ['90d', '90 jours'],
                  ['all', 'Tout'],
                ] as const
              ).map(([pId, pLabel]) => (
                <button
                  key={pId}
                  type="button"
                  onClick={() => setPeriod(pId)}
                  className={`rounded-[var(--sim-radius-sm)] px-3 py-1 text-xs font-bold uppercase tracking-wide transition-colors whitespace-nowrap ${
                    period === pId
                      ? 'bg-[var(--sim-steel-950)] text-white'
                      : 'text-[var(--sim-text-secondary)] hover:text-[var(--sim-text-primary)]'
                  }`}
                >
                  {pLabel}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="rounded-[var(--sim-radius-lg)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-5">
              <p className="text-xs font-medium text-[var(--sim-text-muted)]">Volume d’affaires encaissé</p>
              <p className="mt-2 font-display text-2xl font-bold text-[var(--sim-text-primary)] font-mono-nums">
                {formatCurrency(kpis.totalSales, settings.currency)}
              </p>
              <p className="mt-1 text-xs text-[var(--sim-text-secondary)] font-mono-nums">
                {kpis.totalOrders} commande(s) sur la période
              </p>
              {(kpis.vatCollected > 0 || kpis.commissionEarned > 0) && (
                <p className="mt-1 text-[11px] text-[var(--sim-text-muted)] font-mono-nums">
                  TVA collectée : {formatCurrency(kpis.vatCollected, settings.currency)} · Commission marketplace :{' '}
                  {formatCurrency(kpis.commissionEarned, settings.currency)}
                </p>
              )}
            </div>
            <div className="rounded-[var(--sim-radius-lg)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-5">
              <p className="text-xs font-medium text-[var(--sim-text-muted)]">Vendeurs actifs / En attente</p>
              <p className="mt-2 font-display text-2xl font-bold text-[var(--sim-text-primary)] font-mono-nums">
                {kpis.activeVendors} actifs · {kpis.pendingVendors} en attente
              </p>
              <button
                type="button"
                onClick={() => setTab('vendors')}
                className="mt-1 text-xs font-semibold text-[var(--sim-accent-600)] hover:underline"
              >
                Examiner les dossiers KYC
              </button>
            </div>
            <div className="rounded-[var(--sim-radius-lg)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-5">
              <p className="text-xs font-medium text-[var(--sim-text-muted)]">Catalogue &amp; Modération</p>
              <p className="mt-2 font-display text-2xl font-bold text-[var(--sim-text-primary)] font-mono-nums">
                {kpis.publishedProducts} fiches publiées
              </p>
              <p className="mt-1 text-xs text-[var(--sim-text-secondary)] font-mono-nums">
                {kpis.pendingModeration} signalement(s) à traiter
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 rounded-[var(--sim-radius-lg)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-5">
              <h3 className="font-display text-base font-bold uppercase tracking-wide text-[var(--sim-text-primary)]">
                Évolution des ventes encaissées
              </h3>
              {!kpis.evolution || kpis.evolution.length === 0 ? (
                <p className="mt-6 text-xs text-[var(--sim-text-muted)]">
                  Aucune vente enregistrée sur la période sélectionnée.
                </p>
              ) : (
                <div className="mt-5 flex items-end gap-3 h-40 pt-4 border-b border-[var(--sim-border-hairline)]">
                  {(() => {
                    const maxSales = Math.max(...kpis.evolution.map((e) => e.sales), 1);
                    return kpis.evolution.map((pt) => {
                      const pct = Math.max(8, Math.round((pt.sales / maxSales) * 100));
                      return (
                        <div key={pt.label} className="flex-1 flex flex-col items-center justify-end h-full gap-1.5 min-w-0">
                          <span className="font-mono-nums text-[10px] text-[var(--sim-text-muted)] truncate">
                            {pt.orders} cmd
                          </span>
                          <div
                            title={`${pt.label} — ${formatCurrency(pt.sales, settings.currency)}`}
                            style={{ height: `${pct}%` }}
                            className="w-full max-w-[36px] rounded-t-[var(--sim-radius-sm)] bg-[var(--sim-accent-500)] transition-all"
                          />
                          <span className="font-mono-nums text-[10px] text-[var(--sim-text-secondary)] truncate">
                            {pt.label}
                          </span>
                        </div>
                      );
                    });
                  })()}
                </div>
              )}
            </div>

            <div className="lg:col-span-5 rounded-[var(--sim-radius-lg)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-5">
              <h3 className="font-display text-base font-bold uppercase tracking-wide text-[var(--sim-text-primary)]">
                Répartition des paiements Jumia Africa
              </h3>
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 gap-3">
                {[
                  { key: 'paid', label: 'Payées' },
                  { key: 'pending', label: 'En attente' },
                  { key: 'failed', label: 'Échouées' },
                  { key: 'refunded', label: 'Remboursées' },
                  { key: 'expired', label: 'Expirées (RG-10)' },
                ].map((st) => (
                  <div key={st.key} className="rounded-[var(--sim-radius-md)] bg-[var(--sim-bg-subtle)] p-3">
                    <p className="text-[11px] font-medium text-[var(--sim-text-muted)]">{st.label}</p>
                    <p className="mt-1 font-display text-xl font-bold text-[var(--sim-text-primary)] font-mono-nums">
                      {kpis.statusCounts[st.key] ?? 0}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 1b. FINANCES & REVERSEMENTS (SPEC-ADMIN Phase 1) */}
      {tab === 'finance' && (
        <FinanceView currency={settings.currency} onExportCsv={handleExportCsv} onOpenOrder={(id) => setDetailOrderId(id)} onToast={onToast} />
      )}

      {/* 1c. STATISTIQUES */}
      {tab === 'analytics' && <AnalyticsView currency={settings.currency} onToast={onToast} />}

      {/* 1d. ANNUAIRE ACHETEURS (sans compte) */}
      {tab === 'buyers' && <BuyersView currency={settings.currency} onExportCsv={handleExportCsv} onToast={onToast} />}

      {/* 1e. CATALOGUE GLOBAL */}
      {tab === 'products' && <ProductsAdminView currency={settings.currency} onToast={onToast} />}

      {/* 1f. PROMOTIONS */}
      {tab === 'promos' && <PromoView currency={settings.currency} onToast={onToast} />}

      {/* 1g. SYSTÈME */}
      {tab === 'system' && (
        <SystemView
          currency={settings.currency}
          settings={{ maintenanceMode: settings.maintenanceMode }}
          onToggleMaintenance={async (on) => {
            try {
              await api.adminUpdateSettings({ maintenanceMode: on });
              onToast('success', on ? 'Maintenance activée' : 'Maintenance désactivée');
              onRefreshBootstrap();
            } catch (err) {
              onToast('error', 'Bascule impossible', err instanceof Error ? err.message : undefined);
            }
          }}
          onToast={onToast}
        />
      )}

      {/* 2. VENDORS & RESTRICTED KYC VIEWER */}
      {tab === 'vendors' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-bold text-[var(--sim-text-primary)]">
                Validation des vendeurs &amp; Pièces KYC chiffrées
              </h2>
              <p className="text-xs text-[var(--sim-text-secondary)]">
                Consultation restreinte sur place sans téléchargement automatique. Les décisions horodatées déclenchent un courriel au vendeur.
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleExportCsv('vendors')}
              className="sim-btn-secondary py-2 px-3.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV Vendeurs</span>
            </button>
          </div>

          {vendors.map((v) => (
            <div
              key={v.id}
              className="rounded-[var(--sim-radius-lg)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-5 space-y-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                    <span className="text-base font-display font-bold text-[var(--sim-text-primary)]">
                      {v.shopName || v.fullName}
                    </span>
                    <span className="text-[var(--sim-text-muted)]">·</span>
                    <span className="text-[var(--sim-accent-600)] uppercase tracking-wider">{v.status}</span>
                    {v.badges.length > 0 && (
                      <>
                        <span className="text-[var(--sim-text-muted)]">·</span>
                        <span className="text-[var(--sim-success-text)]">{v.badges.join(' · ')}</span>
                      </>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-[var(--sim-text-secondary)]">
                    Responsable : {v.fullName} · {v.email} {v.shopCity ? `· ${v.shopCity}` : ''} · {v.publishedCount} produit(s) publié(s)
                    <button
                      type="button"
                      onClick={() => setDetailVendorId(v.id)}
                      className="ml-2 font-semibold text-[var(--sim-accent-600)] hover:underline"
                    >
                      Fiche 360° →
                    </button>
                  </p>
                  {v.rejectionReason && (
                    <p className="mt-1 text-xs text-[var(--sim-error-text)]">Motif enregistré : {v.rejectionReason}</p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleVendorDecision(v.id, 'valide')}
                    className="inline-flex items-center gap-1.5 rounded-[var(--sim-radius-md)] bg-[var(--sim-info-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--sim-info-text)]"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Valider</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleVendorDecision(v.id, 'certifie')}
                    className="inline-flex items-center gap-1.5 rounded-[var(--sim-radius-md)] bg-[var(--sim-success-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--sim-success-text)]"
                  >
                    <Award className="w-3.5 h-3.5" />
                    <span>Certifier</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleVendorDecision(v.id, 'suspendu')}
                    className="inline-flex items-center gap-1.5 rounded-[var(--sim-radius-md)] bg-[var(--sim-warning-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--sim-warning-text)]"
                  >
                    <Ban className="w-3.5 h-3.5" />
                    <span>Suspendre</span>
                  </button>
                </div>
              </div>

              {/* Motif rejet */}
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  placeholder="Motif de rejet ou note de décision..."
                  value={rejectReasons[v.id] || ''}
                  onChange={(e) => setRejectReasons((p) => ({ ...p, [v.id]: e.target.value }))}
                  className="flex-1 min-w-[220px] rounded-[var(--sim-radius-md)] border border-[var(--sim-border-hairline)] px-3 py-1.5 text-xs"
                />
                <button
                  type="button"
                  onClick={() => handleVendorDecision(v.id, 'rejete')}
                  className="inline-flex items-center gap-1.5 rounded-[var(--sim-radius-md)] bg-[var(--sim-error-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--sim-error-text)]"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  <span>Rejeter avec motif</span>
                </button>
              </div>

              {/* Liste pièces KYC chiffrées */}
              <div className="border-t border-[var(--sim-border-hairline)] pt-3">
                <p className="text-xs font-semibold text-[var(--sim-text-primary)] mb-2 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-[var(--sim-accent-500)]" />
                  <span>Pièces justificatives chiffrées ({v.kycDocs.length})</span>
                </p>
                {v.kycDocs.length === 0 ? (
                  <p className="text-xs text-[var(--sim-text-muted)]">Aucune pièce KYC transmise pour ce compte.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {v.kycDocs.map((doc) => (
                      <div
                        key={doc.id}
                        className="flex items-center justify-between gap-2 rounded-[var(--sim-radius-md)] bg-[var(--sim-bg-subtle)] px-3 py-2 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold text-[var(--sim-text-primary)] truncate">{doc.docType}</p>
                          <p className="text-[11px] text-[var(--sim-text-muted)] truncate">
                            {doc.fileName} · {doc.reviewStatus}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleViewKyc(doc.id)}
                            className="inline-flex items-center gap-1 rounded border border-[var(--sim-border-strong)] bg-[var(--sim-bg-surface)] px-2.5 py-1 text-[11px] font-semibold hover:border-[var(--sim-accent-500)]"
                          >
                            <Eye className="w-3 h-3" />
                            <span>Consulter</span>
                          </button>
                          {confirmPurgeId === doc.id ? (
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handlePurgeKyc(doc.id)}
                                className="rounded bg-[var(--sim-error-text)] px-2 py-1 text-[10px] font-bold text-white"
                              >
                                Confirmer
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmPurgeId(null)}
                                className="rounded border border-[var(--sim-border-strong)] px-1.5 py-1 text-[10px] font-semibold"
                              >
                                Non
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmPurgeId(doc.id)}
                              aria-label="Purger la pièce KYC"
                              className="p-1.5 text-[var(--sim-error-text)] hover:bg-[var(--sim-error-bg)] rounded"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal Consultation restreinte KYC */}
      {kycPreview && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setKycPreview(null)}
          className="fixed inset-0 z-[var(--sim-z-modal)] flex items-center justify-center bg-black/65 backdrop-blur-[2px] p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl rounded-[var(--sim-radius-xl)] border border-[var(--sim-border-strong)] bg-[var(--sim-bg-surface)] p-6 shadow-[var(--sim-shadow-3)] space-y-4"
          >
            <div className="flex items-start justify-between gap-4 border-b border-[var(--sim-border-hairline)] pb-3">
              <div>
                <p className="text-xs font-semibold text-[var(--sim-accent-600)]">
                  Visualisation déchiffrée en mémoire (AES-256-GCM · Journalisée)
                </p>
                <h3 className="font-display text-lg font-bold text-[var(--sim-text-primary)]">
                  {kycPreview.docType} — {kycPreview.fileName}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setKycPreview(null)}
                className="text-xs font-semibold text-[var(--sim-text-secondary)] hover:text-[var(--sim-text-primary)]"
              >
                Fermer
              </button>
            </div>

            <div className="max-h-[60vh] overflow-auto rounded-[var(--sim-radius-md)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-subtle)] p-4">
              {kycPreview.textPreview && (
                <pre className="whitespace-pre-wrap text-xs font-mono text-[var(--sim-text-primary)]">
                  {kycPreview.textPreview}
                </pre>
              )}
              {kycPreview.dataUrl && kycPreview.mimeType.startsWith('image/') && (
                <img
                  src={kycPreview.dataUrl}
                  alt={kycPreview.fileName}
                  className="mx-auto max-h-[52vh] object-contain"
                />
              )}
              {kycPreview.dataUrl && !kycPreview.mimeType.startsWith('image/') && (
                <iframe
                  title={kycPreview.fileName}
                  src={kycPreview.dataUrl}
                  className="w-full h-[50vh] bg-white rounded"
                />
              )}
            </div>

            <div className="flex items-center justify-between pt-2">
              {confirmPurgeId === kycPreview.id ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handlePurgeKyc(kycPreview.id)}
                    className="rounded-[var(--sim-radius-md)] bg-[var(--sim-error-text)] px-3.5 py-2 text-xs font-semibold text-white"
                  >
                    Confirmer la purge définitive
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmPurgeId(null)}
                    className="sim-btn-secondary py-2 px-3"
                  >
                    Annuler
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmPurgeId(kycPreview.id)}
                  className="inline-flex items-center gap-1.5 rounded-[var(--sim-radius-md)] bg-[var(--sim-error-bg)] px-3.5 py-2 text-xs font-semibold text-[var(--sim-error-text)]"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Purger la pièce après examen</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setKycPreview(null)}
                className="rounded-[var(--sim-radius-md)] bg-[var(--sim-steel-950)] px-4 py-2 text-xs font-semibold text-white"
              >
                Terminer l’examen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. RULES ENGINE RG-01 .. RG-10 (CHAPTER 7) */}
      {tab === 'rules' && (
        <div className="space-y-4">
          <div>
            <h2 className="font-display text-xl font-bold text-[var(--sim-text-primary)]">
              Règles de gouvernance dynamiques (RG-01 à RG-10)
            </h2>
            <p className="text-xs text-[var(--sim-text-secondary)]">
              Toute modification prend effet immédiatement sur la plateforme, est journalisée et notifie les vendeurs concernés.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {(Object.keys(ruleDrafts) as RuleId[]).sort().map((ruleId) => {
              const r = ruleDrafts[ruleId];
              if (!r) return null;
              return (
                <div
                  key={ruleId}
                  className="rounded-[var(--sim-radius-lg)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-5 space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className="font-mono text-xs font-bold text-[var(--sim-accent-600)]">{r.ruleId}</span>
                      <h3 className="font-display text-base font-bold text-[var(--sim-text-primary)]">{r.title}</h3>
                    </div>
                    <label className="inline-flex items-center gap-2 text-xs font-semibold cursor-pointer">
                      <input
                        type="checkbox"
                        checked={r.enabled}
                        onChange={(e) => updateDraftRule(ruleId, { enabled: e.target.checked })}
                      />
                      <span>{r.enabled ? 'Active' : 'Désactivée'}</span>
                    </label>
                  </div>

                  <p className="text-xs text-[var(--sim-text-secondary)] leading-relaxed">{r.helpText}</p>

                  {/* Paramètres spécifiques alignés avec server/db.ts & rulesEngine.ts */}
                  {ruleId === 'RG-03' && (
                    <div className="space-y-1.5">
                      <p className="text-[11px] font-semibold">Pièces justificatives exigées :</p>
                      <div className="flex flex-wrap gap-3">
                        {((r.valueJson.availableDocs as string[]) || [
                          'Pièce d’identité officielle',
                          'Registre du commerce (RCCM)',
                          'Justificatif de domicile',
                        ]).map((docName) => {
                          const reqDocs = (r.valueJson.requiredDocs as string[]) || [];
                          const checked = reqDocs.includes(docName);
                          return (
                            <label key={docName} className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  const next = new Set<string>(reqDocs);
                                  if (e.target.checked) next.add(docName);
                                  else next.delete(docName);
                                  updateDraftRuleValue(ruleId, 'requiredDocs', [...next]);
                                }}
                              />
                              <span>{docName}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {ruleId === 'RG-04' && (
                    <div className="space-y-1.5">
                      <p className="text-[11px] font-semibold">Champs obligatoires à l’inscription vendeur :</p>
                      <div className="flex flex-wrap gap-3">
                        {RG04_ALL_FIELDS.map((f) => {
                          const selected = ((r.valueJson.requiredFields as string[]) || []).includes(f.id);
                          return (
                            <label key={f.id} className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
                              <input
                                type="checkbox"
                                checked={selected}
                                onChange={(e) => {
                                  const curr = new Set<string>((r.valueJson.requiredFields as string[]) || []);
                                  if (e.target.checked) curr.add(f.id);
                                  else curr.delete(f.id);
                                  updateDraftRuleValue(ruleId, 'requiredFields', [...curr]);
                                }}
                              />
                              <span>{f.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {ruleId === 'RG-05' && (
                    <div>
                      <label className="block text-[11px] font-semibold">
                        Plafond maximal de produits publiés sans certification
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={200}
                        value={Number(r.valueJson.maxProducts ?? 10)}
                        onChange={(e) => updateDraftRuleValue(ruleId, 'maxProducts', Number(e.target.value))}
                        className="mt-1 w-32 rounded border border-[var(--sim-border-strong)] px-2.5 py-1.5 text-xs font-mono-nums"
                      />
                    </div>
                  )}

                  {ruleId === 'RG-06' && (
                    <button
                      type="button"
                      onClick={() => setTab('categories')}
                      className="text-xs font-semibold text-[var(--sim-accent-600)] hover:underline"
                    >
                      Gérer les catégories autorisées et interdites →
                    </button>
                  )}

                  {ruleId === 'RG-07' && (
                    <div>
                      <label className="block text-[11px] font-semibold">Seuil de signalements (masquage auto)</label>
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={Number(r.valueJson.threshold ?? 3)}
                        onChange={(e) => updateDraftRuleValue(ruleId, 'threshold', Number(e.target.value))}
                        className="mt-1 w-32 rounded border border-[var(--sim-border-strong)] px-2.5 py-1.5 text-xs font-mono-nums"
                      />
                    </div>
                  )}

                  {ruleId === 'RG-08' && (
                    <div className="flex flex-wrap gap-3">
                      {PAYMENT_METHOD_OPTIONS.map((m) => {
                        const list = (r.valueJson.methods as PaymentMethodId[]) || [];
                        const checked = list.includes(m.id);
                        return (
                          <label key={m.id} className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const next = new Set<PaymentMethodId>(list);
                                if (e.target.checked) next.add(m.id);
                                else next.delete(m.id);
                                updateDraftRuleValue(ruleId, 'methods', [...next]);
                              }}
                            />
                            <span>{m.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}

                  {ruleId === 'RG-09' && (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-[11px] font-semibold">
                          Forfait de livraison par défaut ({settings.currency})
                        </label>
                        <input
                          type="number"
                          min={0}
                          step={500}
                          value={Number(r.valueJson.defaultFlatFee ?? 2000)}
                          onChange={(e) => updateDraftRuleValue(ruleId, 'defaultFlatFee', Number(e.target.value))}
                          className="mt-1 w-40 rounded border border-[var(--sim-border-strong)] px-2.5 py-1.5 text-xs font-mono-nums"
                        />
                      </div>
                      {Array.isArray(r.valueJson.zones) && (
                        <div className="space-y-1.5">
                          <p className="text-[11px] font-semibold">Tarifs par zone ({settings.currency}) :</p>
                          {(r.valueJson.zones as DeliveryZoneFee[]).map((z, idx) => (
                            <div key={z.zoneId} className="flex items-center justify-between gap-2 text-xs">
                              <span className="text-[var(--sim-text-secondary)]">{z.zoneName}</span>
                              <input
                                type="number"
                                min={0}
                                step={500}
                                value={z.fee}
                                onChange={(e) => {
                                  const nextZones = (r.valueJson.zones as DeliveryZoneFee[]).map((item, i) =>
                                    i === idx ? { ...item, fee: Number(e.target.value) } : item
                                  );
                                  updateDraftRuleValue(ruleId, 'zones', nextZones);
                                }}
                                className="w-32 rounded border border-[var(--sim-border-strong)] px-2.5 py-1 text-xs font-mono-nums"
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {ruleId === 'RG-10' && (
                    <div>
                      <label className="block text-[11px] font-semibold">
                        Délai d’expiration paiement (heures)
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={168}
                        value={Number(r.valueJson.expirationHours ?? 48)}
                        onChange={(e) => updateDraftRuleValue(ruleId, 'expirationHours', Number(e.target.value))}
                        className="mt-1 w-32 rounded border border-[var(--sim-border-strong)] px-2.5 py-1.5 text-xs font-mono-nums"
                      />
                    </div>
                  )}

                  <div className="flex items-center justify-between border-t border-[var(--sim-border-hairline)] pt-3 text-[11px] text-[var(--sim-text-muted)]">
                    <span>
                      Modifiée par {r.updatedBy} · {new Date(r.updatedAt).toLocaleDateString('fr-FR')}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleSaveRule(ruleId)}
                      className="rounded-[var(--sim-radius-md)] bg-[var(--sim-accent-500)] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[var(--sim-accent-600)]"
                    >
                      Enregistrer {ruleId}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 4. CATEGORIES */}
      {tab === 'categories' && (
        <div className="space-y-6">
          <form
            onSubmit={handleCreateCategory}
            className="rounded-[var(--sim-radius-lg)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-5 flex flex-wrap items-end gap-3"
          >
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-semibold text-[var(--sim-text-primary)]">
                Nouvelle catégorie
              </label>
              <input
                type="text"
                required
                placeholder="Ex. Pièces Détachées & Pneumatiques"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                className="mt-1 w-full rounded-[var(--sim-radius-md)] border border-[var(--sim-border-strong)] px-3 py-2 text-sm"
              />
            </div>
            <div className="w-56">
              <label className="block text-xs font-semibold text-[var(--sim-text-primary)]">
                Badge requis (optionnel, RG-02)
              </label>
              <input
                type="text"
                placeholder="Ex. Vendeur certifié"
                value={newCatBadge}
                onChange={(e) => setNewCatBadge(e.target.value)}
                className="mt-1 w-full rounded-[var(--sim-radius-md)] border border-[var(--sim-border-strong)] px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              className="rounded-[var(--sim-radius-md)] bg-[var(--sim-accent-500)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--sim-accent-600)]"
            >
              Ajouter
            </button>
          </form>

          <div className="sim-table-wrap rounded-[var(--sim-radius-lg)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)]">
            <table className="w-full text-left text-xs">
              <thead className="bg-[var(--sim-bg-subtle)] text-[var(--sim-text-muted)]">
                <tr>
                  <th className="px-4 py-3 font-semibold">Catégorie</th>
                  <th className="px-4 py-3 font-semibold">Badge requis (RG-02)</th>
                  <th className="px-4 py-3 font-semibold">État catalogue</th>
                  <th className="px-4 py-3 font-semibold">Statut RG-06</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--sim-border-hairline)]">
                {categories.map((c) => {
                  const badgeVal = catBadgeDrafts[c.id] ?? c.requiredBadge ?? '';
                  return (
                    <tr key={c.id}>
                      <td className="px-4 py-3 font-semibold text-[var(--sim-text-primary)]">{c.name}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            placeholder="Aucun"
                            value={badgeVal}
                            onChange={(e) => setCatBadgeDrafts((d) => ({ ...d, [c.id]: e.target.value }))}
                            className="w-40 rounded border border-[var(--sim-border-hairline)] px-2 py-1 text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveCategoryBadge(c)}
                            className="rounded bg-[var(--sim-bg-subtle)] px-2 py-1 text-[11px] font-semibold hover:bg-[var(--sim-accent-50)] hover:text-[var(--sim-accent-600)]"
                          >
                            OK
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => handleToggleCategory(c, 'active')}
                          className={`rounded px-2.5 py-1 font-semibold ${
                            c.active
                              ? 'bg-[var(--sim-success-bg)] text-[var(--sim-success-text)]'
                              : 'bg-[var(--sim-bg-subtle)] text-[var(--sim-text-muted)]'
                          }`}
                        >
                          {c.active ? 'Active' : 'Inactive'}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => handleToggleCategory(c, 'forbidden')}
                          className={`rounded px-2.5 py-1 font-semibold ${
                            c.forbidden
                              ? 'bg-[var(--sim-error-bg)] text-[var(--sim-error-text)]'
                              : 'bg-[var(--sim-bg-subtle)] text-[var(--sim-text-secondary)]'
                          }`}
                        >
                          {c.forbidden ? 'Interdite (RG-06)' : 'Autorisée'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 5. MODERATION */}
      {tab === 'moderation' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-3">
            <h3 className="font-display text-lg font-bold text-[var(--sim-text-primary)]">
              Modération des avis ({modReviews.length})
            </h3>
            {modReviews.map((r) => (
              <div
                key={r.id}
                className="rounded-[var(--sim-radius-lg)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-4 space-y-2"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-[var(--sim-text-primary)]">
                    {r.buyerName} · {r.productTitle}
                  </span>
                  <span className="font-mono-nums text-[var(--sim-accent-600)]">
                    {r.rating}/5 · {r.moderationStatus} ({r.reportCount} signalement)
                  </span>
                </div>
                <p className="text-xs text-[var(--sim-text-secondary)]">{r.comment}</p>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={async () => {
                      await api.adminModerateReview(r.id, 'visible');
                      onToast('success', 'Avis maintenu visible');
                      loadTab('moderation');
                    }}
                    className="rounded bg-[var(--sim-success-bg)] px-2.5 py-1 text-[11px] font-semibold text-[var(--sim-success-text)]"
                  >
                    Valider visible
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await api.adminModerateReview(r.id, 'retire');
                      onToast('success', 'Avis retiré du catalogue');
                      loadTab('moderation');
                    }}
                    className="rounded bg-[var(--sim-error-bg)] px-2.5 py-1 text-[11px] font-semibold text-[var(--sim-error-text)]"
                  >
                    Retirer
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            <h3 className="font-display text-lg font-bold text-[var(--sim-text-primary)]">
              Modération messagerie ({modThreads.length})
            </h3>
            {modThreads.map((t) => (
              <div
                key={t.threadId}
                className="rounded-[var(--sim-radius-lg)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-4 space-y-2"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-[var(--sim-text-primary)]">
                    {t.buyerName} ↔ {t.shopName}
                  </span>
                  <span className="text-[var(--sim-text-muted)]">
                    {t.isBlocked ? 'Fil bloqué' : t.reported ? 'Signalé' : 'Normal'}
                  </span>
                </div>
                <p className="text-xs text-[var(--sim-text-secondary)] line-clamp-2">{t.lastMessage}</p>
                <button
                  type="button"
                  onClick={async () => {
                    await api.adminBlockThread(t.threadId, !t.isBlocked);
                    onToast('success', t.isBlocked ? 'Fil débloqué' : 'Fil bloqué et masqué');
                    loadTab('moderation');
                  }}
                  className={`rounded px-3 py-1 text-[11px] font-semibold ${
                    t.isBlocked
                      ? 'bg-[var(--sim-bg-subtle)] text-[var(--sim-text-primary)]'
                      : 'bg-[var(--sim-error-bg)] text-[var(--sim-error-text)]'
                  }`}
                >
                  {t.isBlocked ? 'Débloquer le fil' : 'Bloquer le fil'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 6. PUSH ALERTS BROADCASTER */}
      {tab === 'push' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <form
            onSubmit={handleSendPush}
            className="rounded-[var(--sim-radius-lg)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-6 space-y-4"
          >
            <div>
              <h2 className="font-display text-lg font-bold text-[var(--sim-text-primary)]">
                Diffuser une alerte Push PWA
              </h2>
              <p className="text-xs text-[var(--sim-text-secondary)] font-mono-nums mt-0.5">
                {pushStats.subscriberCount} appareil(s) abonné(s) · {pushStats.liveConnections} session(s) en direct
              </p>
            </div>
            <div>
              <label className="sim-label">Catégorie d’alerte</label>
              <select
                value={pushType}
                onChange={(e) => setPushType(e.target.value as 'nouveautes' | 'promotions' | 'annonces')}
                className="sim-input"
              >
                <option value="nouveautes">Nouveautés &amp; Arrivages matériel</option>
                <option value="promotions">Promotions</option>
                <option value="annonces">Annonces importantes</option>
              </select>
            </div>
            <div>
              <label className="sim-label">Titre de la notification</label>
              <input
                type="text"
                required
                placeholder="Ex. Arrivage tracteurs 4x4 90 CV disponible"
                value={pushTitle}
                onChange={(e) => setPushTitle(e.target.value)}
                className="sim-input"
              />
            </div>
            <div>
              <label className="sim-label">Message</label>
              <textarea
                rows={3}
                required
                placeholder="Découvrez les équipements disponibles dès maintenant avec livraison chantier."
                value={pushBody}
                onChange={(e) => setPushBody(e.target.value)}
                className="sim-input"
              />
            </div>
            <div>
              <label className="sim-label">
                Lien profond cible (ex. /?categorie=cat-tracteurs ou /?produit=prod-1)
              </label>
              <input
                type="text"
                value={pushDeepLink}
                onChange={(e) => setPushDeepLink(e.target.value)}
                className="sim-input font-mono"
              />
            </div>
            <button type="submit" className="sim-btn-primary py-2.5 px-5">
              <Send className="w-4 h-4" />
              <span>Envoyer l’alerte instantanée</span>
            </button>
          </form>

          <div className="space-y-3">
            <h3 className="font-display text-lg font-bold text-[var(--sim-text-primary)]">
              Historique des alertes diffusées
            </h3>
            {pushAlerts.length === 0 ? (
              <p className="text-sm text-[var(--sim-text-muted)]">Aucune alerte diffusée pour le moment.</p>
            ) : (
              pushAlerts.map((a) => (
                <div
                  key={a.id}
                  className="rounded-[var(--sim-radius-lg)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-4 space-y-1"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-[var(--sim-accent-600)]">{a.alertType}</span>
                    <span className="font-mono-nums text-[var(--sim-text-muted)]">
                      {a.sentCount} envoi(s) · {new Date(a.createdAt).toLocaleString('fr-FR')}
                    </span>
                  </div>
                  <p className="font-semibold text-sm text-[var(--sim-text-primary)]">{a.title}</p>
                  <p className="text-xs text-[var(--sim-text-secondary)]">{a.body}</p>
                  <p className="text-[11px] font-mono text-[var(--sim-text-muted)]">Cible : {a.deepLink}</p>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* 7. ORDERS & TRANSACTIONS + CSV */}
      {tab === 'orders' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-xl font-bold text-[var(--sim-text-primary)]">
              Commandes, Paiements Jumia Africa &amp; Remboursements
            </h2>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => handleExportCsv('orders')}
                className="sim-btn-secondary py-1.5 px-3"
              >
                <Download className="w-3.5 h-3.5" />
                <span>CSV Commandes</span>
              </button>
              <button
                type="button"
                onClick={() => handleExportCsv('transactions')}
                className="sim-btn-secondary py-1.5 px-3"
              >
                <Download className="w-3.5 h-3.5" />
                <span>CSV Transactions</span>
              </button>
            </div>
          </div>

          <div className="max-w-md">
            <label className="sim-label">Rechercher une commande (n°, acheteur, email, téléphone)</label>
            <input
              type="text"
              value={ordersSearch}
              onChange={(e) => setOrdersSearch(e.target.value)}
              placeholder="CMD-2026-… ou client@…"
              className="sim-input"
            />
          </div>

          <div className="sim-table-wrap rounded-[var(--sim-radius-lg)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)]">
            <table className="w-full text-left text-xs">
              <thead className="bg-[var(--sim-bg-subtle)] text-[var(--sim-text-muted)]">
                <tr>
                  <th className="px-4 py-3 font-semibold">N° Commande</th>
                  <th className="px-4 py-3 font-semibold">Acheteur (sans compte)</th>
                  <th className="px-4 py-3 font-semibold hide-sm">Zone &amp; Paiement</th>
                  <th className="px-4 py-3 font-semibold">Réf. Jumia</th>
                  <th className="px-4 py-3 font-semibold">Montant</th>
                  <th className="px-4 py-3 font-semibold">Statut</th>
                  <th className="px-4 py-3 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--sim-border-hairline)]">
                {orders.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-sm text-[var(--sim-text-secondary)]">
                      Aucune commande enregistrée pour le moment.
                    </td>
                  </tr>
                ) : (
                  orders
                    .filter((o) => {
                      if (!ordersSearch.trim()) return true;
                      const needle = ordersSearch.toLowerCase();
                      return `${o.order_number} ${o.buyer_name} ${o.buyer_email} ${o.buyer_phone || ''}`
                        .toLowerCase()
                        .includes(needle);
                    })
                    .map((o) => {
                    const id = String(o.id);
                    const status = String(o.payment_status);
                    return (
                      <tr key={id} className="cursor-pointer hover:bg-[var(--sim-bg-subtle)] transition-colors" onClick={() => setDetailOrderId(id)} title="Ouvrir la fiche commande 360°">
                        <td className="px-4 py-3 font-mono font-semibold text-[var(--sim-text-primary)]">
                          {String(o.order_number)}
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-semibold text-[var(--sim-text-primary)]">{String(o.buyer_name)}</p>
                          <p className="text-[11px] text-[var(--sim-text-muted)]">{String(o.buyer_email)}</p>
                        </td>
                        <td className="px-4 py-3 text-[11px] text-[var(--sim-text-secondary)]">
                          <p className="font-medium">{String(o.delivery_zone || '—')}</p>
                          <p className="text-[var(--sim-text-muted)]">
                            {String(o.payment_method || '—')} ·{' '}
                            {String(o.payment_mode || 'full') === 'deposit'
                              ? 'Acompte'
                              : String(o.payment_mode || 'full') === 'quote'
                              ? 'Devis'
                              : String(o.payment_mode || 'full') === 'bank_transfer'
                              ? 'Virement'
                              : 'Intégral'}
                          </p>
                        </td>
                        <td className="px-4 py-3 font-mono text-[11px] text-[var(--sim-text-secondary)]">
                          {String(o.provider_ref || o.bank_transfer_ref || '—')}
                        </td>
                        <td className="px-4 py-3 font-mono-nums font-bold text-[var(--sim-text-primary)]">
                          <p>{formatCurrency(Number(o.grand_total ?? o.total_amount), settings.currency)}</p>
                          {Number(o.commission_amount) > 0 && (
                            <p className="text-[10px] font-normal text-[var(--sim-accent-600)]">
                              Commission : {formatCurrency(Number(o.commission_amount), settings.currency)}
                            </p>
                          )}
                          {Number(o.balance_due) > 0 && (
                            <p className="text-[10px] font-normal text-[var(--sim-warning-text)]">
                              Reste : {formatCurrency(Number(o.balance_due), settings.currency)}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 font-semibold uppercase text-[11px]">{status}</td>
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          {status === 'paid' && confirmRefundOrderId !== id && (
                            <button
                              type="button"
                              onClick={() => setConfirmRefundOrderId(id)}
                              className="inline-flex items-center gap-1 rounded bg-[var(--sim-warning-bg)] px-2.5 py-1 text-[11px] font-semibold text-[var(--sim-warning-text)]"
                            >
                              <RefreshCw className="w-3 h-3" />
                              <span>Rembourser</span>
                            </button>
                          )}
                          {status === 'paid' && confirmRefundOrderId === id && (
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleRefund(id)}
                                className="rounded bg-[var(--sim-error-text)] px-2 py-1 text-[10px] font-bold text-white"
                              >
                                Confirmer
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmRefundOrderId(null)}
                                className="rounded border border-[var(--sim-border-strong)] px-1.5 py-1 text-[10px] font-semibold"
                              >
                                Annuler
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 8. SETTINGS & AUDIT LOGS */}
      {tab === 'settings' && (
        <div className="space-y-8">
          <form
            onSubmit={handleSaveSettings}
            className="rounded-[var(--sim-radius-lg)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-6 space-y-4"
          >
            <h2 className="font-display text-lg font-bold text-[var(--sim-text-primary)]">
              Paramètres généraux, Livraison, CGV &amp; Rétention KYC
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="sim-label">Devise</label>
                <input
                  type="text"
                  value={settingsForm.currency}
                  onChange={(e) => setSettingsForm((s) => ({ ...s, currency: e.target.value }))}
                  className="sim-input"
                />
              </div>
              <div>
                <label className="sim-label">Courriel support</label>
                <input
                  type="email"
                  value={settingsForm.supportEmail}
                  onChange={(e) => setSettingsForm((s) => ({ ...s, supportEmail: e.target.value }))}
                  className="sim-input"
                />
              </div>
              <div>
                <label className="sim-label">Téléphone support</label>
                <input
                  type="text"
                  value={settingsForm.supportPhone}
                  onChange={(e) => setSettingsForm((s) => ({ ...s, supportPhone: e.target.value }))}
                  className="sim-input"
                />
              </div>
              <div>
                <label className="sim-label">Rétention KYC (jours)</label>
                <input
                  type="number"
                  min={1}
                  value={settingsForm.kycRetentionDays}
                  onChange={(e) => setSettingsForm((s) => ({ ...s, kycRetentionDays: Number(e.target.value) }))}
                  className="sim-input font-mono-nums"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="sim-label">Politique de livraison par défaut</label>
                <input
                  type="text"
                  value={settingsForm.defaultDeliveryPolicy}
                  onChange={(e) => setSettingsForm((s) => ({ ...s, defaultDeliveryPolicy: e.target.value }))}
                  className="sim-input"
                />
              </div>
              <div>
                <label className="sim-label">Délai indicatif d’examen vendeur</label>
                <input
                  type="text"
                  value={settingsForm.reviewProcessingDelayLabel}
                  onChange={(e) => setSettingsForm((s) => ({ ...s, reviewProcessingDelayLabel: e.target.value }))}
                  className="sim-input"
                />
              </div>
              <div>
                <label className="sim-label">Acompte par défaut (%)</label>
                <input
                  type="number"
                  min={10}
                  max={90}
                  value={settingsForm.defaultDepositPercent}
                  onChange={(e) => setSettingsForm((s) => ({ ...s, defaultDepositPercent: Number(e.target.value) }))}
                  className="sim-input font-mono-nums"
                />
              </div>
              <div>
                <label className="sim-label">Seuil virement bancaire ({settingsForm.currency})</label>
                <input
                  type="number"
                  min={0}
                  step={100000}
                  value={settingsForm.bankTransferThreshold}
                  onChange={(e) => setSettingsForm((s) => ({ ...s, bankTransferThreshold: Number(e.target.value) }))}
                  className="sim-input font-mono-nums"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="sim-label">Commission marketplace (% du sous-total produits)</label>
                <input
                  type="number"
                  min={0}
                  max={50}
                  value={settingsForm.commissionRatePercent}
                  onChange={(e) =>
                    setSettingsForm((s) => ({ ...s, commissionRatePercent: Number(e.target.value) }))
                  }
                  className="sim-input font-mono-nums"
                />
                <p className="mt-1 text-[11px] text-[var(--sim-text-muted)]">
                  0 = aucune commission prélevée sur les ventes vendeurs.
                </p>
              </div>
              <div>
                <label className="sim-label">TVA (% applicable aux commandes)</label>
                <input
                  type="number"
                  min={0}
                  max={50}
                  value={settingsForm.vatRatePercent}
                  onChange={(e) => setSettingsForm((s) => ({ ...s, vatRatePercent: Number(e.target.value) }))}
                  className="sim-input font-mono-nums"
                />
                <p className="mt-1 text-[11px] text-[var(--sim-text-muted)]">
                  0 = prix affichés tous taxes compris (aucune TVA ajoutée à la caisse).
                </p>
              </div>
            </div>
            <div>
              <label className="sim-label">Mentions légales</label>
              <textarea
                rows={2}
                value={settingsForm.legalMentions}
                onChange={(e) => setSettingsForm((s) => ({ ...s, legalMentions: e.target.value }))}
                className="sim-input"
              />
            </div>
            <div>
              <label className="sim-label">Conditions Générales de Vente (CGV)</label>
              <textarea
                rows={3}
                value={settingsForm.cgvText}
                onChange={(e) => setSettingsForm((s) => ({ ...s, cgvText: e.target.value }))}
                className="sim-input"
              />
            </div>
            <button type="submit" className="sim-btn-primary py-2.5 px-5">
              Enregistrer les paramètres
            </button>
          </form>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="rounded-[var(--sim-radius-lg)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-5 space-y-3">
              <h3 className="font-display text-base font-bold text-[var(--sim-text-primary)] flex items-center gap-2">
                <FileText className="w-4 h-4 text-[var(--sim-accent-500)]" />
                <span>Journal d’audit immuable ({auditLogs.length})</span>
              </h3>
              <div className="max-h-80 overflow-auto divide-y divide-[var(--sim-border-hairline)] text-xs">
                {auditLogs.map((l) => (
                  <div key={l.id} className="py-2.5">
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-semibold text-[var(--sim-accent-600)]">{l.action}</span>
                      <span className="text-[11px] text-[var(--sim-text-muted)]">
                        {new Date(l.createdAt).toLocaleString('fr-FR')}
                      </span>
                    </div>
                    <p className="text-[var(--sim-text-primary)] mt-0.5">{l.details}</p>
                    <p className="text-[11px] text-[var(--sim-text-muted)]">Acteur : {l.actorEmail}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[var(--sim-radius-lg)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-5 space-y-3">
              <h3 className="font-display text-base font-bold text-[var(--sim-text-primary)]">
                Courriels transactionnels émis ({outboxEmails.length})
              </h3>
              <div className="max-h-80 overflow-auto divide-y divide-[var(--sim-border-hairline)] text-xs">
                {outboxEmails.map((m) => (
                  <div key={m.id} className="py-2.5">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[var(--sim-text-primary)]">
                        {m.toEmail}{' '}
                        {m.sentAt ? (
                          <span className="ml-1 rounded bg-[var(--sim-success-bg)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--sim-success-text)]">
                            Envoyé
                          </span>
                        ) : m.lastError ? (
                          <span
                            className="ml-1 rounded bg-[var(--sim-error-bg)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--sim-error-text)]"
                            title={m.lastError}
                          >
                            Échec ({m.attempts})
                          </span>
                        ) : (
                          <span className="ml-1 rounded bg-[var(--sim-warning-bg)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--sim-warning-text)]">
                            File d’attente
                          </span>
                        )}
                      </span>
                      <span className="text-[11px] text-[var(--sim-text-muted)]">
                        {new Date(m.createdAt).toLocaleString('fr-FR')}
                      </span>
                    </div>
                    <p className="font-medium text-[var(--sim-accent-600)] mt-0.5">{m.subject}</p>
                    <p className="text-[var(--sim-text-secondary)] mt-0.5 line-clamp-2">{m.bodyText}</p>
                    {m.actionUrl && (
                      <a
                        href={m.actionUrl}
                        className="mt-1 inline-block text-[11px] font-semibold text-[var(--sim-accent-600)] hover:underline"
                      >
                        {m.actionLabel || 'Ouvrir le lien sécurisé'} →
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Fiche vendeur 360° */}
      <VendorDetailModal
        vendorId={detailVendorId}
        currency={settings.currency}
        onClose={() => setDetailVendorId(null)}
        onToast={onToast}
      />

      {/* Fiche commande 360° (timeline, articles, ventilation financière complète) */}
      <OrderDetailModal
        orderId={detailOrderId}
        currency={settings.currency}
        onClose={() => setDetailOrderId(null)}
        onToast={onToast}
      />
    </div>
  );
};

import React, { useEffect, useRef, useState } from 'react';
import {
  PackageCheck,
  Clock,
  RefreshCw,
  MailSearch,
  Star,
  Truck,
  CheckCircle2,
  Send,
  ShieldAlert,
  Copy,
  Landmark,
  MessageSquare,
} from 'lucide-react';
import { api } from '../lib/api';
import {
  computeOrderProgressRank,
  extractTrackingTokenFromInput,
  formatCurrency,
  PAYMENT_METHOD_LABELS,
  PAYMENT_MODE_LABELS,
  PAYMENT_STATUS_LABELS,
} from '../shared/rulesEngine';
import type {
  CustomSpecs,
  MessageThreadItem,
  Order,
  OrderEventStatus,
  PaymentMethodId,
  PlatformRule,
  PlatformSettings,
  RuleId,
} from '../shared/types';
import { DEFAULT_PAYMENT_METHODS } from '../shared/constants';

export interface RecentOrderSummary {
  orderNumber: string;
  trackingToken: string;
  totalAmount: number;
  paymentMode: string;
  createdAt: string;
}

interface OrderTrackingViewProps {
  trackingToken: string | null;
  threadToken: string | null;
  currency: string;
  rules: Record<RuleId, PlatformRule>;
  settings: PlatformSettings;
  recentOrders?: RecentOrderSummary[];
  onRememberOrder?: (entry: RecentOrderSummary) => void;
  onUpdateTrackingToken: (token: string | null) => void;
  onOpenThread: (token: string) => void;
  onToast: (type: 'success' | 'error' | 'info', title: string, description?: string) => void;
}

const EVENT_LABELS: Record<string, string> = {
  creee: 'Commande créée',
  devis_demande: 'Devis personnalisé demandé',
  devis_propose: 'Tarif devis proposé par le vendeur',
  en_attente_paiement: 'En attente de paiement',
  en_attente_virement: 'En attente de virement bancaire',
  acompte_paye: 'Acompte payé (solde à la livraison)',
  payee: 'Paiement intégral confirmé',
  en_preparation: 'En préparation chez le vendeur',
  expediee: 'Expédiée',
  livraison_commencee: 'Livraison commencée',
  livree: 'Livrée',
  annulee: 'Annulée',
  remboursee: 'Remboursée',
  expiree: 'Expirée (délai dépassé)',
};

export const OrderTrackingView: React.FC<OrderTrackingViewProps> = ({
  trackingToken,
  threadToken,
  currency,
  rules,
  settings,
  recentOrders = [],
  onRememberOrder,
  onUpdateTrackingToken,
  onOpenThread,
  onToast,
}) => {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [items, setItems] = useState<
    Array<{
      id: string;
      productId: string;
      productTitle: string;
      variantLabel: string | null;
      quantity: number;
      unitPrice: number;
      deliveryFee: number;
      carrier: string | null;
      trackingNumber: string | null;
      itemStatus: string;
      shopName: string;
      alreadyReviewed: boolean;
      customSpecs?: CustomSpecs | null;
    }>
  >([]);
  const [events, setEvents] = useState<Array<{ id: string; status: string; note: string; actor: string; createdAt: string }>>([]);
  const [paymentRef, setPaymentRef] = useState<string | null>(null);
  const [canReview, setCanReview] = useState(false);

  // Quote settlement selector
  const [quotePayMode, setQuotePayMode] = useState<'full' | 'deposit' | 'bank_transfer'>('full');
  const [quotePayMethod, setQuotePayMethod] = useState<PaymentMethodId>('mobile_money_orange');
  const [quoteBankRef, setQuoteBankRef] = useState('');
  const [settlingQuote, setSettlingQuote] = useState(false);

  // Token manual input & email recovery (EXF-409)
  const [manualTokenInput, setManualTokenInput] = useState('');
  const [recoverEmail, setRecoverEmail] = useState('');
  const [recoverMessage, setRecoverMessage] = useState<string | null>(null);

  // Review state (EXF-603)
  const [reviewRating, setReviewRating] = useState<Record<string, number>>({});
  const [reviewComment, setReviewComment] = useState<Record<string, string>>({});

  // Guest message thread viewer (EXF-602)
  const [threadMessages, setThreadMessages] = useState<MessageThreadItem[]>([]);
  const [threadBlocked, setThreadBlocked] = useState(false);
  const [threadReply, setThreadReply] = useState('');
  const [showOrderLookupOnThread, setShowOrderLookupOnThread] = useState(false);
  const threadScrollRef = useRef<HTMLDivElement | null>(null);

  const loadOrder = (token: string) => {
    setLoading(true);
    setErrorMsg(null);
    api
      .trackOrder(token)
      .then((res) => {
        setOrder(res.order);
        setItems(res.items);
        setEvents(res.events);
        setPaymentRef(res.payment?.provider_ref ?? null);
        setCanReview(res.canReviewProducts);
        onRememberOrder?.({
          orderNumber: res.order.orderNumber,
          trackingToken: token,
          totalAmount: res.order.totalAmount,
          paymentMode: res.order.paymentMode || 'full',
          createdAt: res.order.createdAt,
        });
      })
      .catch((err) => {
        setErrorMsg(err instanceof Error ? err.message : 'Lien de suivi invalide.');
        setOrder(null);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (trackingToken) {
      loadOrder(trackingToken);
    } else {
      setOrder(null);
    }
  }, [trackingToken]);

  useEffect(() => {
    if (!threadToken) {
      setThreadMessages([]);
      return;
    }
    api
      .getGuestThread(threadToken)
      .then((res) => {
        setThreadMessages(res.messages);
        setThreadBlocked(res.blocked);
      })
      .catch((err) => onToast('error', 'Fil introuvable', err instanceof Error ? err.message : undefined));
  }, [threadToken, onToast]);

  useEffect(() => {
    if (threadScrollRef.current) {
      threadScrollRef.current.scrollTop = threadScrollRef.current.scrollHeight;
    }
  }, [threadMessages]);

  const handleRegenerateToken = async () => {
    if (!trackingToken) return;
    try {
      const res = await api.regenerateTrackingLink(trackingToken);
      onUpdateTrackingToken(res.newToken);
      onToast('success', 'Nouveau lien généré', 'L’ancien lien de suivi a été révoqué.');
    } catch (err) {
      onToast('error', 'Erreur', err instanceof Error ? err.message : undefined);
    }
  };

  const handleResumePayment = async () => {
    if (!paymentRef || !trackingToken) return;
    try {
      await api.completeSandboxPayment(paymentRef, 'paid');
      loadOrder(trackingToken);
      onToast('success', 'Paiement confirmé via Jumia Africa');
    } catch (err) {
      onToast('error', 'Erreur de paiement', err instanceof Error ? err.message : undefined);
    }
  };

  const handlePayQuote = async () => {
    if (!trackingToken) return;
    setSettlingQuote(true);
    try {
      const res = await api.payQuoteOrder(trackingToken, {
        targetMode: quotePayMode,
        paymentMethod: quotePayMode !== 'bank_transfer' ? quotePayMethod : undefined,
        bankTransferRef: quotePayMode === 'bank_transfer' ? quoteBankRef.trim() || undefined : undefined,
      });
      if (res.paymentSession?.providerRef) {
        await api.completeSandboxPayment(res.paymentSession.providerRef, 'paid');
      }
      setQuoteBankRef('');
      loadOrder(trackingToken);
      onToast(
        'success',
        quotePayMode === 'bank_transfer' ? 'Virement bancaire sélectionné' : 'Devis réglé via Jumia Africa'
      );
    } catch (err) {
      onToast('error', 'Règlement impossible', err instanceof Error ? err.message : undefined);
    } finally {
      setSettlingQuote(false);
    }
  };

  const handleSubmitReview = async (productId: string) => {
    if (!trackingToken) return;
    const rating = reviewRating[productId] || 5;
    const comment = reviewComment[productId] || '';
    if (!comment.trim()) {
      onToast('error', 'Veuillez saisir votre commentaire.');
      return;
    }
    try {
      await api.submitReview({ trackingToken, productId, rating, comment });
      onToast('success', 'Avis publié !', 'Merci pour votre retour d’expérience vérifié.');
      loadOrder(trackingToken);
    } catch (err) {
      onToast('error', 'Impossible de publier l’avis', err instanceof Error ? err.message : undefined);
    }
  };

  const handleRecoverByEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.recoverOrders(recoverEmail);
      setRecoverMessage(res.message);
    } catch (err) {
      onToast('error', 'Erreur', err instanceof Error ? err.message : undefined);
    }
  };

  const handleSendThreadReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!threadToken || !threadReply.trim()) return;
    try {
      await api.replyGuestThread(threadToken, threadReply);
      setThreadReply('');
      const refreshed = await api.getGuestThread(threadToken);
      setThreadMessages(refreshed.messages);
      onToast('success', 'Réponse envoyée au vendeur');
    } catch (err) {
      onToast('error', 'Message bloqué', err instanceof Error ? err.message : undefined);
    }
  };

  const rg08Methods =
    (rules['RG-08']?.valueJson?.methods as PaymentMethodId[] | undefined) ?? DEFAULT_PAYMENT_METHODS;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 pb-24 sm:px-6 lg:px-8 space-y-8">
      {/* Fil de discussion acheteur <-> vendeur sans compte (EXF-602) */}
      {threadToken && (
        <section id="thread-reply-section" className="rounded-[var(--sim-radius-xl)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-xl font-bold text-[var(--sim-text-primary)]">
              Conversation sécurisée avec le vendeur
            </h2>
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--sim-warning-text)]">
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>Canal obligatoire SIMCOVA · Hors-plateforme bloqué</span>
            </span>
          </div>
          {threadBlocked ? (
            <div className="mt-4 flex items-center gap-2 rounded-[var(--sim-radius-md)] bg-[var(--sim-error-bg)] p-4 text-xs text-[var(--sim-error-text)]">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>Ce fil de discussion a été suspendu par la modération SIMCOVA.</span>
            </div>
          ) : (
            <>
              <div ref={threadScrollRef} className="mt-4 space-y-3 max-h-80 overflow-y-auto pr-1">
                {threadMessages.map((m) => (
                  <div
                    key={m.id}
                    className={`rounded-[var(--sim-radius-md)] p-3.5 text-sm ${
                      m.senderRole === 'buyer'
                        ? 'bg-[var(--sim-accent-50)] ml-6 border border-[var(--sim-accent-100)]'
                        : 'bg-[var(--sim-bg-subtle)] mr-6 border border-[var(--sim-border-hairline)]'
                    }`}
                  >
                    <div className="flex justify-between text-xs text-[var(--sim-text-muted)]">
                      <span className="font-semibold text-[var(--sim-text-primary)]">
                        {m.senderRole === 'buyer' ? `${m.buyerName} (Vous)` : m.shopName || 'Vendeur'}
                      </span>
                      <span className="font-mono-nums">{new Date(m.createdAt).toLocaleString('fr-FR')}</span>
                    </div>
                    <p className="mt-1 text-[var(--sim-text-primary)]">{m.body}</p>
                  </div>
                ))}
              </div>
              <form onSubmit={handleSendThreadReply} className="mt-4 flex gap-2">
                <input
                  value={threadReply}
                  onChange={(e) => setThreadReply(e.target.value)}
                  placeholder="Écrire une réponse au vendeur (sans numéro, e-mail ni lien externe)..."
                  className="sim-input flex-1"
                />
                <button
                  type="submit"
                  className="sim-btn-primary"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Envoyer</span>
                </button>
              </form>
            </>
          )}
        </section>
      )}

      {threadToken && !trackingToken && !showOrderLookupOnThread ? (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setShowOrderLookupOnThread(true)}
            className="text-xs font-semibold text-[var(--sim-accent-600)] hover:underline"
          >
            Consulter aussi un suivi de commande →
          </button>
        </div>
      ) : (
        <>
          <div>
            <h1 className="font-display text-3xl font-bold text-[var(--sim-text-primary)]">
              Suivi de commande sans compte
            </h1>
            <p className="mt-1 text-sm text-[var(--sim-text-secondary)]">
              Consultez l’état en temps réel, vos règlements et l’historique horodaté via votre lien personnel sécurisé.
            </p>
          </div>

          {loading ? (
            <div className="h-64 rounded-[var(--sim-radius-xl)] sim-skeleton" />
          ) : order ? (
            <div className="space-y-6">
              <div className="rounded-[var(--sim-radius-xl)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--sim-border-hairline)] pb-4">
                  <div>
                    <p className="text-xs text-[var(--sim-text-muted)]">
                      Commande passée le {new Date(order.createdAt).toLocaleString('fr-FR')}
                    </p>
                    <h2 className="mt-1 font-display text-2xl font-bold text-[var(--sim-text-primary)] font-mono-nums">
                      {order.orderNumber}
                    </h2>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {order.quoteThreadToken && (
                      <button
                        type="button"
                        onClick={() => onOpenThread(order.quoteThreadToken!)}
                        className="sim-btn-primary py-2 px-3"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span>Messagerie vendeur</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        if (!trackingToken) return;
                        const url = `${window.location.origin}/?suivi=${trackingToken}`;
                        navigator.clipboard?.writeText(url).then(
                          () => onToast('success', 'Lien copié dans le presse-papiers'),
                          () => undefined
                        );
                      }}
                      className="sim-btn-secondary py-2 px-3"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copier le lien</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => trackingToken && loadOrder(trackingToken)}
                      className="sim-btn-secondary py-2 px-3"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Actualiser</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleRegenerateToken}
                      className="sim-btn-secondary py-2 px-3 text-[var(--sim-accent-600)]"
                    >
                      <span>Régénérer le lien sécurisé</span>
                    </button>
                  </div>
                </div>

                {/* Rail d'avancement visuel (4 jalons logistiques) */}
                {(() => {
                  const { isTerminalNegative, latestStatus, rank } = computeOrderProgressRank(
                    events as Array<{ status: OrderEventStatus }>,
                    order.paymentStatus
                  );
                  if (isTerminalNegative) {
                    return (
                      <div className="mt-4 rounded-[var(--sim-radius-md)] bg-[var(--sim-error-bg)] px-4 py-3 text-xs font-semibold text-[var(--sim-error-text)]">
                        Statut actuel : {EVENT_LABELS[latestStatus] || latestStatus}
                      </div>
                    );
                  }
                  const firstStepLabel =
                    order.paymentMode === 'deposit'
                      ? 'Acompte payé'
                      : order.paymentMode === 'quote'
                      ? 'Devis validé'
                      : order.paymentMode === 'bank_transfer'
                      ? 'Virement confirmé'
                      : 'Payée';
                  return (
                    <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {[firstStepLabel, 'En préparation', 'Expédiée', 'Livrée'].map((label, idx) => (
                        <div
                          key={label}
                          className={`rounded-[var(--sim-radius-sm)] border px-3 py-2 text-xs font-semibold ${
                            idx <= rank
                              ? 'border-[var(--sim-accent-500)] bg-[var(--sim-accent-50)] text-[var(--sim-accent-700)]'
                              : 'border-[var(--sim-border-hairline)] bg-[var(--sim-bg-subtle)] text-[var(--sim-text-muted)]'
                          }`}
                        >
                          {idx + 1}. {label}
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* Bannière de règlement en attente : Jumia / Virement / Devis */}
                {order.paymentStatus === 'pending' && order.paymentMode === 'quote' && (
                  <div className="mt-4 rounded-[var(--sim-radius-md)] border border-[var(--sim-border-strong)] bg-[var(--sim-bg-subtle)] p-4 space-y-3 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-[var(--sim-text-primary)]">
                        Demande de devis personnalisée — Régler lorsque le tarif vous convient :
                      </span>
                      <span className="font-mono-nums font-bold text-[var(--sim-accent-700)]">
                        Montant actuel : {formatCurrency(order.totalAmount, currency)}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={quotePayMode}
                        onChange={(e) => setQuotePayMode(e.target.value as 'full' | 'deposit' | 'bank_transfer')}
                        className="sim-input text-xs py-1.5 w-auto"
                      >
                        <option value="full">Paiement intégral (100%)</option>
                        <option value="deposit">Acompte ({settings.defaultDepositPercent}%)</option>
                        {order.totalAmount >= settings.bankTransferThreshold && (order.vendorBankDetails?.length ?? 0) > 0 && (
                          <option value="bank_transfer">Virement bancaire</option>
                        )}
                      </select>
                      {quotePayMode !== 'bank_transfer' ? (
                        <select
                          value={quotePayMethod}
                          onChange={(e) => setQuotePayMethod(e.target.value as PaymentMethodId)}
                          className="sim-input text-xs py-1.5 w-auto"
                        >
                          {rg08Methods.map((m) => (
                            <option key={m} value={m}>
                              {PAYMENT_METHOD_LABELS[m] || m}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={quoteBankRef}
                          onChange={(e) => setQuoteBankRef(e.target.value)}
                          placeholder="Référence virement (facultatif)"
                          className="sim-input text-xs py-1.5 w-56 font-mono"
                        />
                      )}
                      <button
                        type="button"
                        disabled={settlingQuote}
                        onClick={handlePayQuote}
                        className="rounded-[var(--sim-radius-sm)] bg-[var(--sim-accent-500)] px-3.5 py-2 font-semibold text-white whitespace-nowrap"
                      >
                        {settlingQuote ? 'Traitement...' : 'Régler ce devis'}
                      </button>
                    </div>
                  </div>
                )}

                {order.paymentStatus === 'pending' && order.paymentMode === 'bank_transfer' && (
                  <div className="mt-4 rounded-[var(--sim-radius-md)] bg-[var(--sim-warning-bg)] p-4 text-xs text-[var(--sim-warning-text)] space-y-2">
                    <p className="font-semibold">
                      En attente de validation du virement bancaire par le vendeur.
                      {order.bankTransferRef ? ` Référence déclarée : ${order.bankTransferRef}` : ''}
                    </p>
                  </div>
                )}

                {order.paymentStatus === 'pending' &&
                  order.paymentMode !== 'quote' &&
                  order.paymentMode !== 'bank_transfer' && (
                    <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-[var(--sim-radius-md)] bg-[var(--sim-warning-bg)] p-4 text-xs text-[var(--sim-warning-text)]">
                      <span>
                        Cette commande est en attente de règlement Jumia Africa (expiration automatique le{' '}
                        {order.expiresAt ? new Date(order.expiresAt).toLocaleString('fr-FR') : '—'}).
                      </span>
                      <button
                        type="button"
                        onClick={handleResumePayment}
                        className="rounded-[var(--sim-radius-sm)] bg-[var(--sim-accent-500)] px-3.5 py-2 font-semibold text-white whitespace-nowrap"
                      >
                        Finaliser le paiement maintenant
                      </button>
                    </div>
                  )}

                {order.vendorBankDetails && order.vendorBankDetails.length > 0 && order.paymentMode === 'bank_transfer' && (
                  <div className="mt-4 rounded-[var(--sim-radius-md)] border border-[var(--sim-border-strong)] bg-[var(--sim-bg-subtle)] p-4 text-xs space-y-2">
                    <p className="font-bold text-[var(--sim-text-primary)] flex items-center gap-1.5">
                      <Landmark className="w-4 h-4 text-[var(--sim-accent-600)]" />
                      <span>Coordonnées bancaires vendeur pour le virement</span>
                    </p>
                    {order.vendorBankDetails.map((vb) => (
                      <div key={vb.shopId} className="space-y-0.5 pt-1 border-t border-[var(--sim-border-hairline)]">
                        <p className="font-semibold text-[var(--sim-text-primary)]">
                          {vb.shopName} · {vb.bankDetails.bankName} ({vb.bankDetails.accountHolder})
                        </p>
                        <p className="font-mono text-[11px] text-[var(--sim-text-primary)]">
                          IBAN : {vb.bankDetails.iban}
                          {vb.bankDetails.swiftBic ? ` · BIC : ${vb.bankDetails.swiftBic}` : ''}
                        </p>
                        {vb.bankDetails.instructions && (
                          <p className="text-[11px] text-[var(--sim-text-secondary)]">{vb.bankDetails.instructions}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-5 text-sm">
                  <div>
                    <p className="text-xs font-semibold text-[var(--sim-text-muted)]">Destinataire</p>
                    <p className="mt-1 font-medium text-[var(--sim-text-primary)]">{order.buyerName}</p>
                    <p className="text-xs text-[var(--sim-text-secondary)]">{order.buyerEmail}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-[var(--sim-text-muted)]">Adresse de livraison</p>
                    <p className="mt-1 text-xs text-[var(--sim-text-primary)]">{order.shippingAddress}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-[var(--sim-text-muted)]">
                      Total ({PAYMENT_MODE_LABELS[order.paymentMode || 'full'] || order.paymentMode} ·{' '}
                      {PAYMENT_STATUS_LABELS[order.paymentStatus] || order.paymentStatus})
                    </p>
                    <p className="mt-1 font-mono-nums text-lg font-bold text-[var(--sim-text-primary)]">
                      {formatCurrency(order.totalAmount, currency)}
                    </p>
                    {(order.paidAmount !== undefined || order.balanceDue !== undefined) && (
                      <p className="mt-0.5 font-mono-nums text-xs text-[var(--sim-text-secondary)]">
                        Réglé : {formatCurrency(order.paidAmount ?? 0, currency)} · Restant :{' '}
                        <strong>{formatCurrency(order.balanceDue ?? 0, currency)}</strong>
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Historique strictement horodaté (EXF-406) */}
              <div className="rounded-[var(--sim-radius-xl)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-6">
                <h3 className="font-display text-lg font-bold text-[var(--sim-text-primary)]">
                  Historique horodaté des événements
                </h3>
                <ol className="mt-5 space-y-4">
                  {events.map((ev, i) => (
                    <li key={ev.id} className="flex items-start gap-3.5">
                      <div
                        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                          i === events.length - 1
                            ? 'bg-[var(--sim-accent-500)] text-white'
                            : 'bg-[var(--sim-bg-subtle)] text-[var(--sim-text-secondary)]'
                        }`}
                      >
                        {ev.status === 'livree' ? <CheckCircle2 className="w-4 h-4" /> : <Clock className="w-3.5 h-3.5" />}
                      </div>
                      <div className="flex-1 border-b border-[var(--sim-border-hairline)] pb-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-[var(--sim-text-primary)]">
                            {EVENT_LABELS[ev.status] || ev.status}
                          </span>
                          <span className="font-mono-nums text-xs text-[var(--sim-text-muted)]">
                            {new Date(ev.createdAt).toLocaleString('fr-FR')}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-[var(--sim-text-secondary)]">
                          {ev.note} · Par {ev.actor}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>

              {/* Articles commandés + Dépôt d'avis après livraison (EXF-603) */}
              <div className="rounded-[var(--sim-radius-xl)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-6 space-y-4">
                <h3 className="font-display text-lg font-bold text-[var(--sim-text-primary)]">
                  Articles de la commande
                </h3>
                {items.map((it) => (
                  <div
                    key={it.id}
                    className="rounded-[var(--sim-radius-md)] border border-[var(--sim-border-hairline)] p-4 space-y-3"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <p className="text-xs text-[var(--sim-text-muted)]">{it.shopName}</p>
                        <p className="text-sm font-semibold text-[var(--sim-text-primary)]">
                          {it.productTitle} {it.variantLabel ? `(${it.variantLabel})` : ''} × {it.quantity}
                        </p>
                        {it.customSpecs && (
                          <div className="mt-1.5 rounded bg-[var(--sim-bg-subtle)] px-2.5 py-1.5 text-xs text-[var(--sim-text-secondary)] space-y-0.5">
                            <p className="font-semibold text-[var(--sim-accent-700)]">Spécifications personnalisées :</p>
                            {it.customSpecs.dimensions && <p>Dimensions : {it.customSpecs.dimensions}</p>}
                            {it.customSpecs.technicalSpecs && <p>Spécificités : {it.customSpecs.technicalSpecs}</p>}
                            {it.customSpecs.notes && <p>Notes : {it.customSpecs.notes}</p>}
                          </div>
                        )}
                        {it.carrier && (
                          <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-[var(--sim-accent-600)]">
                            <Truck className="w-3.5 h-3.5" />
                            Transporteur : {it.carrier} {it.trackingNumber ? `· N° ${it.trackingNumber}` : ''}
                          </p>
                        )}
                      </div>
                      <span className="font-mono-nums text-sm font-bold text-[var(--sim-text-primary)]">
                        {formatCurrency(it.unitPrice * it.quantity, currency)}
                      </span>
                    </div>

                    {canReview && !it.alreadyReviewed && (
                      <div className="border-t border-[var(--sim-border-hairline)] pt-3 space-y-2.5">
                        <p className="text-xs font-semibold text-[var(--sim-text-primary)]">
                          Votre commande est livrée : notez cet équipement
                        </p>
                        <div className="flex items-center gap-1">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <button
                              key={star}
                              type="button"
                              aria-label={`Note ${star} sur 5`}
                              onClick={() => setReviewRating((r) => ({ ...r, [it.productId]: star }))}
                              className="p-1"
                            >
                              <Star
                                className={`w-5 h-5 ${
                                  (reviewRating[it.productId] || 5) >= star
                                    ? 'fill-amber-400 text-amber-400'
                                    : 'text-[var(--sim-border-strong)]'
                                }`}
                              />
                            </button>
                          ))}
                        </div>
                        <textarea
                          rows={2}
                          placeholder="Partagez votre avis authentique sur ce matériel..."
                          value={reviewComment[it.productId] || ''}
                          onChange={(e) => setReviewComment((c) => ({ ...c, [it.productId]: e.target.value }))}
                          className="sim-input"
                        />
                        <button
                          type="button"
                          onClick={() => handleSubmitReview(it.productId)}
                          className="sim-btn-primary"
                        >
                          Publier mon avis vérifié
                        </button>
                      </div>
                    )}

                    {it.alreadyReviewed && (
                      <p className="text-xs font-medium text-[var(--sim-success-text)]">
                        Avis vérifié déjà publié pour cet article.
                      </p>
                    )}
                  </div>
                ))}
              </div>
              {recentOrders.length > 0 && (
                <div className="flex justify-start">
                  <button
                    type="button"
                    onClick={() => onUpdateTrackingToken(null)}
                    className="text-xs font-semibold text-[var(--sim-accent-600)] hover:underline"
                  >
                    ← Retour à mes commandes récentes ({recentOrders.length})
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              {recentOrders.length > 0 && (
                <div className="rounded-[var(--sim-radius-xl)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-6 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Clock className="w-5 h-5 text-[var(--sim-accent-500)]" />
                      <h2 className="font-display text-lg font-bold text-[var(--sim-text-primary)]">
                        Vos commandes récentes sur cet appareil
                      </h2>
                    </div>
                    <span className="text-xs text-[var(--sim-text-muted)]">Sans création de compte</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {recentOrders.map((rec) => (
                      <button
                        key={rec.orderNumber}
                        type="button"
                        onClick={() => onUpdateTrackingToken(rec.trackingToken)}
                        className="flex items-center justify-between gap-3 rounded-[var(--sim-radius-md)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-subtle)] p-3.5 text-left hover:border-[var(--sim-accent-500)] transition-colors"
                      >
                        <div className="min-w-0">
                          <p className="font-mono-nums text-sm font-bold text-[var(--sim-text-primary)]">
                            {rec.orderNumber}
                          </p>
                          <p className="text-[11px] text-[var(--sim-text-secondary)]">
                            {PAYMENT_MODE_LABELS[rec.paymentMode] || rec.paymentMode} ·{' '}
                            {new Date(rec.createdAt).toLocaleDateString('fr-FR')}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-mono-nums text-xs font-bold text-[var(--sim-text-primary)]">
                            {formatCurrency(rec.totalAmount, currency)}
                          </p>
                          <span className="text-[11px] font-semibold text-[var(--sim-accent-600)]">Suivre →</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="rounded-[var(--sim-radius-xl)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-6">
                  <div className="flex items-center gap-2">
                    <PackageCheck className="w-5 h-5 text-[var(--sim-accent-500)]" />
                    <h2 className="font-display text-lg font-bold text-[var(--sim-text-primary)]">
                      Consulter avec un lien ou jeton de suivi
                    </h2>
                  </div>
                  {errorMsg && (
                    <p className="mt-3 rounded bg-[var(--sim-error-bg)] p-3 text-xs text-[var(--sim-error-text)]">
                      {errorMsg}
                    </p>
                  )}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const extracted = extractTrackingTokenFromInput(manualTokenInput);
                      if (extracted) {
                        onUpdateTrackingToken(extracted);
                      }
                    }}
                    className="mt-4 space-y-3"
                  >
                    <label htmlFor="manual-track-token" className="block text-xs text-[var(--sim-text-secondary)]">
                      Collez votre lien complet ou votre jeton reçu par courriel :
                    </label>
                    <input
                      id="manual-track-token"
                      value={manualTokenInput}
                      onChange={(e) => setManualTokenInput(e.target.value)}
                      placeholder="https://.../?suivi=eyJ... ou eyJ..."
                      className="sim-input font-mono text-xs"
                    />
                    <button
                      type="submit"
                      className="w-full sim-btn-primary py-2.5"
                    >
                      Afficher le suivi
                    </button>
                  </form>
                </div>

                <div className="rounded-[var(--sim-radius-xl)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-6">
                  <div className="flex items-center gap-2">
                    <MailSearch className="w-5 h-5 text-[var(--sim-accent-500)]" />
                    <h2 className="font-display text-lg font-bold text-[var(--sim-text-primary)]">
                      Lien perdu ? Retrouver vos commandes
                    </h2>
                  </div>
                  <p className="mt-2 text-xs text-[var(--sim-text-secondary)] leading-relaxed">
                    Saisissez l’adresse électronique utilisée lors de votre achat. Vos liens de suivi vous seront renvoyés sans exposer d’information sensible.
                  </p>
                  <form onSubmit={handleRecoverByEmail} className="mt-4 space-y-3">
                    <input
                      type="email"
                      required
                      value={recoverEmail}
                      onChange={(e) => setRecoverEmail(e.target.value)}
                      placeholder="vous@exemple.com"
                      className="sim-input"
                    />
                    <button
                      type="submit"
                      className="w-full sim-btn-secondary py-2.5"
                    >
                      Renvoyer mes liens de suivi
                    </button>
                  </form>
                  {recoverMessage && (
                    <p className="mt-3 rounded bg-[var(--sim-success-bg)] p-3 text-xs text-[var(--sim-success-text)]">
                      {recoverMessage}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

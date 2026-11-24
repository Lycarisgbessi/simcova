import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  X,
  Trash2,
  Plus,
  Minus,
  ShoppingBag,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Copy,
  Landmark,
  FileText,
  MessageSquare,
} from 'lucide-react';
import { api } from '../lib/api';
import {
  allCartShopsHaveBankDetails,
  computePaymentBreakdown,
  estimateCartTotals,
  formatCurrency,
} from '../shared/rulesEngine';
import {
  ALL_PAYMENT_METHODS,
  DEFAULT_DELIVERY_ZONES,
  DEFAULT_PAYMENT_METHODS,
  PAYMENT_METHOD_CATALOG,
} from '../shared/constants';
import { useEscapeKey } from '../hooks/useEscapeKey';
import type {
  CartItem,
  DeliveryZoneFee,
  PaymentMethodId,
  PaymentMode,
  PlatformRule,
  PlatformSettings,
  RuleId,
  Shop,
  VendorBankCoordinate,
} from '../shared/types';

interface CartCheckoutDrawerProps {
  open: boolean;
  items: CartItem[];
  rules: Record<RuleId, PlatformRule>;
  settings: PlatformSettings;
  shops: Shop[];
  currency: string;
  onClose: () => void;
  onUpdateQty: (cartKey: string, delta: number) => void;
  onRemoveItem: (cartKey: string) => void;
  onClearCart: () => void;
  onOrderCreated?: (entry: {
    orderNumber: string;
    trackingToken: string;
    totalAmount: number;
    paymentMode: string;
    createdAt: string;
  }) => void;
  onOrderComplete: (trackingToken: string) => void;
  onOpenThread: (threadToken: string) => void;
  onToast: (type: 'success' | 'error' | 'info', title: string, description?: string) => void;
}

export const CartCheckoutDrawer: React.FC<CartCheckoutDrawerProps> = ({
  open,
  items,
  rules,
  settings,
  shops,
  currency,
  onClose,
  onUpdateQty,
  onRemoveItem,
  onClearCart,
  onOrderCreated,
  onOrderComplete,
  onOpenThread,
  onToast,
}) => {
  const [step, setStep] = useState<'cart' | 'guest-form' | 'jumia-gateway' | 'confirmed'>('cart');
  const [deliveryZone, setDeliveryZone] = useState('abidjan');
  const [buyerName, setBuyerName] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [buyerPhone, setBuyerPhone] = useState('');
  const [shippingAddress, setShippingAddress] = useState('');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('full');
  const [bankTransferRef, setBankTransferRef] = useState('');
  // Code promo (validé côté serveur, remise appliquée sur le TTC)
  const [promoInput, setPromoInput] = useState('');
  const [appliedPromo, setAppliedPromo] = useState<{ code: string; discount: number } | null>(null);
  const [promoChecking, setPromoChecking] = useState(false);

  const platformAllowedMethods = useMemo(() => {
    if (rules['RG-08']?.enabled === false) {
      return ALL_PAYMENT_METHODS;
    }
    return (rules['RG-08']?.valueJson?.methods as PaymentMethodId[]) ?? DEFAULT_PAYMENT_METHODS;
  }, [rules]);

  const allowedMethods = useMemo(() => {
    return platformAllowedMethods.filter((method) =>
      items.every((it) => !it.paymentMethods || it.paymentMethods.length === 0 || it.paymentMethods.includes(method))
    );
  }, [platformAllowedMethods, items]);

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodId>(
    allowedMethods[0] || platformAllowedMethods[0] || 'mobile_money_orange'
  );
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (allowedMethods.length > 0 && !allowedMethods.includes(paymentMethod)) {
      setPaymentMethod(allowedMethods[0]);
    }
  }, [allowedMethods, paymentMethod]);

  const [pendingSession, setPendingSession] = useState<{
    orderNumber: string;
    totalAmount: number;
    upfrontAmount: number;
    balanceDue: number;
    depositPercent: number;
    paymentMode: PaymentMode;
    providerRef: string | null;
    environment: string | null;
    trackingToken: string;
    quoteThreadToken: string | null;
    vendorBankDetails: VendorBankCoordinate[];
  } | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  const zones = useMemo<DeliveryZoneFee[]>(
    () => (rules['RG-09']?.valueJson?.zones as DeliveryZoneFee[] | undefined) ?? DEFAULT_DELIVERY_ZONES,
    [rules]
  );

  const defaultFlatFee = Number((rules['RG-09']?.valueJson?.defaultFlatFee as number) ?? 2000);
  // Platform fee rates (0 by default) are applied identically on client estimate and server totals.
  const feeRates = useMemo(
    () => ({
      commissionRatePercent: settings.commissionRatePercent ?? 0,
      vatRatePercent: settings.vatRatePercent ?? 0,
    }),
    [settings.commissionRatePercent, settings.vatRatePercent]
  );
  const zoneTotalsMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const z of zones) {
      map[z.zoneId] = estimateCartTotals({
        items,
        deliveryZoneId: z.zoneId,
        defaultDeliveryFee: defaultFlatFee,
        zoneDefaults: zones,
        ...feeRates,
        discountAmount: appliedPromo?.discount,
      }).deliveryTotal;
    }
    return map;
  }, [items, defaultFlatFee, zones, feeRates, appliedPromo]);

  const totals = useMemo(
    () =>
      estimateCartTotals({
        items,
        deliveryZoneId: deliveryZone,
        defaultDeliveryFee: defaultFlatFee,
        zoneDefaults: zones,
        ...feeRates,
        discountAmount: appliedPromo?.discount,
      }),
    [items, deliveryZone, defaultFlatFee, zones, feeRates, appliedPromo]
  );
  const subtotal = totals.subtotal;
  const estimatedDelivery = totals.deliveryTotal;
  const vatAmount = totals.vatAmount;
  // Buyer-side amount due (VAT-inclusive; equals HT total when VAT is disabled)
  const totalOrderAmount = totals.grandTotal;

  const hasCustomOffer = useMemo(() => items.some((it) => Boolean(it.isCustom)), [items]);
  const cartShopCount = useMemo(() => new Set(items.map((it) => it.shopId)).size, [items]);
  const sellerHasBankDetails = useMemo(
    () =>
      allCartShopsHaveBankDetails(
        items.map((it) => it.shopId),
        shops
      ),
    [items, shops]
  );

  const depositPercent = settings.defaultDepositPercent || 30;
  const bankThreshold = settings.bankTransferThreshold || 5000000;
  const bankTransferEligible = totalOrderAmount >= bankThreshold && sellerHasBankDetails;

  useEffect(() => {
    if (paymentMode === 'quote' && !hasCustomOffer) {
      setPaymentMode('full');
    } else if (paymentMode === 'bank_transfer' && !bankTransferEligible) {
      setPaymentMode('full');
    }
  }, [paymentMode, hasCustomOffer, bankTransferEligible]);

  const breakdown = useMemo(
    () =>
      computePaymentBreakdown({
        totalAmount: totalOrderAmount,
        paymentMode,
        depositPercent,
        hasCustomOffer,
        bankTransferThreshold: bankThreshold,
        sellerHasBankDetails,
      }),
    [totalOrderAmount, paymentMode, depositPercent, hasCustomOffer, bankThreshold, sellerHasBankDetails]
  );

  const handleClose = () => {
    if (step === 'confirmed') setStep('cart');
    onClose();
  };

  // Overlay click never dismisses the drawer mid-gateway: the order already exists
  // server-side and an accidental outside click used to drop the payment panel.
  const handleOverlayClick = () => {
    if (step === 'jumia-gateway') return;
    handleClose();
  };

  useEscapeKey(() => {
    if (!open || step === 'jumia-gateway') return;
    if (step === 'confirmed') setStep('cart');
    onClose();
  }, open);

  const handleApplyPromo = async () => {
    if (!promoInput.trim()) return;
    setPromoChecking(true);
    try {
      const res = await api.validatePromo(promoInput.trim(), totals.grandTotalBeforeDiscount);
      setAppliedPromo({ code: res.code, discount: res.discount });
      onToast('success', 'Code promo appliqué', `Remise de ${formatCurrency(res.discount, currency)} (${res.code}).`);
    } catch (err) {
      setAppliedPromo(null);
      onToast('error', 'Code refusé', err instanceof Error ? err.message : undefined);
    } finally {
      setPromoChecking(false);
    }
  };

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setPaymentError(null);
    try {
      const res = await api.createOrder({
        buyerName,
        buyerEmail,
        buyerPhone: buyerPhone || undefined,
        shippingAddress,
        deliveryZone,
        paymentMode,
        promoCode: appliedPromo?.code,
        paymentMethod: paymentMode === 'full' || paymentMode === 'deposit' ? paymentMethod : undefined,
        bankTransferRef: paymentMode === 'bank_transfer' ? bankTransferRef.trim() || undefined : undefined,
        items: items.map((it) => ({
          productId: it.productId,
          variantId: it.variantId,
          quantity: it.quantity,
          isCustom: it.isCustom,
          customSpecs: it.customSpecs || undefined,
        })),
      });

      const createdMode = (res.order.paymentMode || paymentMode) as PaymentMode;
      const payableTotal = res.order.grandTotal ?? res.order.totalAmount;
      const upfront = createdMode === 'deposit' ? Math.round((payableTotal * (res.order.depositPercent || depositPercent)) / 100) : payableTotal;

      setPendingSession({
        orderNumber: res.order.orderNumber,
        totalAmount: payableTotal,
        upfrontAmount: upfront,
        balanceDue: res.order.balanceDue ?? 0,
        depositPercent: res.order.depositPercent ?? depositPercent,
        paymentMode: createdMode,
        providerRef: res.paymentSession?.providerRef ?? null,
        environment: res.paymentSession?.environment ?? null,
        trackingToken: res.trackingToken,
        quoteThreadToken: res.quoteThreadToken ?? null,
        vendorBankDetails: res.vendorBankDetails ?? [],
      });

      onOrderCreated?.({
        orderNumber: res.order.orderNumber,
        trackingToken: res.trackingToken,
        totalAmount: res.order.totalAmount,
        paymentMode: createdMode,
        createdAt: res.order.createdAt || new Date().toISOString(),
      });

      if (createdMode === 'quote' || createdMode === 'bank_transfer' || !res.paymentSession) {
        onClearCart();
        setStep('confirmed');
        onToast(
          'success',
          createdMode === 'quote' ? 'Demande de devis envoyée' : 'Commande par virement enregistrée',
          `Référence ${res.order.orderNumber} confirmée.`
        );
      } else {
        setStep('jumia-gateway');
      }
    } catch (err) {
      onToast('error', 'Commande impossible', err instanceof Error ? err.message : undefined);
    } finally {
      setSubmitting(false);
    }
  };

  const handleJumiaAction = async (outcome: 'paid' | 'failed' | 'cancelled') => {
    if (!pendingSession?.providerRef) return;
    setSubmitting(true);
    setPaymentError(null);
    try {
      await api.completeSandboxPayment(pendingSession.providerRef, outcome);
      if (outcome === 'paid') {
        onClearCart();
        setStep('confirmed');
        onToast('success', 'Paiement confirmé !', `Commande ${pendingSession.orderNumber} enregistrée.`);
      } else if (outcome === 'failed') {
        setPaymentError(
          'Paiement refusé par l’opérateur Jumia Africa. Votre commande reste en attente : vous pouvez réessayer ou consulter votre lien de suivi.'
        );
      } else {
        setPaymentError(
          'Paiement interrompu. Un lien de reprise vient d’être envoyé à votre adresse électronique.'
        );
      }
    } catch (err) {
      onToast('error', 'Erreur de paiement', err instanceof Error ? err.message : undefined);
    } finally {
      setSubmitting(false);
    }
  };

  const stepIndex = step === 'cart' ? 0 : step === 'guest-form' ? 1 : step === 'jumia-gateway' ? 2 : 3;

  return (
    <AnimatePresence>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Panier et commande sans compte"
          onClick={handleOverlayClick}
          className="fixed inset-0 z-[var(--sim-z-drawer)] flex justify-end bg-black/55 backdrop-blur-[2px]"
        >
          <motion.div
            onClick={(e) => e.stopPropagation()}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            className="flex h-full w-full max-w-lg flex-col bg-[var(--sim-bg-surface)] shadow-[var(--sim-shadow-3)] border-l border-[var(--sim-border-strong)]"
          >
            {/* En-tête acier du tiroir */}
            <div className="bg-[var(--sim-steel-950)] text-white px-6 py-4 border-b border-[var(--sim-steel-800)]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <ShoppingBag className="w-5 h-5 text-[var(--sim-accent-400)]" />
                  <h2 className="font-display text-lg font-bold text-white">
                    {step === 'cart' && `Votre panier (${items.reduce((a, b) => a + b.quantity, 0)})`}
                    {step === 'guest-form' && 'Finaliser la commande'}
                    {step === 'jumia-gateway' && 'Paiement Jumia Africa'}
                    {step === 'confirmed' &&
                      (pendingSession?.paymentMode === 'quote'
                        ? 'Devis transmis au vendeur'
                        : pendingSession?.paymentMode === 'bank_transfer'
                        ? 'Coordonnées de virement'
                        : 'Commande confirmée')}
                  </h2>
                </div>
                <button
                  type="button"
                  aria-label="Fermer le panier"
                  onClick={handleClose}
                  className="p-1.5 text-slate-300 hover:text-white rounded-[var(--sim-radius-sm)] border border-[var(--sim-steel-800)] bg-[var(--sim-steel-900)]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="mt-3.5 grid grid-cols-4 gap-1.5 text-[11px] font-semibold">
                {['1. Panier', '2. Livraison & Mode', '3. Règlement', '4. Confirmé'].map((label, idx) => (
                  <div
                    key={label}
                    className={`border-t-2 pt-1.5 ${
                      idx <= stepIndex
                        ? 'border-[var(--sim-accent-500)] text-white'
                        : 'border-[var(--sim-steel-800)] text-slate-500'
                    }`}
                  >
                    {label}
                  </div>
                ))}
              </div>
            </div>

            {/* Corps scrollable */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {step === 'cart' && (
                <>
                  {items.length === 0 ? (
                    <div className="py-16 text-center">
                      <ShoppingBag className="mx-auto w-10 h-10 text-[var(--sim-text-muted)]" />
                      <p className="mt-4 font-display text-base font-semibold text-[var(--sim-text-primary)]">
                        Votre panier est vide
                      </p>
                      <p className="mt-1 text-sm text-[var(--sim-text-secondary)]">
                        Parcourez le catalogue pour ajouter des articles — aucune inscription requise.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {items.map((item) => {
                        const key = item.cartKey || `${item.productId}::${item.variantId || 'base'}::std`;
                        return (
                          <div
                            key={key}
                            className="flex gap-3.5 border-b border-[var(--sim-border-hairline)] pb-4"
                          >
                            <div className="h-20 w-20 shrink-0 overflow-hidden rounded-[var(--sim-radius-md)] bg-[var(--sim-bg-subtle)]">
                              {item.imageUrl && (
                                <img
                                  src={item.imageUrl}
                                  alt={item.title}
                                  referrerPolicy="no-referrer"
                                  className="h-full w-full object-cover"
                                />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-xs text-[var(--sim-text-muted)] truncate">{item.shopName}</p>
                                {item.isCustom && (
                                  <span className="rounded bg-[var(--sim-accent-50)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--sim-accent-700)] shrink-0">
                                    Sur mesure
                                  </span>
                                )}
                              </div>
                              <h3 className="text-sm font-semibold text-[var(--sim-text-primary)] truncate">
                                {item.title}
                              </h3>
                              {item.variantLabel && (
                                <p className="text-xs text-[var(--sim-text-secondary)]">{item.variantLabel}</p>
                              )}
                              {item.isCustom && item.customSpecs && (
                                <div className="mt-1 rounded bg-[var(--sim-bg-subtle)] px-2 py-1 text-[11px] text-[var(--sim-text-secondary)] space-y-0.5">
                                  {item.customSpecs.dimensions && <p>Dim. : {item.customSpecs.dimensions}</p>}
                                  {item.customSpecs.technicalSpecs && <p>Spéc. : {item.customSpecs.technicalSpecs}</p>}
                                  {item.customSpecs.notes && <p>Note : {item.customSpecs.notes}</p>}
                                </div>
                              )}
                              <div className="mt-2 flex items-center justify-between">
                                <div className="inline-flex items-center rounded border border-[var(--sim-border-strong)]">
                                  <button
                                    type="button"
                                    aria-label={`Diminuer quantité de ${item.title}`}
                                    onClick={() => onUpdateQty(key, -1)}
                                    className="p-1.5 text-[var(--sim-text-secondary)]"
                                  >
                                    <Minus className="w-3 h-3" />
                                  </button>
                                  <span className="px-2.5 font-mono-nums text-xs font-semibold">{item.quantity}</span>
                                  <button
                                    type="button"
                                    aria-label={`Augmenter quantité de ${item.title}`}
                                    onClick={() => onUpdateQty(key, 1)}
                                    className="p-1.5 text-[var(--sim-text-secondary)]"
                                  >
                                    <Plus className="w-3 h-3" />
                                  </button>
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className="font-mono-nums text-sm font-semibold text-[var(--sim-text-primary)]">
                                    {formatCurrency(item.price * item.quantity, currency)}
                                  </span>
                                  <button
                                    type="button"
                                    aria-label={`Supprimer ${item.title}`}
                                    onClick={() => onRemoveItem(key)}
                                    className="text-[var(--sim-text-muted)] hover:text-[var(--sim-error-text)]"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}

                      <div className="pt-2">
                        <label htmlFor="cart-zone" className="sim-label">
                          Zone de livraison
                        </label>
                        <select
                          id="cart-zone"
                          value={deliveryZone}
                          onChange={(e) => setDeliveryZone(e.target.value)}
                          className="sim-input"
                        >
                          {zones.map((z) => (
                            <option key={z.zoneId} value={z.zoneId}>
                              {z.zoneName} — {formatCurrency(zoneTotalsMap[z.zoneId] ?? z.fee, currency)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                </>
              )}

              {step === 'guest-form' && (
                <form id="guest-checkout-form" onSubmit={handleCreateOrder} className="space-y-4">
                  <div className="rounded-[var(--sim-radius-md)] bg-[var(--sim-bg-subtle)] border border-[var(--sim-border-hairline)] p-3.5 text-xs text-[var(--sim-text-secondary)] flex items-start gap-2.5">
                    <ShieldCheck className="w-4 h-4 shrink-0 text-[var(--sim-accent-500)] mt-0.5" />
                    <span>
                      <strong>Aucun compte requis.</strong> Vos échanges avec le vendeur passent obligatoirement par la messagerie sécurisée SIMCOVA.
                    </span>
                  </div>

                  <div>
                    <label htmlFor="guest-name" className="sim-label">
                      Nom complet *
                    </label>
                    <input
                      id="guest-name"
                      required
                      value={buyerName}
                      onChange={(e) => setBuyerName(e.target.value)}
                      placeholder="Ex. Aminata Koné"
                      className="sim-input"
                    />
                  </div>

                  <div>
                    <label htmlFor="guest-email" className="sim-label">
                      Adresse électronique (lien de suivi) *
                    </label>
                    <input
                      id="guest-email"
                      type="email"
                      required
                      value={buyerEmail}
                      onChange={(e) => setBuyerEmail(e.target.value)}
                      placeholder="vous@exemple.com"
                      className="sim-input"
                    />
                  </div>

                  <div>
                    <label htmlFor="guest-phone" className="sim-label">
                      Téléphone (recommandé pour le livreur)
                    </label>
                    <input
                      id="guest-phone"
                      type="tel"
                      value={buyerPhone}
                      onChange={(e) => setBuyerPhone(e.target.value)}
                      placeholder="+225 07..."
                      className="sim-input"
                    />
                  </div>

                  <div>
                    <label htmlFor="guest-address" className="sim-label">
                      Adresse complète de livraison *
                    </label>
                    <textarea
                      id="guest-address"
                      required
                      rows={2}
                      value={shippingAddress}
                      onChange={(e) => setShippingAddress(e.target.value)}
                      placeholder="Quartier, rue, repère..."
                      className="sim-input"
                    />
                  </div>


                  {/* Code promotionnel */}
                  <div className="rounded-[var(--sim-radius-md)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-subtle)] p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-bold text-[var(--sim-text-primary)]">Code promotionnel</p>
                      {appliedPromo && (
                        <button
                          type="button"
                          onClick={() => { setAppliedPromo(null); setPromoInput(''); }}
                          className="text-[11px] font-semibold text-[var(--sim-error-text)] hover:underline"
                        >
                          Retirer {appliedPromo.code}
                        </button>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={promoInput}
                        onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
                        placeholder="Ex. ARRIVAGE10"
                        disabled={Boolean(appliedPromo)}
                        className="sim-input font-mono flex-1"
                      />
                      <button
                        type="button"
                        onClick={handleApplyPromo}
                        disabled={promoChecking || Boolean(appliedPromo) || !promoInput.trim()}
                        className="rounded-[var(--sim-radius-md)] bg-[var(--sim-steel-950)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        {promoChecking ? 'Vérification…' : 'Appliquer'}
                      </button>
                    </div>
                    {appliedPromo && (
                      <p className="text-[11px] font-semibold text-[var(--sim-success-text)]">
                        Remise de {formatCurrency(appliedPromo.discount, currency)} appliquée — nouveau total : {formatCurrency(totals.grandTotal, currency)}
                      </p>
                    )}
                  </div>

                  {/* Option de règlement : Totalité | Acompte | Devis (sur mesure) | Virement bancaire */}
                  <div className="border-t border-[var(--sim-border-hairline)] pt-3">
                    <p className="text-xs font-bold text-[var(--sim-text-primary)] mb-2">
                      Option de règlement *
                    </p>
                    <div className="space-y-2">
                      <label
                        className={`flex items-start gap-2.5 rounded-[var(--sim-radius-md)] border p-3 cursor-pointer ${
                          paymentMode === 'full'
                            ? 'border-[var(--sim-accent-500)] bg-[var(--sim-accent-50)]'
                            : 'border-[var(--sim-border-hairline)]'
                        }`}
                      >
                        <input
                          type="radio"
                          name="paymentMode"
                          checked={paymentMode === 'full'}
                          onChange={() => setPaymentMode('full')}
                          className="mt-0.5 accent-[var(--sim-accent-500)]"
                        />
                        <div className="text-xs">
                          <p className="font-bold text-[var(--sim-text-primary)]">
                            Paiement intégral (100%)
                          </p>
                          <p className="text-[11px] text-[var(--sim-text-secondary)]">
                            Réglez {formatCurrency(totalOrderAmount, currency)} maintenant et recevez votre commande.
                          </p>
                        </div>
                      </label>

                      <label
                        className={`flex items-start gap-2.5 rounded-[var(--sim-radius-md)] border p-3 cursor-pointer ${
                          paymentMode === 'deposit'
                            ? 'border-[var(--sim-accent-500)] bg-[var(--sim-accent-50)]'
                            : 'border-[var(--sim-border-hairline)]'
                        }`}
                      >
                        <input
                          type="radio"
                          name="paymentMode"
                          checked={paymentMode === 'deposit'}
                          onChange={() => setPaymentMode('deposit')}
                          className="mt-0.5 accent-[var(--sim-accent-500)]"
                        />
                        <div className="text-xs">
                          <p className="font-bold text-[var(--sim-text-primary)]">
                            Payer un acompte ({depositPercent}%) + Solde à la livraison
                          </p>
                          <p className="text-[11px] text-[var(--sim-text-secondary)]">
                            Acompte immédiat :{' '}
                            <strong className="font-mono-nums">
                              {formatCurrency(Math.round((totalOrderAmount * depositPercent) / 100), currency)}
                            </strong>{' '}
                            · Solde à la livraison :{' '}
                            <strong className="font-mono-nums">
                              {formatCurrency(
                                totalOrderAmount - Math.round((totalOrderAmount * depositPercent) / 100),
                                currency
                              )}
                            </strong>
                          </p>
                        </div>
                      </label>

                      <label
                        className={`flex items-start gap-2.5 rounded-[var(--sim-radius-md)] border p-3 ${
                          !hasCustomOffer ? 'opacity-55 cursor-not-allowed bg-[var(--sim-bg-subtle)]' : 'cursor-pointer'
                        } ${
                          paymentMode === 'quote'
                            ? 'border-[var(--sim-accent-500)] bg-[var(--sim-accent-50)]'
                            : 'border-[var(--sim-border-hairline)]'
                        }`}
                      >
                        <input
                          type="radio"
                          name="paymentMode"
                          disabled={!hasCustomOffer}
                          checked={paymentMode === 'quote'}
                          onChange={() => setPaymentMode('quote')}
                          className="mt-0.5 accent-[var(--sim-accent-500)]"
                        />
                        <div className="text-xs">
                          <p className="font-bold text-[var(--sim-text-primary)] inline-flex items-center gap-1.5">
                            <FileText className="w-3.5 h-3.5 text-[var(--sim-accent-600)]" />
                            <span>Demande de devis (sans paiement immédiat)</span>
                          </p>
                          <p className="text-[11px] text-[var(--sim-text-secondary)]">
                            {hasCustomOffer
                              ? 'Offre personnalisée détectée : un fil sécurisé SIMCOVA s’ouvre avec le vendeur pour chiffrer votre demande.'
                              : 'Disponible uniquement si au moins un article comporte des dimensions ou spécificités personnalisées.'}
                          </p>
                        </div>
                      </label>

                      <label
                        className={`flex items-start gap-2.5 rounded-[var(--sim-radius-md)] border p-3 ${
                          !bankTransferEligible ? 'opacity-55 cursor-not-allowed bg-[var(--sim-bg-subtle)]' : 'cursor-pointer'
                        } ${
                          paymentMode === 'bank_transfer'
                            ? 'border-[var(--sim-accent-500)] bg-[var(--sim-accent-50)]'
                            : 'border-[var(--sim-border-hairline)]'
                        }`}
                      >
                        <input
                          type="radio"
                          name="paymentMode"
                          disabled={!bankTransferEligible}
                          checked={paymentMode === 'bank_transfer'}
                          onChange={() => setPaymentMode('bank_transfer')}
                          className="mt-0.5 accent-[var(--sim-accent-500)]"
                        />
                        <div className="text-xs">
                          <p className="font-bold text-[var(--sim-text-primary)] inline-flex items-center gap-1.5">
                            <Landmark className="w-3.5 h-3.5 text-[var(--sim-accent-600)]" />
                            <span>Virement bancaire (commandes ≥ {formatCurrency(bankThreshold, currency)})</span>
                          </p>
                          <p className="text-[11px] text-[var(--sim-text-secondary)]">
                            {bankTransferEligible
                              ? 'Affiche les coordonnées bancaires du vendeur et ouvre le fil de discussion sécurisé SIMCOVA.'
                              : totalOrderAmount < bankThreshold
                              ? `Réservé aux commandes d’au moins ${formatCurrency(bankThreshold, currency)}.`
                              : cartShopCount > 1
                              ? 'Toutes les boutiques du panier n’ont pas encore configuré leur RIB/IBAN.'
                              : 'Le vendeur n’a pas encore renseigné de RIB/IBAN.'}
                          </p>
                        </div>
                      </label>
                    </div>
                  </div>

                  {paymentMode === 'bank_transfer' && (
                    <div>
                      <label htmlFor="bank-transfer-ref" className="sim-label">
                        Référence de virement anticipée (facultatif)
                      </label>
                      <input
                        id="bank-transfer-ref"
                        value={bankTransferRef}
                        onChange={(e) => setBankTransferRef(e.target.value)}
                        placeholder="Ex. VIR-2026-0041 (peut être fourni après)"
                        className="sim-input font-mono text-xs"
                      />
                    </div>
                  )}

                  {(paymentMode === 'full' || paymentMode === 'deposit') && (
                    <div>
                      <p className="text-xs font-semibold text-[var(--sim-text-primary)]">
                        Moyen de paiement Jumia Africa *
                      </p>
                      {allowedMethods.length === 0 ? (
                        <div className="mt-2 rounded-[var(--sim-radius-md)] bg-[var(--sim-error-bg)] p-3 text-xs text-[var(--sim-error-text)]">
                          Les articles sélectionnés n’ont aucun mode de paiement en commun. Passez commande séparément par boutique.
                        </div>
                      ) : (
                        <div className="mt-2 space-y-2">
                          {PAYMENT_METHOD_CATALOG.filter((opt) => allowedMethods.includes(opt.id)).map((opt) => (
                            <label
                              key={opt.id}
                              className={`flex items-start gap-3 rounded-[var(--sim-radius-md)] border p-3 cursor-pointer transition-colors ${
                                paymentMethod === opt.id
                                  ? 'border-[var(--sim-accent-500)] bg-[var(--sim-accent-50)]'
                                  : 'border-[var(--sim-border-hairline)] hover:border-[var(--sim-border-strong)]'
                              }`}
                            >
                              <input
                                type="radio"
                                name="paymentMethod"
                                value={opt.id}
                                checked={paymentMethod === opt.id}
                                onChange={() => setPaymentMethod(opt.id)}
                                className="mt-0.5 accent-[var(--sim-accent-500)]"
                              />
                              <div>
                                <p className="text-xs font-semibold text-[var(--sim-text-primary)]">{opt.label}</p>
                                <p className="text-[11px] text-[var(--sim-text-secondary)]">{opt.subtitle}</p>
                              </div>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </form>
              )}

              {step === 'jumia-gateway' && pendingSession && (
                <div className="space-y-5">
                  <div className="rounded-[var(--sim-radius-lg)] border border-[var(--sim-border-strong)] bg-[var(--sim-bg-subtle)] p-5">
                    <div className="flex items-center justify-between text-xs text-[var(--sim-text-muted)]">
                      <span>API Jumia Africa ({pendingSession.environment})</span>
                      <span className="font-mono-nums">{pendingSession.providerRef}</span>
                    </div>
                    <p className="mt-2 font-display text-2xl font-bold text-[var(--sim-text-primary)] font-mono-nums">
                      {formatCurrency(pendingSession.upfrontAmount, currency)}
                    </p>
                    <p className="mt-1 text-xs text-[var(--sim-text-secondary)]">
                      {pendingSession.paymentMode === 'deposit'
                        ? `Acompte de ${pendingSession.depositPercent}% sur un total de ${formatCurrency(
                            pendingSession.totalAmount,
                            currency
                          )} · Solde à la livraison : ${formatCurrency(pendingSession.balanceDue, currency)}`
                        : `Commande ${pendingSession.orderNumber} · Aucune donnée de carte stockée sur SIMCOVA.`}
                    </p>
                  </div>

                  {paymentError && (
                    <div className="flex items-start gap-2.5 rounded-[var(--sim-radius-md)] bg-[var(--sim-error-bg)] p-4 text-xs text-[var(--sim-error-text)]">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold">{paymentError}</p>
                        <button
                          type="button"
                          onClick={() => {
                            handleClose();
                            onOrderComplete(pendingSession.trackingToken);
                          }}
                          className="mt-2 underline font-semibold"
                        >
                          Ouvrir mon lien de suivi et de reprise
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="space-y-2.5">
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => handleJumiaAction('paid')}
                      className="w-full rounded-[var(--sim-radius-md)] bg-[var(--sim-accent-500)] px-4 py-3 text-sm font-semibold text-white hover:bg-[var(--sim-accent-600)] transition-colors disabled:opacity-50"
                    >
                      {submitting
                        ? 'Confirmation webhook...'
                        : pendingSession.paymentMode === 'deposit'
                        ? `Régler l’acompte (${formatCurrency(pendingSession.upfrontAmount, currency)})`
                        : 'Confirmer et payer maintenant'}
                    </button>
                    <div className="grid grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => handleJumiaAction('failed')}
                        className="rounded-[var(--sim-radius-md)] border border-[var(--sim-border-strong)] px-3 py-2 text-xs font-semibold text-[var(--sim-text-secondary)] hover:text-[var(--sim-error-text)]"
                      >
                        Simuler refus paiement
                      </button>
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => handleJumiaAction('cancelled')}
                        className="rounded-[var(--sim-radius-md)] border border-[var(--sim-border-strong)] px-3 py-2 text-xs font-semibold text-[var(--sim-text-secondary)]"
                      >
                        Abandonner / Reporter
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {step === 'confirmed' && pendingSession && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="py-4 space-y-4"
                >
                  <div className="text-center space-y-2">
                    <CheckCircle2 className="mx-auto w-12 h-12 text-[var(--sim-success-text)]" />
                    <h3 className="font-display text-2xl font-bold text-[var(--sim-text-primary)]">
                      {pendingSession.paymentMode === 'quote'
                        ? `Devis ${pendingSession.orderNumber} envoyé !`
                        : pendingSession.paymentMode === 'bank_transfer'
                        ? `Commande ${pendingSession.orderNumber} réservée`
                        : pendingSession.paymentMode === 'deposit'
                        ? `Acompte ${pendingSession.orderNumber} réglé !`
                        : `Merci, commande ${pendingSession.orderNumber} payée !`}
                    </h3>
                    <p className="text-sm text-[var(--sim-text-secondary)] leading-relaxed">
                      {pendingSession.paymentMode === 'quote'
                        ? 'Votre demande personnalisée a été transmise au vendeur. Échangez obligatoirement sur le fil sécurisé SIMCOVA pour finaliser le tarif.'
                        : pendingSession.paymentMode === 'bank_transfer'
                        ? 'Effectuez votre virement vers les coordonnées ci-dessous, puis confirmez via votre messagerie SIMCOVA.'
                        : pendingSession.paymentMode === 'deposit'
                        ? `Acompte de ${formatCurrency(pendingSession.upfrontAmount, currency)} réglé. Solde de ${formatCurrency(
                            pendingSession.balanceDue,
                            currency
                          )} à payer à la livraison.`
                        : `Un courriel vient d’être envoyé à ${buyerEmail} avec votre lien sécurisé de suivi.`}
                    </p>
                  </div>

                  {pendingSession.vendorBankDetails.length > 0 && (
                    <div className="rounded-[var(--sim-radius-md)] border border-[var(--sim-border-strong)] bg-[var(--sim-bg-subtle)] p-4 space-y-3 text-xs">
                      <p className="font-bold text-[var(--sim-text-primary)] flex items-center gap-1.5">
                        <Landmark className="w-4 h-4 text-[var(--sim-accent-600)]" />
                        <span>Coordonnées bancaires du vendeur</span>
                      </p>
                      {pendingSession.vendorBankDetails.map((vb) => (
                        <div key={vb.shopId} className="space-y-1 border-t border-[var(--sim-border-hairline)] pt-2">
                          <p className="font-semibold text-[var(--sim-text-primary)]">
                            {vb.shopName} · {vb.bankDetails.bankName}
                          </p>
                          <p className="text-[var(--sim-text-secondary)]">Titulaire : {vb.bankDetails.accountHolder}</p>
                          <div className="flex items-center justify-between gap-2 rounded bg-[var(--sim-bg-surface)] px-2.5 py-1.5 font-mono text-[11px] border border-[var(--sim-border-hairline)]">
                            <span className="truncate">{vb.bankDetails.iban}</span>
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard?.writeText(vb.bankDetails.iban);
                                onToast('success', 'IBAN copié');
                              }}
                              className="text-[var(--sim-accent-600)] font-semibold shrink-0"
                            >
                              Copier
                            </button>
                          </div>
                          {vb.bankDetails.swiftBic && (
                            <p className="font-mono text-[11px] text-[var(--sim-text-muted)]">
                              BIC/SWIFT : {vb.bankDetails.swiftBic}
                            </p>
                          )}
                          {vb.bankDetails.instructions && (
                            <p className="text-[11px] text-[var(--sim-text-secondary)]">{vb.bankDetails.instructions}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="rounded-[var(--sim-radius-md)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-subtle)] p-4 text-left text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-[var(--sim-text-primary)]">Votre lien personnel de suivi :</p>
                      <button
                        type="button"
                        onClick={() => {
                          const fullUrl = `${window.location.origin}/?suivi=${pendingSession.trackingToken}`;
                          navigator.clipboard?.writeText(fullUrl).then(
                            () => onToast('success', 'Lien de suivi copié'),
                            () => undefined
                          );
                        }}
                        className="inline-flex items-center gap-1 font-semibold text-[var(--sim-accent-600)] hover:underline"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copier</span>
                      </button>
                    </div>
                    <p className="mt-1 font-mono text-[11px] break-all text-[var(--sim-text-secondary)]">
                      /?suivi={pendingSession.trackingToken}
                    </p>
                  </div>

                  <div className="space-y-2">
                    {pendingSession.quoteThreadToken && (
                      <button
                        type="button"
                        onClick={() => {
                          const tok = pendingSession.quoteThreadToken!;
                          handleClose();
                          onOpenThread(tok);
                        }}
                        className="w-full inline-flex items-center justify-center gap-2 rounded-[var(--sim-radius-md)] border border-[var(--sim-border-strong)] bg-[var(--sim-bg-surface)] px-5 py-2.5 text-xs font-bold text-[var(--sim-text-primary)] hover:border-[var(--sim-accent-500)]"
                      >
                        <MessageSquare className="w-4 h-4 text-[var(--sim-accent-500)]" />
                        <span>Ouvrir le fil de discussion sécurisé SIMCOVA</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        const tok = pendingSession.trackingToken;
                        handleClose();
                        onOrderComplete(tok);
                      }}
                      className="w-full inline-flex items-center justify-center gap-2 rounded-[var(--sim-radius-md)] bg-[var(--sim-accent-500)] px-5 py-3 text-sm font-semibold text-white hover:bg-[var(--sim-accent-600)]"
                    >
                      <span>Suivre ma commande en direct</span>
                      <ExternalLink className="w-4 h-4" />
                    </button>
                  </div>
                </motion.div>
              )}
            </div>

            {/* Pied du tiroir avec récapitulatif exact EXF-510 */}
            {(step === 'cart' || step === 'guest-form') && items.length > 0 && (
              <div className="border-t border-[var(--sim-border-hairline)] bg-[var(--sim-bg-subtle)] px-6 py-4 space-y-3">
                <div className="space-y-1 text-xs text-[var(--sim-text-secondary)]">
                  <div className="flex justify-between">
                    <span>Sous-total articles</span>
                    <span className="font-mono-nums font-medium text-[var(--sim-text-primary)]">
                      {formatCurrency(subtotal, currency)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Frais de livraison</span>
                    <span className="font-mono-nums font-medium text-[var(--sim-text-primary)]">
                      {formatCurrency(estimatedDelivery, currency)}
                    </span>
                  </div>
                  {appliedPromo && appliedPromo.discount > 0 && (
                    <div className="flex justify-between text-[var(--sim-success-text)] font-semibold">
                      <span>Remise {appliedPromo.code}</span>
                      <span className="font-mono-nums">-{formatCurrency(appliedPromo.discount, currency)}</span>
                    </div>
                  )}
                  {vatAmount > 0 && (
                    <div className="flex justify-between">
                      <span>dont TVA ({settings.vatRatePercent}%)</span>
                      <span className="font-mono-nums font-medium text-[var(--sim-text-primary)]">
                        {formatCurrency(vatAmount, currency)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between pt-1.5 border-t border-[var(--sim-border-hairline)] text-sm font-bold text-[var(--sim-text-primary)]">
                    <span>Total commande{vatAmount > 0 ? ' (TTC)' : ''}</span>
                    <span className="font-mono-nums">{formatCurrency(totalOrderAmount, currency)}</span>
                  </div>
                  {step === 'guest-form' && paymentMode === 'deposit' && (
                    <div className="flex justify-between text-xs font-bold text-[var(--sim-accent-700)]">
                      <span>Acompte immédiat ({breakdown.depositPercentApplied}%)</span>
                      <span className="font-mono-nums">{formatCurrency(breakdown.upfrontAmount, currency)}</span>
                    </div>
                  )}
                </div>

                {step === 'cart' ? (
                  <button
                    type="button"
                    onClick={() => setStep('guest-form')}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-[var(--sim-radius-md)] bg-[var(--sim-accent-500)] px-5 py-3 text-sm font-semibold text-white hover:bg-[var(--sim-accent-600)] transition-colors"
                  >
                    <span>Commander sans compte</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                ) : (
                  <div className="flex gap-2.5">
                    <button
                      type="button"
                      onClick={() => setStep('cart')}
                      className="rounded-[var(--sim-radius-md)] border border-[var(--sim-border-strong)] bg-[var(--sim-bg-surface)] px-4 py-3 text-xs font-semibold text-[var(--sim-text-primary)]"
                    >
                      Retour
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const form = document.getElementById('guest-checkout-form') as HTMLFormElement | null;
                        form?.requestSubmit();
                      }}
                      disabled={
                        submitting ||
                        ((paymentMode === 'full' || paymentMode === 'deposit') && allowedMethods.length === 0)
                      }
                      className="flex-1 inline-flex items-center justify-center gap-2 rounded-[var(--sim-radius-md)] bg-[var(--sim-accent-500)] px-5 py-3 text-sm font-semibold text-white hover:bg-[var(--sim-accent-600)] disabled:opacity-50"
                    >
                      <span>
                        {submitting
                          ? 'Initialisation...'
                          : paymentMode === 'quote'
                          ? 'Envoyer la demande de devis'
                          : paymentMode === 'bank_transfer'
                          ? 'Afficher le RIB & réserver'
                          : paymentMode === 'deposit'
                          ? `Payer l’acompte (${formatCurrency(breakdown.upfrontAmount, currency)})`
                          : 'Payer via Jumia Africa'}
                      </span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

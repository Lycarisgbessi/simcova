import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  X,
  ShieldCheck,
  Star,
  Truck,
  CreditCard,
  MessageSquare,
  Maximize2,
  Plus,
  Minus,
  Check,
  Send,
  PlayCircle,
  Zap,
  ArrowLeft,
  Sliders,
  ShieldAlert,
} from 'lucide-react';
import { api } from '../lib/api';
import { formatCurrency, hasValidCustomSpecs } from '../shared/rulesEngine';
import { PAYMENT_METHOD_LABELS } from '../shared/constants';
import { useEscapeKey } from '../hooks/useEscapeKey';
import type { CustomSpecs, Product, ReviewItem, Shop } from '../shared/types';

interface ProductDetailModalProps {
  productId: string | null;
  currency: string;
  onClose: () => void;
  onAddToCart: (
    product: Product,
    variantId: string | null,
    variantLabel: string | null,
    price: number,
    qty: number,
    options?: { isCustom?: boolean; customSpecs?: CustomSpecs | null }
  ) => void;
  onBuyNow: (
    product: Product,
    variantId: string | null,
    variantLabel: string | null,
    price: number,
    qty: number,
    options?: { isCustom?: boolean; customSpecs?: CustomSpecs | null }
  ) => void;
  onOpenShop: (slug: string) => void;
  onOpenThread: (token: string) => void;
  onToast: (type: 'success' | 'error' | 'info', title: string, description?: string) => void;
}

export const ProductDetailModal: React.FC<ProductDetailModalProps> = ({
  productId,
  currency,
  onClose,
  onAddToCart,
  onBuyNow,
  onOpenShop,
  onOpenThread,
  onToast,
}) => {
  const [loading, setLoading] = useState(false);
  const [product, setProduct] = useState<Product | null>(null);
  const [shop, setShop] = useState<Shop | null>(null);
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [activeMediaIdx, setActiveMediaIdx] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [selectedZoneId, setSelectedZoneId] = useState<string>('');
  const [qty, setQty] = useState(1);

  // Two ordering options: standard ("Commander tel quel") vs custom ("Offre personnalisée")
  const [orderOptionMode, setOrderOptionMode] = useState<'standard' | 'custom'>('standard');
  const [customDimensions, setCustomDimensions] = useState('');
  const [customTechnicalSpecs, setCustomTechnicalSpecs] = useState('');
  const [customNotes, setCustomNotes] = useState('');

  // Contact seller disclosure state
  const [contactOpen, setContactOpen] = useState(false);
  const [buyerName, setBuyerName] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [msgBody, setMsgBody] = useState('');
  const [sendingMsg, setSendingMsg] = useState(false);
  const [createdThreadToken, setCreatedThreadToken] = useState<string | null>(null);

  useEscapeKey(() => {
    if (lightboxOpen) {
      setLightboxOpen(false);
      setZoomed(false);
    } else {
      onClose();
    }
  }, Boolean(productId));

  useEffect(() => {
    if (!productId) {
      setProduct(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setActiveMediaIdx(0);
    setQty(1);
    setOrderOptionMode('standard');
    setCustomDimensions('');
    setCustomTechnicalSpecs('');
    setCustomNotes('');
    setContactOpen(false);
    setCreatedThreadToken(null);
    setSelectedZoneId('');

    api
      .getProduct(productId)
      .then((res) => {
        if (cancelled) return;
        setProduct(res.product);
        setShop(res.shop);
        setReviews(res.reviews);
        setSelectedVariantId(
          res.product.variants.find((v) => v.stock > 0)?.id ?? res.product.variants[0]?.id ?? null
        );
        setSelectedZoneId(res.product.deliveryZones[0]?.zoneId ?? '');
      })
      .catch((err) => {
        if (!cancelled) {
          onToast('error', 'Produit indisponible', err instanceof Error ? err.message : undefined);
          onClose();
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [productId, onClose, onToast]);

  const ratingHistogram = useMemo(() => {
    const counts: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    for (const r of reviews) {
      const k = Math.max(1, Math.min(5, Math.round(r.rating)));
      counts[k] = (counts[k] || 0) + 1;
    }
    return counts;
  }, [reviews]);

  if (!productId) return null;

  const activeVariant = product?.variants.find((v) => v.id === selectedVariantId) ?? null;
  const activeZone = product?.deliveryZones.find((z) => z.zoneId === selectedZoneId) ?? null;
  const activeDeliveryFee = activeZone?.fee ?? product?.deliveryFee ?? 0;
  const activePrice = activeVariant?.priceOverride ?? product?.price ?? 0;
  const maxStock = activeVariant ? activeVariant.stock : product?.stock ?? 0;
  const isCertified = shop?.vendorStatus === 'certifie' || shop?.badges?.includes('Vendeur certifié');

  const mediaSlides = product
    ? [
        ...product.media.map((m) => ({ url: m.url, type: m.type, alt: m.alt })),
        ...(product.videoUrl ? [{ url: product.videoUrl, type: 'video' as const, alt: product.title }] : []),
      ]
    : [];
  const currentSlide = mediaSlides[activeMediaIdx];

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!product || !shop) return;
    setSendingMsg(true);
    try {
      const res = await api.sendContactMessage({
        productId: product.id,
        shopId: shop.id,
        buyerName,
        buyerEmail,
        body: msgBody,
      });
      setCreatedThreadToken(res.threadToken);
      setMsgBody('');
      onToast('success', 'Message envoyé au vendeur', 'Aucun compte requis : suivez la réponse via votre lien sécurisé.');
    } catch (err) {
      onToast('error', 'Échec d’envoi', err instanceof Error ? err.message : undefined);
    } finally {
      setSendingMsg(false);
    }
  };

  return (
    <AnimatePresence>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={product?.title || 'Fiche technique'}
        onClick={onClose}
        className="fixed inset-0 z-[var(--sim-z-modal)] flex items-center justify-center bg-black/65 backdrop-blur-[2px] p-2 sm:p-5 overflow-y-auto"
      >
        <motion.div
          onClick={(e) => e.stopPropagation()}
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.98 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="sim-modal-mobile relative my-auto w-full max-w-[1260px] max-h-[92vh] overflow-y-auto rounded-[var(--sim-radius-lg)] bg-[var(--sim-bg-surface)] shadow-[var(--sim-shadow-3)] border border-[var(--sim-border-strong)]"
        >
          {/* En-tête navigation Amazon/Alibaba */}
          <div className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-[var(--sim-steel-800)] bg-[var(--sim-steel-900)] px-5 py-3 text-white">
            <div className="flex items-center gap-3 text-xs font-semibold text-slate-200 min-w-0 truncate">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center gap-1 text-[#F59E0B] hover:underline shrink-0"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Retour</span>
              </button>
              <span aria-hidden="true" className="text-slate-500">›</span>
              <span className="truncate font-medium">{product?.categoryName || 'Fiche matériel'}</span>
              {shop && (
                <>
                  <span aria-hidden="true" className="text-slate-500 hidden sm:inline">›</span>
                  <span className="text-slate-300 truncate hidden sm:inline">{shop.name}</span>
                </>
              )}
            </div>
            <button
              type="button"
              aria-label="Fermer la fiche technique"
              onClick={onClose}
              className="inline-flex items-center gap-1.5 rounded-[var(--sim-radius-sm)] border border-[var(--sim-steel-800)] bg-[var(--sim-steel-950)] px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:border-[#F59E0B] hover:text-white transition-colors shrink-0"
            >
              <X className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Fermer</span>
            </button>
          </div>

          {loading || !product ? (
            <div className="p-6 sm:p-8 grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-5 aspect-[4/3] rounded-[var(--sim-radius-md)] sim-skeleton" />
              <div className="lg:col-span-4 space-y-4">
                <div className="h-4 w-1/3 rounded sim-skeleton" />
                <div className="h-8 w-4/5 rounded sim-skeleton" />
                <div className="h-24 w-full rounded sim-skeleton" />
              </div>
              <div className="lg:col-span-3 h-72 rounded-[var(--sim-radius-md)] sim-skeleton" />
            </div>
          ) : (
            <div className="p-4 sm:p-6 pb-24 md:pb-8 space-y-8">
              {/* Architecture PDP 3 colonnes : Galerie verticale | Fiche technique | Buy Box */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* Colonne 1 : Galerie style Amazon (vignettes verticales à gauche + grande scène) */}
                <div className="lg:col-span-5 flex flex-col-reverse sm:flex-row gap-3">
                  {mediaSlides.length > 1 && (
                    <div className="flex sm:flex-col gap-2 overflow-x-auto sm:overflow-visible pb-1 sm:pb-0">
                      {mediaSlides.map((slide, idx) => (
                        <button
                          key={`${slide.url}-${idx}`}
                          type="button"
                          onClick={() => setActiveMediaIdx(idx)}
                          aria-label={`Afficher média ${idx + 1}`}
                          className={`relative h-14 w-16 sm:h-16 sm:w-16 shrink-0 overflow-hidden rounded-[var(--sim-radius-sm)] border-2 transition-all ${
                            activeMediaIdx === idx
                              ? 'border-[var(--sim-accent-500)] shadow-sm'
                              : 'border-[var(--sim-border-hairline)] opacity-75 hover:opacity-100'
                          }`}
                        >
                          {slide.type === 'video' ? (
                            <div className="flex h-full w-full items-center justify-center bg-[#131921] text-white">
                              <PlayCircle className="w-5 h-5" />
                            </div>
                          ) : (
                            <img
                              src={slide.url}
                              alt={slide.alt}
                              referrerPolicy="no-referrer"
                              className="h-full w-full object-cover"
                            />
                          )}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="relative flex-1 aspect-[4/3] w-full overflow-hidden rounded-[var(--sim-radius-md)] bg-[var(--sim-bg-subtle)] border border-[var(--sim-border-hairline)]">
                    {currentSlide?.type === 'video' ? (
                      <video
                        src={currentSlide.url}
                        controls
                        className="h-full w-full object-cover"
                      />
                    ) : currentSlide?.url ? (
                      <motion.img
                        key={currentSlide.url}
                        src={currentSlide.url}
                        alt={currentSlide.alt}
                        referrerPolicy="no-referrer"
                        initial={{ opacity: 0.35 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.2 }}
                        onClick={() => setLightboxOpen(true)}
                        className="h-full w-full object-cover cursor-zoom-in"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-sm text-[var(--sim-text-muted)]">
                        Aperçu matériel
                      </div>
                    )}

                    {currentSlide?.type === 'image' && (
                      <button
                        type="button"
                        aria-label="Agrandir l’image en plein écran"
                        onClick={() => setLightboxOpen(true)}
                        className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-[var(--sim-radius-sm)] bg-[#131921]/90 px-2.5 py-1.5 text-xs font-semibold text-white shadow-[var(--sim-shadow-1)]"
                      >
                        <Maximize2 className="w-3.5 h-3.5" />
                        <span>Zoom</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Colonne 2 : Spécifications, options & description */}
                <div className="lg:col-span-4 space-y-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-[var(--sim-text-muted)]">
                      {shop && (
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            onOpenShop(shop.slug);
                          }}
                          className="text-[#007185] dark:text-sky-400 hover:underline font-bold"
                        >
                          Boutique {shop.name}
                        </button>
                      )}
                      {isCertified && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-1 text-[var(--sim-success-text)]">
                            <ShieldCheck className="w-3.5 h-3.5" />
                            Concessionnaire certifié
                          </span>
                        </>
                      )}
                    </div>

                    <h2 className="mt-1.5 font-display text-2xl font-bold tracking-tight text-[var(--sim-text-primary)] leading-tight">
                      {product.title}
                    </h2>

                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                      {reviews.length > 0 ? (
                        <a
                          href="#pdp-reviews-section"
                          className="inline-flex items-center gap-1 font-semibold text-[#007185] dark:text-sky-400 hover:underline tabular-nums"
                        >
                          <Star className="w-3.5 h-3.5 fill-amber-500 text-amber-500" />
                          <span>{product.ratingAverage.toFixed(1)} sur 5</span>
                          <span className="text-[var(--sim-text-muted)]">({reviews.length} avis vérifié{reviews.length > 1 ? 's' : ''})</span>
                        </a>
                      ) : (
                        <span className="text-[var(--sim-text-muted)]">Nouvelle référence sur le parc</span>
                      )}
                    </div>
                  </div>

                  <div className="border-t border-[var(--sim-border-hairline)] pt-3 grid grid-cols-2 gap-2.5 text-xs">
                    <div className="rounded-[var(--sim-radius-sm)] bg-[var(--sim-bg-subtle)] px-3 py-2">
                      <span className="text-[var(--sim-text-muted)]">État matériel</span>
                      <p className="font-bold text-[var(--sim-text-primary)] mt-0.5">{product.condition}</p>
                    </div>
                    <div className="rounded-[var(--sim-radius-sm)] bg-[var(--sim-bg-subtle)] px-3 py-2">
                      <span className="text-[var(--sim-text-muted)]">Expédition habituelle</span>
                      <p className="font-bold text-[var(--sim-text-primary)] mt-0.5">{product.deliveryDelay}</p>
                    </div>
                  </div>

                  {/* Variantes / Configurations */}
                  {product.variants.length > 0 && (
                    <div className="border-t border-[var(--sim-border-hairline)] pt-3">
                      <p className="sim-label">Option / Déclinaison</p>
                      <div className="flex flex-wrap gap-2">
                        {product.variants.map((v) => (
                          <button
                            key={v.id}
                            type="button"
                            disabled={v.stock <= 0}
                            onClick={() => setSelectedVariantId(v.id)}
                            className={`rounded-[var(--sim-radius-sm)] border px-3 py-1.5 text-xs font-semibold transition-colors ${
                              selectedVariantId === v.id
                                ? 'border-[var(--sim-accent-500)] bg-[var(--sim-accent-50)] text-[var(--sim-accent-700)]'
                                : 'border-[var(--sim-border-strong)] bg-[var(--sim-bg-surface)] text-[var(--sim-text-primary)] hover:border-[var(--sim-text-primary)]'
                            } disabled:opacity-40`}
                          >
                            {v.label}
                            {v.priceOverride ? ` (${formatCurrency(v.priceOverride, currency)})` : ''}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="border-t border-[var(--sim-border-hairline)] pt-3">
                    <p className="sim-label">À propos de cet équipement</p>
                    <p className="text-sm text-[var(--sim-text-secondary)] leading-relaxed">
                      {product.description}
                    </p>
                  </div>

                  <div className="border-t border-[var(--sim-border-hairline)] pt-3 text-xs text-[var(--sim-text-secondary)] flex items-start gap-2">
                    <CreditCard className="w-4 h-4 shrink-0 text-[var(--sim-accent-500)] mt-0.5" />
                    <div>
                      <p className="font-semibold text-[var(--sim-text-primary)]">Paiements Jumia Africa acceptés</p>
                      <p className="mt-0.5">{product.paymentMethods.map((m) => PAYMENT_METHOD_LABELS[m] || m).join(' · ')}</p>
                    </div>
                  </div>
                </div>

                {/* Colonne 3 : "Buy Box" avec Option Standard vs Sur Mesure */}
                <div className="lg:col-span-3">
                  <div className="rounded-[var(--sim-radius-md)] border border-[var(--sim-border-strong)] bg-[var(--sim-bg-surface)] p-4 shadow-[var(--sim-shadow-1)] space-y-3.5">
                    <div>
                      <p className="font-mono-nums text-2xl font-bold text-[var(--sim-text-primary)]">
                        {formatCurrency(activePrice, currency)}
                      </p>
                      <p className={`mt-1 text-xs font-bold ${maxStock > 0 ? 'text-[var(--sim-success-text)]' : 'text-[var(--sim-error-text)]'}`}>
                        {maxStock > 0
                          ? `En stock (${maxStock} unité${maxStock > 1 ? 's' : ''})`
                          : 'Rupture de stock'}
                      </p>
                    </div>

                    {/* Choix des 2 options : Standard ou Offre personnalisée */}
                    <div className="border-t border-[var(--sim-border-hairline)] pt-3 space-y-2">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--sim-text-muted)]">
                        Configuration de commande
                      </p>
                      <div role="group" aria-label="Mode de configuration" className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          onClick={() => setOrderOptionMode('standard')}
                          aria-pressed={orderOptionMode === 'standard'}
                          className={`rounded-[var(--sim-radius-sm)] border px-2 py-2 text-[11px] font-bold transition-colors ${
                            orderOptionMode === 'standard'
                              ? 'border-[var(--sim-accent-500)] bg-[var(--sim-accent-50)] text-[var(--sim-accent-700)]'
                              : 'border-[var(--sim-border-strong)] bg-[var(--sim-bg-surface)] text-[var(--sim-text-secondary)]'
                          }`}
                        >
                          Commander tel quel
                        </button>
                        <button
                          type="button"
                          onClick={() => setOrderOptionMode('custom')}
                          aria-pressed={orderOptionMode === 'custom'}
                          className={`inline-flex items-center justify-center gap-1 rounded-[var(--sim-radius-sm)] border px-2 py-2 text-[11px] font-bold transition-colors ${
                            orderOptionMode === 'custom'
                              ? 'border-[var(--sim-accent-500)] bg-[var(--sim-accent-50)] text-[var(--sim-accent-700)]'
                              : 'border-[var(--sim-border-strong)] bg-[var(--sim-bg-surface)] text-[var(--sim-text-secondary)]'
                          }`}
                        >
                          <Sliders className="w-3 h-3" />
                          <span>Sur mesure / Devis</span>
                        </button>
                      </div>

                      {orderOptionMode === 'custom' && (
                        <div className="space-y-2 rounded-[var(--sim-radius-sm)] border border-[var(--sim-border-strong)] bg-[var(--sim-bg-subtle)] p-2.5 text-xs">
                          <div>
                            <label htmlFor="pdp-custom-dim" className="sim-label text-[11px]">
                              Dimensions souhaitées
                            </label>
                            <input
                              id="pdp-custom-dim"
                              type="text"
                              value={customDimensions}
                              onChange={(e) => setCustomDimensions(e.target.value)}
                              placeholder="Ex. Largeur 2,40 m, châssis renforcé..."
                              className="sim-input text-xs py-1.5"
                            />
                          </div>
                          <div>
                            <label htmlFor="pdp-custom-specs" className="sim-label text-[11px]">
                              Spécificités techniques
                            </label>
                            <input
                              id="pdp-custom-specs"
                              type="text"
                              value={customTechnicalSpecs}
                              onChange={(e) => setCustomTechnicalSpecs(e.target.value)}
                              placeholder="Ex. Tension 380V, attelage 3 points..."
                              className="sim-input text-xs py-1.5"
                            />
                          </div>
                          <div>
                            <label htmlFor="pdp-custom-notes" className="sim-label text-[11px]">
                              Précisions complémentaires
                            </label>
                            <textarea
                              id="pdp-custom-notes"
                              rows={2}
                              value={customNotes}
                              onChange={(e) => setCustomNotes(e.target.value)}
                              placeholder="Contraintes chantier, délai cible..."
                              className="sim-input text-xs py-1.5"
                            />
                          </div>
                          <p className="text-[11px] text-[var(--sim-accent-700)] font-medium leading-snug">
                            Cette option personnalisée débloque l’envoi en <strong>demande de devis sans paiement</strong> à l’étape suivante.
                          </p>
                          <p className="text-[10px] text-[var(--sim-text-muted)] leading-snug">
                            Échanges obligatoires sur SIMCOVA : numéros, e-mails et liens externes interdits.
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="border-t border-[var(--sim-border-hairline)] pt-3 space-y-2 text-xs">
                      <div className="flex items-center justify-between gap-2 text-[var(--sim-text-secondary)]">
                        <span className="truncate">Articles ({qty} × {formatCurrency(activePrice, currency)})</span>
                        <span className="font-mono-nums font-semibold text-[var(--sim-text-primary)] whitespace-nowrap shrink-0">
                          {formatCurrency(activePrice * qty, currency)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 text-[var(--sim-text-secondary)]">
                        <span className="inline-flex items-center gap-1">
                          <Truck className="w-3.5 h-3.5 text-[var(--sim-accent-500)] shrink-0" />
                          <span>Livraison estimée</span>
                        </span>
                        <span className="font-mono-nums font-bold text-[var(--sim-text-primary)] whitespace-nowrap shrink-0">
                          {formatCurrency(activeDeliveryFee, currency)}
                        </span>
                      </div>

                      {product.deliveryZones.length > 0 && (
                        <div>
                          <label htmlFor="product-zone-sim" className="sr-only">
                            Zone de livraison
                          </label>
                          <select
                            id="product-zone-sim"
                            value={selectedZoneId}
                            onChange={(e) => setSelectedZoneId(e.target.value)}
                            className="sim-input text-xs py-1.5"
                          >
                            {product.deliveryZones.map((z) => (
                              <option key={z.zoneId} value={z.zoneId}>
                                {z.zoneName} — {formatCurrency(z.fee, currency)}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-[var(--sim-border-hairline)] font-bold text-[var(--sim-text-primary)]">
                        <span>Total estimé</span>
                        <span className="font-mono-nums whitespace-nowrap shrink-0">
                          {formatCurrency(activePrice * qty + activeDeliveryFee, currency)}
                        </span>
                      </div>
                    </div>

                    {/* Quantité + Boutons Buy Box */}
                    <div className="border-t border-[var(--sim-border-hairline)] pt-3 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-[var(--sim-text-secondary)]">Quantité</span>
                        <div className="inline-flex items-center rounded-[var(--sim-radius-sm)] border border-[var(--sim-border-strong)]">
                          <button
                            type="button"
                            aria-label="Diminuer la quantité"
                            onClick={() => setQty((q) => Math.max(1, q - 1))}
                            className="p-1.5 text-[var(--sim-text-secondary)] hover:text-[var(--sim-text-primary)]"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <span className="px-3 font-mono-nums text-xs font-bold">{qty}</span>
                          <button
                            type="button"
                            aria-label="Augmenter la quantité"
                            onClick={() => setQty((q) => Math.min(maxStock || 1, q + 1))}
                            className="p-1.5 text-[var(--sim-text-secondary)] hover:text-[var(--sim-text-primary)]"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {(() => {
                        const submitWithOption = (buyNow: boolean) => {
                          const specs: CustomSpecs = {
                            dimensions: customDimensions.trim() || undefined,
                            technicalSpecs: customTechnicalSpecs.trim() || undefined,
                            notes: customNotes.trim() || undefined,
                          };
                          if (orderOptionMode === 'custom' && !hasValidCustomSpecs(specs)) {
                            onToast(
                              'error',
                              'Précisions sur mesure requises',
                              'Renseignez au moins les dimensions, les spécificités techniques ou des notes.'
                            );
                            return;
                          }
                          const opts = orderOptionMode === 'custom' ? { isCustom: true, customSpecs: specs } : undefined;
                          if (buyNow) {
                            onBuyNow(product, activeVariant?.id ?? null, activeVariant?.label ?? null, activePrice, qty, opts);
                          } else {
                            onAddToCart(product, activeVariant?.id ?? null, activeVariant?.label ?? null, activePrice, qty, opts);
                          }
                        };
                        return (
                          <>
                            <motion.button
                              type="button"
                              whileTap={{ scale: 0.97 }}
                              disabled={maxStock <= 0}
                              onClick={() => submitWithOption(false)}
                              className="w-full rounded-[var(--sim-radius-md)] bg-[#F59E0B] px-4 py-2.5 text-xs font-bold text-[#0F1111] hover:bg-[#D97706] transition-colors disabled:opacity-50"
                            >
                              {orderOptionMode === 'custom' ? 'Ajouter l’offre sur mesure' : 'Ajouter au panier'}
                            </motion.button>

                            <motion.button
                              type="button"
                              whileTap={{ scale: 0.97 }}
                              disabled={maxStock <= 0}
                              onClick={() => submitWithOption(true)}
                              className="w-full inline-flex items-center justify-center gap-1.5 rounded-[var(--sim-radius-md)] bg-[var(--sim-accent-500)] px-3 py-2.5 text-xs font-bold whitespace-nowrap text-white hover:bg-[var(--sim-accent-600)] transition-colors disabled:opacity-50"
                            >
                              <Zap className="w-3.5 h-3.5" />
                              <span>{orderOptionMode === 'custom' ? 'Passer en devis / commande' : 'Commander maintenant'}</span>
                            </motion.button>
                          </>
                        );
                      })()}
                    </div>

                    <div className="border-t border-[var(--sim-border-hairline)] pt-3 space-y-2 text-[11px] text-[var(--sim-text-secondary)]">
                      {shop && (
                        <p>
                          Expédié par <strong className="text-[var(--sim-text-primary)]">{shop.name}</strong>
                          {shop.city ? ` (${shop.city})` : ''}
                        </p>
                      )}
                      <button
                        type="button"
                        onClick={() => setContactOpen((v) => !v)}
                        aria-expanded={contactOpen}
                        className="w-full inline-flex items-center justify-center gap-1.5 rounded-[var(--sim-radius-sm)] border border-[var(--sim-border-strong)] px-3 py-2 text-xs font-semibold text-[var(--sim-text-primary)] hover:border-[var(--sim-accent-500)] transition-colors"
                      >
                        <MessageSquare className="w-3.5 h-3.5 text-[var(--sim-accent-500)]" />
                        <span>Contacter le vendeur</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Formulaire de contact vendeur sans compte (EXF-601) */}
              <AnimatePresence>
                {contactOpen && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="rounded-[var(--sim-radius-md)] border border-[var(--sim-border-strong)] bg-[var(--sim-bg-subtle)] p-5">
                      <h3 className="font-display text-base font-bold text-[var(--sim-text-primary)]">
                        Poser une question à {shop?.name} (sans créer de compte)
                      </h3>
                      <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-[var(--sim-warning-text)] font-medium">
                        <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                        <span>Messagerie obligatoire via SIMCOVA : tout partage de téléphone, e-mail ou lien externe est bloqué.</span>
                      </p>
                      {createdThreadToken ? (
                        <div className="mt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-[var(--sim-radius-md)] bg-[var(--sim-success-bg)] p-3.5 text-xs text-[var(--sim-success-text)]">
                          <div className="flex items-center gap-2 font-medium">
                            <Check className="w-4 h-4 shrink-0" />
                            <span>Message transmis ! Vous recevrez la réponse par courriel avec votre lien sécurisé.</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              onClose();
                              onOpenThread(createdThreadToken);
                            }}
                            className="rounded bg-[var(--sim-success-text)] px-3 py-1.5 font-semibold text-white whitespace-nowrap"
                          >
                            Ouvrir le fil de discussion
                          </button>
                        </div>
                      ) : (
                        <form onSubmit={handleSendMessage} className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label htmlFor="contact-name" className="sim-label">
                              Votre nom
                            </label>
                            <input
                              id="contact-name"
                              required
                              value={buyerName}
                              onChange={(e) => setBuyerName(e.target.value)}
                              className="sim-input"
                            />
                          </div>
                          <div>
                            <label htmlFor="contact-email" className="sim-label">
                              Votre courriel
                            </label>
                            <input
                              id="contact-email"
                              type="email"
                              required
                              value={buyerEmail}
                              onChange={(e) => setBuyerEmail(e.target.value)}
                              className="sim-input"
                            />
                          </div>
                          <div className="sm:col-span-2">
                            <label htmlFor="contact-msg" className="sim-label">
                              Votre question sur « {product.title} »
                            </label>
                            <textarea
                              id="contact-msg"
                              required
                              rows={2}
                              value={msgBody}
                              onChange={(e) => setMsgBody(e.target.value)}
                              className="sim-input"
                            />
                          </div>
                          <div className="sm:col-span-2 flex justify-end">
                            <button
                              type="submit"
                              disabled={sendingMsg}
                              className="sim-btn-primary"
                            >
                              <Send className="w-3.5 h-3.5" />
                              <span>{sendingMsg ? 'Envoi...' : 'Envoyer le message'}</span>
                            </button>
                          </div>
                        </form>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Avis clients authentiques avec barres de répartition style Amazon (EXF-603 / EXF-604) */}
              <div id="pdp-reviews-section" className="border-t border-[var(--sim-border-hairline)] pt-6">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                  <div className="lg:col-span-4 space-y-3">
                    <h3 className="font-display text-lg font-bold tracking-tight text-[var(--sim-text-primary)]">
                      Évaluations clients ({reviews.length})
                    </h3>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 font-mono-nums text-lg font-bold text-[var(--sim-text-primary)]">
                        <Star className="w-4 h-4 fill-amber-500 text-amber-500" />
                        {reviews.length > 0 ? `${product.ratingAverage.toFixed(1)} sur 5` : 'Aucun avis'}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--sim-text-muted)]">
                      Déposés uniquement après livraison confirmée.
                    </p>

                    <div className="space-y-1.5 pt-2">
                      {[5, 4, 3, 2, 1].map((starLevel) => {
                        const count = ratingHistogram[starLevel] || 0;
                        const pct = reviews.length > 0 ? Math.round((count / reviews.length) * 100) : 0;
                        return (
                          <div key={starLevel} className="flex items-center gap-2 text-xs">
                            <span className="w-10 font-mono-nums font-semibold text-[#007185] dark:text-sky-400">
                              {starLevel}★
                            </span>
                            <div className="flex-1 h-2.5 rounded-[var(--sim-radius-sm)] bg-[var(--sim-bg-subtle)] overflow-hidden border border-[var(--sim-border-hairline)]">
                              <div
                                style={{ width: `${pct}%` }}
                                className="h-full bg-[#F59E0B] transition-all"
                              />
                            </div>
                            <span className="w-9 text-right font-mono-nums text-[var(--sim-text-muted)]">
                              {pct}%
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="lg:col-span-8">
                    {reviews.length === 0 ? (
                      <div className="rounded-[var(--sim-radius-md)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-subtle)]/40 p-6 text-sm text-[var(--sim-text-secondary)]">
                        Aucun avis publié pour le moment sur ce matériel.
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {reviews.map((rev) => (
                          <div
                            key={rev.id}
                            className="rounded-[var(--sim-radius-md)] border border-[var(--sim-border-hairline)] p-4"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 text-xs">
                                <span className="font-bold text-[var(--sim-text-primary)]">{rev.buyerName}</span>
                                <span aria-hidden="true">·</span>
                                <span className="inline-flex items-center gap-0.5 text-amber-500 font-bold tabular-nums">
                                  <Star className="w-3.5 h-3.5 fill-current" />
                                  {rev.rating}/5
                                </span>
                                <span aria-hidden="true">·</span>
                                <span className="text-[var(--sim-success-text)] font-semibold">Achat vérifié</span>
                              </div>
                              <span className="font-mono-nums text-xs text-[var(--sim-text-muted)]">
                                {new Date(rev.createdAt).toLocaleDateString('fr-FR')}
                              </span>
                            </div>
                            <p className="mt-2 text-sm text-[var(--sim-text-secondary)]">{rev.comment}</p>
                            {rev.vendorReply && (
                              <div className="mt-3 rounded-[var(--sim-radius-sm)] bg-[var(--sim-bg-subtle)] p-3 text-xs text-[var(--sim-text-secondary)]">
                                <span className="font-semibold text-[var(--sim-text-primary)]">Réponse de {shop?.name} : </span>
                                {rev.vendorReply}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Barre CTA collante sur mobile */}
          {product && !loading && (
            <div className="sticky bottom-0 z-20 flex md:hidden items-center justify-between gap-3 border-t border-[var(--sim-steel-800)] bg-[var(--sim-steel-950)] px-4 py-3 text-white">
              <div className="min-w-0">
                <p className="text-[11px] text-slate-400">
                  {orderOptionMode === 'custom' ? 'Total estimé (Sur mesure)' : 'Total estimé'}
                </p>
                <p className="font-mono-nums text-base font-bold text-white truncate">
                  {formatCurrency(activePrice * qty + activeDeliveryFee, currency)}
                </p>
              </div>
              <button
                type="button"
                disabled={maxStock <= 0}
                onClick={() => {
                  const specs: CustomSpecs = {
                    dimensions: customDimensions.trim() || undefined,
                    technicalSpecs: customTechnicalSpecs.trim() || undefined,
                    notes: customNotes.trim() || undefined,
                  };
                  if (orderOptionMode === 'custom' && !hasValidCustomSpecs(specs)) {
                    onToast(
                      'error',
                      'Précisions sur mesure requises',
                      'Renseignez au moins les dimensions, spécificités ou notes.'
                    );
                    return;
                  }
                  onAddToCart(
                    product,
                    activeVariant?.id ?? null,
                    activeVariant?.label ?? null,
                    activePrice,
                    qty,
                    orderOptionMode === 'custom' ? { isCustom: true, customSpecs: specs } : undefined
                  );
                }}
                className="rounded-[var(--sim-radius-md)] bg-[#F59E0B] px-4 py-2 text-xs font-bold text-[#0F1111] disabled:opacity-50"
              >
                {orderOptionMode === 'custom' ? 'Ajouter (Sur mesure)' : 'Ajouter au panier'}
              </button>
            </div>
          )}
        </motion.div>

        {/* Lightbox plein écran animé */}
        {lightboxOpen && currentSlide?.type === 'image' && (
          <div
            onClick={(e) => {
              e.stopPropagation();
              setLightboxOpen(false);
              setZoomed(false);
            }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-6"
          >
            <button
              type="button"
              aria-label="Fermer l’aperçu plein écran"
              onClick={(e) => {
                e.stopPropagation();
                setLightboxOpen(false);
                setZoomed(false);
              }}
              className="absolute top-4 right-4 flex h-10 w-10 items-center justify-center rounded-[var(--sim-radius-md)] border border-slate-700 bg-[#131921] text-white"
            >
              <X className="w-5 h-5" />
            </button>
            <img
              src={currentSlide.url}
              alt={currentSlide.alt}
              referrerPolicy="no-referrer"
              onClick={(e) => {
                e.stopPropagation();
                setZoomed((z) => !z);
              }}
              className={`max-h-[88vh] max-w-[92vw] rounded-[var(--sim-radius-md)] object-contain transition-transform duration-200 ${
                zoomed ? 'scale-125 cursor-zoom-out' : 'scale-100 cursor-zoom-in'
              }`}
            />
          </div>
        )}
      </div>
    </AnimatePresence>
  );
};

import React, { useEffect, useState } from 'react';
import { ShieldCheck, MapPin, Star, ArrowLeft, MessageSquare, Send, Check, ShieldAlert, Lock } from 'lucide-react';
import { api } from '../lib/api';
import { formatCurrency } from '../shared/rulesEngine';
import type { Product, ReviewItem, Shop } from '../shared/types';

interface ShopPageViewProps {
  shops: Shop[];
  activeSlug: string | null;
  currency: string;
  onSelectShopSlug: (slug: string | null) => void;
  onSelectProduct: (product: Product) => void;
  onQuickAddToCart: (product: Product) => void;
  onOpenThread: (token: string) => void;
  onToast: (type: 'success' | 'error' | 'info', title: string, description?: string) => void;
}

export const ShopPageView: React.FC<ShopPageViewProps> = ({
  shops,
  activeSlug,
  currency,
  onSelectShopSlug,
  onSelectProduct,
  onQuickAddToCart,
  onOpenThread,
  onToast,
}) => {
  const [loading, setLoading] = useState(false);
  const [shop, setShop] = useState<Shop | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [buyerName, setBuyerName] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [messageBody, setMessageBody] = useState('');
  const [threadToken, setThreadToken] = useState<string | null>(null);

  useEffect(() => {
    if (!activeSlug) {
      setShop(null);
      return;
    }
    setLoading(true);
    setThreadToken(null);
    api
      .getShop(activeSlug)
      .then((res) => {
        setShop(res.shop);
        setProducts(res.products);
        setReviews(res.reviews);
      })
      .catch((err) => {
        onToast('error', 'Boutique introuvable', err instanceof Error ? err.message : undefined);
        onSelectShopSlug(null);
      })
      .finally(() => setLoading(false));
  }, [activeSlug, onSelectShopSlug, onToast]);

  if (!activeSlug) {
    return (
      <div className="mx-auto max-w-[1440px] px-4 py-8 pb-24 sm:px-6 lg:px-8">
        <div className="rounded-[var(--sim-radius-md)] border border-[var(--sim-border-hairline)] bg-white p-5 sm:p-6">
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[var(--sim-text-primary)]">
            Annuaire des concessionnaires &amp; fournisseurs
          </h1>
          <p className="mt-1.5 text-sm text-[var(--sim-text-secondary)]">
            Parcourez l’ensemble des distributeurs de machines agricoles, engins BTP et équipements industriels certifiés sur SIMCOVA.
          </p>
        </div>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {shops.map((s) => {
            const isCert = s.vendorStatus === 'certifie' || s.badges.includes('Vendeur certifié');
            return (
              <div
                key={s.id}
                className="flex flex-col justify-between rounded-[var(--sim-radius-md)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-5 hover:border-[var(--sim-border-strong)] hover:shadow-[var(--sim-shadow-2)] transition-all"
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3.5 min-w-0">
                      {s.logoUrl ? (
                        <img
                          src={s.logoUrl}
                          alt={s.name}
                          className="h-12 w-12 shrink-0 rounded-[var(--sim-radius-md)] object-cover border border-[var(--sim-border-hairline)]"
                        />
                      ) : (
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[var(--sim-radius-md)] bg-[#232F3E] font-display text-base font-extrabold uppercase text-[#F59E0B]">
                          {s.name.slice(0, 2)}
                        </div>
                      )}
                      <div className="min-w-0">
                        <h2 className="font-display text-base font-bold tracking-tight text-[var(--sim-text-primary)] truncate">
                          {s.name}
                        </h2>
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--sim-text-muted)]">
                          <MapPin className="w-3.5 h-3.5" />
                          {s.city || 'National'}
                        </span>
                      </div>
                    </div>
                    {isCert && (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--sim-success-text)] shrink-0">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        Certifié
                      </span>
                    )}
                  </div>
                  <p className="mt-3 text-sm text-[var(--sim-text-secondary)] leading-relaxed line-clamp-3">
                    {s.description}
                  </p>
                </div>

                <div className="mt-5 pt-3.5 border-t border-[var(--sim-border-hairline)] flex items-center justify-between">
                  <span className="font-mono-nums text-xs text-[var(--sim-text-secondary)]">
                    {s.salesCount ?? 0} vente{(s.salesCount ?? 0) > 1 ? 's' : ''} ·{' '}
                    {s.reviewCount > 0 ? `★ ${s.ratingAverage}/5` : s.defaultDeliveryDelay}
                  </span>
                  <button
                    type="button"
                    onClick={() => onSelectShopSlug(s.slug)}
                    className="rounded-[var(--sim-radius-sm)] bg-[#F59E0B] px-3.5 py-2 text-xs font-bold text-[#0F1111] hover:bg-[#D97706] transition-colors whitespace-nowrap"
                  >
                    Voir le parc
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const handleContactShop = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shop) return;
    try {
      const res = await api.sendContactMessage({
        shopId: shop.id,
        buyerName,
        buyerEmail,
        body: messageBody,
      });
      setThreadToken(res.threadToken);
      setMessageBody('');
      onToast('success', 'Message envoyé à la boutique');
    } catch (err) {
      onToast('error', 'Erreur', err instanceof Error ? err.message : undefined);
    }
  };

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-6 pb-24 sm:px-6 lg:px-8">
      <button
        type="button"
        onClick={() => onSelectShopSlug(null)}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--sim-text-secondary)] hover:text-[var(--sim-accent-600)]"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        <span>Toutes les boutiques</span>
      </button>

      {loading || !shop ? (
        <div className="mt-6 h-48 rounded-[var(--sim-radius-xl)] sim-skeleton" />
      ) : (
        <>
          <div className="mt-5 rounded-[var(--sim-radius-xl)] border border-[var(--sim-steel-800)] bg-[var(--sim-steel-950)] text-white p-6 sm:p-8 shadow-[var(--sim-shadow-2)]">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
              <div className="flex items-start gap-4">
                {shop.logoUrl ? (
                  <img
                    src={shop.logoUrl}
                    alt={shop.name}
                    className="h-16 w-16 shrink-0 rounded-[var(--sim-radius-md)] object-cover border border-[var(--sim-steel-800)] bg-[var(--sim-steel-900)]"
                  />
                ) : (
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[var(--sim-radius-md)] border border-[var(--sim-steel-800)] bg-[var(--sim-steel-900)] font-display text-2xl font-extrabold uppercase text-[var(--sim-accent-400)]">
                    {shop.name.slice(0, 2)}
                  </div>
                )}
                <div>
                  <div className="flex flex-wrap items-center gap-2.5 text-xs text-slate-400">
                    <span>{shop.city || 'Livraison nationale'}</span>
                    <span aria-hidden="true">·</span>
                    <span>Délai habituel : {shop.defaultDeliveryDelay}</span>
                    {(shop.vendorStatus === 'certifie' || shop.badges.includes('Vendeur certifié')) && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1 font-semibold text-emerald-400">
                          <ShieldCheck className="w-4 h-4" />
                          Vendeur certifié SIMCOVA
                        </span>
                      </>
                    )}
                  </div>
                  <h1 className="mt-2 font-display text-2xl sm:text-3xl font-bold tracking-tight text-white">
                    {shop.name}
                  </h1>
                  <p className="mt-2 max-w-2xl text-sm text-slate-300 leading-relaxed">
                    {shop.description}
                  </p>
                </div>
              </div>

              <div className="space-y-2.5 text-xs text-slate-300 shrink-0 rounded-[var(--sim-radius-md)] border border-[var(--sim-steel-800)] bg-[var(--sim-steel-900)] px-4 py-3 max-w-xs">
                <div className="flex items-center gap-2 font-semibold text-white">
                  <Lock className="w-3.5 h-3.5 text-[var(--sim-accent-400)] shrink-0" />
                  <span>Messagerie sécurisée SIMCOVA</span>
                </div>
                <p className="text-[11px] text-slate-300 leading-snug">
                  Canal officiel obligatoire. Aucune coordonnée directe hors plateforme.
                </p>
                <button
                  type="button"
                  onClick={() => document.getElementById('shop-contact-section')?.scrollIntoView({ behavior: 'smooth' })}
                  className="inline-flex items-center gap-1.5 rounded-[var(--sim-radius-sm)] bg-[#F59E0B] px-3 py-1.5 text-xs font-bold text-[#0F1111] hover:bg-[#D97706]"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>Écrire via SIMCOVA</span>
                </button>
              </div>
            </div>

            <div className="mt-6 pt-5 border-t border-[var(--sim-steel-800)] grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
              <div>
                <p className="text-slate-400">Équipements en ligne</p>
                <p className="mt-1 font-mono-nums text-lg font-bold text-white">{products.length}</p>
              </div>
              <div>
                <p className="text-slate-400">Ventes réalisées</p>
                <p className="mt-1 font-mono-nums text-lg font-bold text-emerald-400">{shop.salesCount ?? 0}</p>
              </div>
              <div>
                <p className="text-slate-400">Note moyenne</p>
                <p className="mt-1 font-mono-nums text-lg font-bold text-amber-400">
                  {shop.reviewCount > 0 ? `${shop.ratingAverage}/5 (${shop.reviewCount})` : 'Nouveau'}
                </p>
              </div>
              <div>
                <p className="text-slate-400">Forfait livraison base</p>
                <p className="mt-1 font-mono-nums text-lg font-bold text-white">
                  {formatCurrency(shop.defaultDeliveryFee, currency)}
                </p>
              </div>
            </div>
          </div>

          <h2 className="mt-10 font-display text-xl sm:text-2xl font-bold tracking-tight text-[var(--sim-text-primary)]">
            Parc matériel du concessionnaire ({products.length})
          </h2>

          {products.length === 0 ? (
            <div className="mt-5 rounded-[var(--sim-radius-lg)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-10 text-center text-sm text-[var(--sim-text-secondary)]">
              Aucun équipement publié pour le moment par ce concessionnaire.
            </div>
          ) : (
            <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {products.map((product) => (
                <div
                  key={product.id}
                  className="group flex flex-col justify-between rounded-[var(--sim-radius-lg)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] overflow-hidden hover:border-[var(--sim-border-strong)] hover:shadow-[var(--sim-shadow-2)] transition-all"
                >
                  <div>
                    <button
                      type="button"
                      onClick={() => onSelectProduct(product)}
                      className="block aspect-[4/3] w-full bg-[var(--sim-bg-subtle)] overflow-hidden"
                    >
                      {product.media[0]?.url && (
                        <img
                          src={product.media[0].url}
                          alt={product.title}
                          referrerPolicy="no-referrer"
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                        />
                      )}
                    </button>
                    <div className="p-4">
                      <p className="text-xs font-medium text-[var(--sim-text-muted)]">
                        {product.categoryName} · {product.condition}
                      </p>
                      <h3 className="mt-1.5 font-display text-base font-bold tracking-tight text-[var(--sim-text-primary)]">
                        <button type="button" onClick={() => onSelectProduct(product)} className="text-left hover:text-[var(--sim-accent-500)] transition-colors">
                          {product.title}
                        </button>
                      </h3>
                    </div>
                  </div>
                  <div className="flex items-center justify-between border-t border-[var(--sim-border-hairline)] bg-[var(--sim-bg-subtle)]/55 px-4 py-3">
                    <span className="font-mono-nums text-sm font-bold text-[var(--sim-text-primary)]">
                      {formatCurrency(product.price, currency)}
                    </span>
                    <button
                      type="button"
                      onClick={() => onQuickAddToCart(product)}
                      className="rounded-[var(--sim-radius-sm)] bg-[#F59E0B] px-3 py-1.5 text-xs font-bold text-[#0F1111] hover:bg-[#D97706] transition-colors"
                    >
                      Ajouter
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Avis reçus + formulaire de contact boutique */}
          <div className="mt-12 grid grid-cols-1 lg:grid-cols-12 gap-8">
            <div className="lg:col-span-7">
              <h2 className="font-display text-xl font-bold text-[var(--sim-text-primary)]">
                Avis clients sur la boutique ({reviews.length})
              </h2>
              <div className="mt-4 space-y-3">
                {reviews.length === 0 ? (
                  <p className="text-sm text-[var(--sim-text-secondary)]">Aucun avis publié pour cette boutique.</p>
                ) : (
                  reviews.map((r) => (
                    <div key={r.id} className="rounded-[var(--sim-radius-md)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-4">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-[var(--sim-text-primary)]">
                          {r.buyerName} · {r.productTitle}
                        </span>
                        <span className="inline-flex items-center gap-1 font-semibold text-amber-500 tabular-nums">
                          <Star className="w-3.5 h-3.5 fill-current" />
                          {r.rating}/5
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-[var(--sim-text-secondary)]">{r.comment}</p>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div id="shop-contact-section" className="lg:col-span-5">
              <div className="rounded-[var(--sim-radius-lg)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-5">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-[var(--sim-accent-500)]" />
                  <h2 className="font-display text-lg font-semibold text-[var(--sim-text-primary)]">
                    Contacter {shop.name}
                  </h2>
                </div>
                <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-[var(--sim-warning-text)] font-medium">
                  <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                  <span>Protection SIMCOVA : numéros, e-mails et liens externes interdits.</span>
                </p>
                {threadToken ? (
                  <div className="mt-4 rounded-[var(--sim-radius-md)] bg-[var(--sim-success-bg)] p-4 text-xs text-[var(--sim-success-text)] space-y-2">
                    <p className="flex items-center gap-1.5 font-semibold">
                      <Check className="w-4 h-4" />
                      Message envoyé sans création de compte.
                    </p>
                    <button
                      type="button"
                      onClick={() => onOpenThread(threadToken)}
                      className="rounded bg-[var(--sim-success-text)] px-3 py-1.5 font-semibold text-white"
                    >
                      Consulter le fil de discussion
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleContactShop} className="mt-4 space-y-3">
                    <input
                      required
                      placeholder="Votre nom"
                      value={buyerName}
                      onChange={(e) => setBuyerName(e.target.value)}
                      className="sim-input"
                    />
                    <input
                      required
                      type="email"
                      placeholder="Votre courriel"
                      value={buyerEmail}
                      onChange={(e) => setBuyerEmail(e.target.value)}
                      className="sim-input"
                    />
                    <textarea
                      required
                      rows={3}
                      placeholder="Votre message..."
                      value={messageBody}
                      onChange={(e) => setMessageBody(e.target.value)}
                      className="sim-input"
                    />
                    <button
                      type="submit"
                      className="w-full sim-btn-primary py-2.5"
                    >
                      <Send className="w-4 h-4" />
                      <span>Envoyer au vendeur</span>
                    </button>
                  </form>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

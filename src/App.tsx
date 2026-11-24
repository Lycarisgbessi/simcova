import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { MotionConfig } from 'motion/react';
import { X, ShieldCheck } from 'lucide-react';
import { api, SESSION_EXPIRED_EVENT } from './lib/api';
import type {
  CartItem,
  Category,
  CustomSpecs,
  PlatformRule,
  PlatformSettings,
  Product,
  ProductCondition,
  RuleId,
  Shop,
} from './shared/types';
import { Header, type ActiveRoute } from './components/Header';
import { useEscapeKey } from './hooks/useEscapeKey';
import { StorefrontView } from './components/StorefrontView';
import { ProductDetailModal } from './components/ProductDetailModal';
import { ShopPageView } from './components/ShopPageView';
import { CartCheckoutDrawer } from './components/CartCheckoutDrawer';
import { OrderTrackingView } from './components/OrderTrackingView';
import { ProPortalView } from './components/ProPortalView';
import { ConsentBanner, OfflineIndicator } from './components/PWAControls';
import { ToastContainer, type ToastMessage } from './components/ToastSystem';

export interface RecentOrderRecord {
  orderNumber: string;
  trackingToken: string;
  totalAmount: number;
  paymentMode: string;
  createdAt: string;
}

const DEFAULT_SETTINGS: PlatformSettings = {
  currency: 'FCFA',
  defaultDeliveryPolicy: 'Livraison 24h à 72h selon zone et vendeur.',
  legalMentions: 'SIMCOVA Marketplace — Plateforme de commerce multi-vendeurs.',
  cgvText: 'Conditions Générales de Vente SIMCOVA applicables à toutes les transactions.',
  supportEmail: 'support@simcova.africa',
  supportPhone: '+225 07 00 00 00',
  kycRetentionDays: 90,
  reviewProcessingDelayLabel: '48 heures ouvrées',
  defaultDepositPercent: 30,
  bankTransferThreshold: 5000000,
  commissionRatePercent: 0,
  vatRatePercent: 0,
  maintenanceMode: false,
};

function buildCartKey(
  productId: string,
  variantId: string | null,
  isCustom?: boolean,
  customSpecs?: CustomSpecs | null
): string {
  const customPart =
    isCustom && customSpecs
      ? `custom::${JSON.stringify({
          dimensions: (customSpecs.dimensions || '').trim(),
          technicalSpecs: (customSpecs.technicalSpecs || '').trim(),
          notes: (customSpecs.notes || '').trim(),
        })}`
      : 'std';
  return `${productId}::${variantId || 'base'}::${customPart}`;
}

export default function App() {
  const [route, setRoute] = useState<ActiveRoute>('catalog');
  const [categories, setCategories] = useState<Category[]>([]);
  const [rules, setRules] = useState<Record<RuleId, PlatformRule>>({} as Record<RuleId, PlatformRule>);
  const [settings, setSettings] = useState<PlatformSettings>(DEFAULT_SETTINGS);
  const [shops, setShops] = useState<Shop[]>([]);
  const [adminNeedsClaim, setAdminNeedsClaim] = useState(false);

  // Dual search & catalog filters
  const [searchMode, setSearchMode] = useState<'products' | 'shops'>('products');
  const [products, setProducts] = useState<Product[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [sortBy, setSortBy] = useState('recent');
  const [certifiedOnly, setCertifiedOnly] = useState(false);
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [minStock, setMinStock] = useState('');
  const [conditionFilter, setConditionFilter] = useState<ProductCondition | ''>('');
  const [maxDeliveryFee, setMaxDeliveryFee] = useState('');
  const [filterShop, setFilterShop] = useState('');
  const [minRating, setMinRating] = useState(0);

  // Vendor search filters
  const [searchedShops, setSearchedShops] = useState<Shop[]>([]);
  const [shopsLoading, setShopsLoading] = useState(false);
  const [vendorMinSales, setVendorMinSales] = useState(0);
  const [vendorCertifiedOnly, setVendorCertifiedOnly] = useState(false);
  const [vendorBadge, setVendorBadge] = useState('');
  const [vendorCity, setVendorCity] = useState('');
  const [vendorMinRating, setVendorMinRating] = useState(0);
  const [vendorSort, setVendorSort] = useState('sales_desc');

  const [urlHydrated, setUrlHydrated] = useState(false);

  // Selected views & modals
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [selectedShopSlug, setSelectedShopSlug] = useState<string | null>(null);
  const [trackingToken, setTrackingToken] = useState<string | null>(null);
  const [threadToken, setThreadToken] = useState<string | null>(null);
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [legalModal, setLegalModal] = useState<'mentions' | 'cgv' | null>(null);

  // Persistent localStorage Cart & Wishlist (EXF-403, EXF-410)
  const [cart, setCart] = useState<CartItem[]>(() => {
    try {
      const saved = localStorage.getItem('simcova_cart_v1');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [wishlistIds, setWishlistIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('simcova_wishlist_v1');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [recentOrders, setRecentOrders] = useState<RecentOrderRecord[]>(() => {
    try {
      const saved = localStorage.getItem('simcova_recent_orders_v1');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const rememberOrder = useCallback((entry: RecentOrderRecord) => {
    if (!entry.trackingToken || !entry.orderNumber) return;
    setRecentOrders((prev) => {
      const filtered = prev.filter((item) => item.orderNumber !== entry.orderNumber);
      return [entry, ...filtered].slice(0, 10);
    });
  }, []);

  // Toasts (cap at 3 visible items so rapid vendor/admin actions never obscure content)
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const addToast = useCallback((type: 'success' | 'error' | 'info', title: string, description?: string) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev.slice(-2), { id, type, title, description }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3600);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('simcova_recent_orders_v1', JSON.stringify(recentOrders));
    } catch {
      // Ignore storage quota issues
    }
  }, [recentOrders]);

  useEffect(() => {
    try {
      localStorage.setItem('simcova_cart_v1', JSON.stringify(cart));
    } catch {
      // Ignore storage quota issues
    }
  }, [cart]);

  useEffect(() => {
    try {
      localStorage.setItem('simcova_wishlist_v1', JSON.stringify(wishlistIds));
    } catch {
      // Ignore storage quota issues
    }
  }, [wishlistIds]);

  const loadBootstrap = useCallback(async () => {
    try {
      const data = await api.bootstrap();
      setCategories(data.categories);
      setRules(data.rules);
      setSettings(data.settings);
      setShops(data.shops);
      setSearchedShops(data.shops);
      setAdminNeedsClaim(data.adminNeedsClaim);
    } catch (err) {
      addToast('error', 'Erreur d’initialisation', err instanceof Error ? err.message : undefined);
    }
  }, [addToast]);

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    try {
      const parsedMin = minPrice.trim() ? Number(minPrice) : undefined;
      const parsedMax = maxPrice.trim() ? Number(maxPrice) : undefined;
      const parsedStock = minStock.trim() ? Number(minStock) : undefined;
      const parsedDeliv = maxDeliveryFee.trim() ? Number(maxDeliveryFee) : undefined;
      const res = await api.getProducts({
        q: searchQuery,
        category: selectedCategory,
        sort: sortBy,
        certifiedOnly,
        minPrice: parsedMin !== undefined && !Number.isNaN(parsedMin) ? parsedMin : undefined,
        maxPrice: parsedMax !== undefined && !Number.isNaN(parsedMax) ? parsedMax : undefined,
        minStock: parsedStock !== undefined && !Number.isNaN(parsedStock) ? parsedStock : undefined,
        condition: conditionFilter || undefined,
        maxDeliveryFee: parsedDeliv !== undefined && !Number.isNaN(parsedDeliv) ? parsedDeliv : undefined,
        shop: filterShop || undefined,
        minRating: minRating > 0 ? minRating : undefined,
      });
      setProducts(res.products);
    } catch (err) {
      addToast('error', 'Erreur catalogue', err instanceof Error ? err.message : undefined);
    } finally {
      setCatalogLoading(false);
    }
  }, [
    searchQuery,
    selectedCategory,
    sortBy,
    certifiedOnly,
    minPrice,
    maxPrice,
    minStock,
    conditionFilter,
    maxDeliveryFee,
    filterShop,
    minRating,
    addToast,
  ]);

  const loadSearchedShops = useCallback(async () => {
    setShopsLoading(true);
    try {
      const res = await api.getShops({
        q: searchQuery,
        minSales: vendorMinSales > 0 ? vendorMinSales : undefined,
        certifiedOnly: vendorCertifiedOnly,
        badge: vendorBadge || undefined,
        city: vendorCity.trim() || undefined,
        minRating: vendorMinRating > 0 ? vendorMinRating : undefined,
        sort: vendorSort,
      });
      setSearchedShops(res.shops);
    } catch (err) {
      addToast('error', 'Erreur recherche vendeurs', err instanceof Error ? err.message : undefined);
    } finally {
      setShopsLoading(false);
    }
  }, [searchQuery, vendorMinSales, vendorCertifiedOnly, vendorBadge, vendorCity, vendorMinRating, vendorSort, addToast]);

  useEffect(() => {
    loadBootstrap();
  }, [loadBootstrap]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchMode === 'products') {
        loadCatalog();
      } else {
        loadSearchedShops();
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [searchMode, loadCatalog, loadSearchedShops]);

  // Apply URL query parameters on initial load (deep links + shareable catalog filters)
  const applyUrlLocation = useCallback(
    (urlStr: string) => {
      try {
        const u = new URL(urlStr, window.location.origin);
        const params = u.searchParams;
        const suivi = params.get('suivi');
        const fil = params.get('fil');
        const boutique = params.get('boutique');
        const produit = params.get('produit');
        const categorie = params.get('categorie');
        const mode = params.get('mode');
        const q = params.get('q');
        const tri = params.get('tri');
        const certifie = params.get('certifie');
        const prixMin = params.get('prix_min');
        const prixMax = params.get('prix_max');
        const stockMin = params.get('stock_min');
        const etat = params.get('etat');
        const vendeur = params.get('vendeur');
        const noteMin = params.get('note_min');
        const verifyEmail = params.get('verify_email');
        const resetPass = params.get('reset_password');
        const espace = params.get('espace');

        if (suivi) {
          setTrackingToken(suivi);
          setRoute('tracking');
        } else if (fil) {
          setThreadToken(fil);
          setRoute('thread');
        } else if (resetPass || espace === 'pro') {
          if (resetPass) setResetToken(resetPass);
          setRoute('pro');
        } else if (boutique) {
          setSelectedShopSlug(boutique);
          setRoute('shop-detail');
        } else if (produit) {
          setRoute('catalog');
          setSelectedProductId(produit);
        } else {
          if (mode === 'shops') {
            setRoute('catalog');
            setSearchMode('shops');
          }
          if (categorie) {
            setRoute('catalog');
            setSelectedCategory(categorie);
          }
          if (q) {
            setRoute('catalog');
            setSearchQuery(q);
          }
          if (tri) setSortBy(tri);
          if (certifie === 'true') setCertifiedOnly(true);
          if (prixMin) setMinPrice(prixMin);
          if (prixMax) setMaxPrice(prixMax);
          if (stockMin) setMinStock(stockMin);
          if (etat === 'Neuf' || etat === 'Reconditionné' || etat === 'Artisanal') setConditionFilter(etat);
          if (vendeur) setFilterShop(vendeur);
          if (noteMin && !Number.isNaN(Number(noteMin))) setMinRating(Number(noteMin));
        }

        if (verifyEmail) {
          api
            .verifyEmail(verifyEmail)
            .then(() => addToast('success', 'Courriel vendeur confirmé !'))
            .catch(() => undefined);
        }
      } catch {
        // Ignore malformed deep link
      }
    },
    [addToast]
  );

  useEffect(() => {
    applyUrlLocation(window.location.href);
    setUrlHydrated(true);
  }, [applyUrlLocation]);

  // Keep the URL synchronized with the active view so every screen is shareable/bookmarkable
  // (catalog filters, shop detail, tracking, thread, product sheet and the Pro portal).
  useEffect(() => {
    if (!urlHydrated) return;
    const params = new URLSearchParams(window.location.search);
    const filterKeys = [
      'mode',
      'q',
      'categorie',
      'tri',
      'certifie',
      'prix_min',
      'prix_max',
      'stock_min',
      'etat',
      'vendeur',
      'note_min',
    ];
    const viewKeys = ['boutique', 'espace', 'suivi', 'fil', 'produit'];
    for (const k of [...filterKeys, ...viewKeys]) params.delete(k);

    if (route === 'catalog') {
      if (searchMode === 'shops') params.set('mode', 'shops');
      if (searchQuery.trim()) params.set('q', searchQuery.trim());
      if (selectedCategory && selectedCategory !== 'all') params.set('categorie', selectedCategory);
      if (sortBy && sortBy !== 'recent') params.set('tri', sortBy);
      if (certifiedOnly) params.set('certifie', 'true');
      if (minPrice.trim()) params.set('prix_min', minPrice.trim());
      if (maxPrice.trim()) params.set('prix_max', maxPrice.trim());
      if (minStock.trim()) params.set('stock_min', minStock.trim());
      if (conditionFilter) params.set('etat', conditionFilter);
      if (filterShop) params.set('vendeur', filterShop);
      if (minRating > 0) params.set('note_min', String(minRating));
      if (selectedProductId) params.set('produit', selectedProductId);
    } else if (route === 'shop-detail' && selectedShopSlug) {
      params.set('boutique', selectedShopSlug);
    } else if (route === 'pro') {
      params.set('espace', 'pro');
    } else if (route === 'tracking' && trackingToken) {
      params.set('suivi', trackingToken);
    } else if (route === 'thread' && threadToken) {
      params.set('fil', threadToken);
    }

    const qs = params.toString();
    const targetUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(null, '', targetUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    urlHydrated,
    route,
    selectedProductId,
    selectedShopSlug,
    trackingToken,
    threadToken,
    searchMode,
    searchQuery,
    selectedCategory,
    sortBy,
    certifiedOnly,
    minPrice,
    maxPrice,
    minStock,
    conditionFilter,
    filterShop,
    minRating,
  ]);

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker) return;
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'SIMCOVA_DEEP_LINK' && typeof event.data.url === 'string') {
        applyUrlLocation(event.data.url);
      }
    };
    navigator.serviceWorker.addEventListener('message', handler);
    return () => {
      navigator.serviceWorker.removeEventListener('message', handler);
    };
  }, [applyUrlLocation]);

  const handleNavigate = (target: ActiveRoute) => {
    setRoute(target);
    if (target === 'shops') {
      setSelectedShopSlug(null);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleAddToCart = (
    product: Product,
    variantId: string | null,
    variantLabel: string | null,
    price: number,
    qty: number,
    options?: { isCustom?: boolean; customSpecs?: CustomSpecs | null }
  ) => {
    const isCustom = Boolean(options?.isCustom && options?.customSpecs);
    const customSpecs = isCustom ? options?.customSpecs || null : null;
    const cartKey = buildCartKey(product.id, variantId, isCustom, customSpecs);

    setCart((prev) => {
      const idx = prev.findIndex(
        (i) => (i.cartKey || buildCartKey(i.productId, i.variantId, i.isCustom, i.customSpecs)) === cartKey
      );
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + qty };
        return next;
      }
      return [
        ...prev,
        {
          cartKey,
          productId: product.id,
          variantId,
          variantLabel,
          quantity: qty,
          title: product.title,
          price,
          deliveryFee: product.deliveryFee,
          deliveryZones: product.deliveryZones,
          imageUrl: product.media?.[0]?.url || '',
          shopName: product.shopName || 'Boutique SIMCOVA',
          shopId: product.shopId,
          paymentMethods: product.paymentMethods,
          isCustom,
          customSpecs,
        },
      ];
    });
    addToast(
      'success',
      isCustom ? 'Offre personnalisée ajoutée' : 'Ajouté au panier',
      `${qty} × ${product.title}${isCustom ? ' (Sur mesure)' : ''}`
    );
  };

  const handleQuickAddToCart = (product: Product) => {
    const firstVar = product.variants?.find((v) => v.stock > 0) || product.variants?.[0] || null;
    const price = firstVar?.priceOverride ?? product.price;
    handleAddToCart(product, firstVar?.id || null, firstVar?.label || null, price, 1);
  };

  const handleUpdateCartQty = (cartKey: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) => {
          const itemKey = item.cartKey || buildCartKey(item.productId, item.variantId, item.isCustom, item.customSpecs);
          return itemKey === cartKey ? { ...item, quantity: item.quantity + delta } : item;
        })
        .filter((item) => item.quantity > 0)
    );
  };

  const handleRemoveCartItem = (cartKey: string) => {
    setCart((prev) =>
      prev.filter((item) => {
        const itemKey = item.cartKey || buildCartKey(item.productId, item.variantId, item.isCustom, item.customSpecs);
        return itemKey !== cartKey;
      })
    );
  };

  const handleToggleWishlist = (productId: string) => {
    setWishlistIds((prev) =>
      prev.includes(productId) ? prev.filter((id) => id !== productId) : [...prev, productId]
    );
  };

  const totalCartItems = useMemo(() => cart.reduce((sum, i) => sum + i.quantity, 0), [cart]);
  const cartSubtotal = useMemo(() => cart.reduce((sum, i) => sum + i.price * i.quantity, 0), [cart]);

  useEscapeKey(() => setLegalModal(null), Boolean(legalModal));

  // Lock body scroll while any modal/drawer is open (product sheet, cart, legal notice)
  const anyOverlayOpen = Boolean(selectedProductId) || cartOpen || Boolean(legalModal);
  useEffect(() => {
    document.body.style.overflow = anyOverlayOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [anyOverlayOpen]);

  // Surface expired Pro sessions once instead of failing silently
  useEffect(() => {
    const onExpired = () => addToast('info', 'Session expirée', 'Reconnectez-vous depuis l’Espace Pro.');
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [addToast]);

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen flex flex-col bg-[var(--sim-bg-canvas)] text-[var(--sim-text-primary)]">
        <Header
          activeRoute={route}
          onNavigate={handleNavigate}
          cartCount={totalCartItems}
          onOpenCart={() => setCartOpen(true)}
        />

        <main className="flex-1">
          {route === 'catalog' && (
            <StorefrontView
              products={products}
              categories={categories}
              shops={shops}
              searchedShops={searchedShops}
              shopsLoading={shopsLoading}
              searchMode={searchMode}
              currency={settings.currency}
              loading={catalogLoading}
              searchQuery={searchQuery}
              selectedCategory={selectedCategory}
              sortBy={sortBy}
              certifiedOnly={certifiedOnly}
              minPrice={minPrice}
              maxPrice={maxPrice}
              minStock={minStock}
              conditionFilter={conditionFilter}
              maxDeliveryFee={maxDeliveryFee}
              filterShop={filterShop}
              minRating={minRating}
              vendorMinSales={vendorMinSales}
              vendorCertifiedOnly={vendorCertifiedOnly}
              vendorBadge={vendorBadge}
              vendorCity={vendorCity}
              vendorMinRating={vendorMinRating}
              vendorSort={vendorSort}
              wishlistIds={wishlistIds}
              cartCount={totalCartItems}
              cartSubtotal={cartSubtotal}
              onSearchModeChange={setSearchMode}
              onSearchChange={setSearchQuery}
              onCategoryChange={setSelectedCategory}
              onSortChange={setSortBy}
              onCertifiedToggle={setCertifiedOnly}
              onMinPriceChange={setMinPrice}
              onMaxPriceChange={setMaxPrice}
              onMinStockChange={setMinStock}
              onConditionFilterChange={setConditionFilter}
              onMaxDeliveryFeeChange={setMaxDeliveryFee}
              onFilterShopChange={setFilterShop}
              onMinRatingChange={setMinRating}
              onVendorMinSalesChange={setVendorMinSales}
              onVendorCertifiedToggle={setVendorCertifiedOnly}
              onVendorBadgeChange={setVendorBadge}
              onVendorCityChange={setVendorCity}
              onVendorMinRatingChange={setVendorMinRating}
              onVendorSortChange={setVendorSort}
              onResetAllFilters={() => {
                setSearchQuery('');
                setSelectedCategory('all');
                setSortBy('recent');
                setCertifiedOnly(false);
                setMinPrice('');
                setMaxPrice('');
                setMinStock('');
                setConditionFilter('');
                setMaxDeliveryFee('');
                setFilterShop('');
                setMinRating(0);
                setVendorMinSales(0);
                setVendorCertifiedOnly(false);
                setVendorBadge('');
                setVendorCity('');
                setVendorMinRating(0);
                setVendorSort('sales_desc');
              }}
              onToggleWishlist={handleToggleWishlist}
              onSelectProduct={(p) => setSelectedProductId(p.id)}
              onQuickAddToCart={handleQuickAddToCart}
              onOpenShop={(slug) => {
                setSelectedShopSlug(slug);
                setRoute('shop-detail');
              }}
              onOpenPro={() => setRoute('pro')}
              onOpenCart={() => setCartOpen(true)}
              onOpenTracking={() => handleNavigate('tracking')}
              onDeepLink={(link) => applyUrlLocation(link)}
              onToast={addToast}
            />
          )}

          {(route === 'shops' || route === 'shop-detail') && (
            <ShopPageView
              shops={shops}
              activeSlug={selectedShopSlug}
              currency={settings.currency}
              onSelectShopSlug={(slug) => {
                setSelectedShopSlug(slug);
                setRoute(slug ? 'shop-detail' : 'shops');
              }}
              onSelectProduct={(p) => setSelectedProductId(p.id)}
              onQuickAddToCart={handleQuickAddToCart}
              onOpenThread={(tok) => {
                setThreadToken(tok);
                setRoute('thread');
              }}
              onToast={addToast}
            />
          )}

          {(route === 'tracking' || route === 'thread') && (
            <OrderTrackingView
              trackingToken={route === 'tracking' ? trackingToken : null}
              threadToken={route === 'thread' ? threadToken : null}
              currency={settings.currency}
              rules={rules}
              settings={settings}
              recentOrders={recentOrders}
              onRememberOrder={rememberOrder}
              onUpdateTrackingToken={(tok) => {
                setTrackingToken(tok);
                setRoute('tracking');
              }}
              onOpenThread={(tok) => {
                setThreadToken(tok);
                setRoute('thread');
              }}
              onToast={addToast}
            />
          )}

          {route === 'pro' && (
            <ProPortalView
              categories={categories}
              rules={rules}
              settings={settings}
              adminNeedsClaim={adminNeedsClaim}
              initialResetToken={resetToken}
              onConsumeResetToken={() => setResetToken(null)}
              onRefreshBootstrap={() => {
                loadBootstrap();
                loadCatalog();
              }}
              onToast={addToast}
            />
          )}
        </main>

        <footer className="mt-auto bg-[#131921] text-slate-300 pb-24 md:pb-14">
          <button
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="w-full bg-[#37475A] hover:bg-[#485769] py-2.5 text-center text-xs font-semibold text-white transition-colors"
          >
            ↑ Retour en haut de page
          </button>

          <div className="mx-auto max-w-[1440px] px-4 py-10 sm:px-6 lg:px-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 text-xs">
            <div className="space-y-2.5">
              <p className="font-display text-lg font-extrabold tracking-wider uppercase text-white">SIMCOVA</p>
              <p className="text-slate-400 leading-relaxed">
                Place de marché B2B/B2C d’équipements lourds, tracteurs agricoles, engins de chantier et matériel industriel certifié.
              </p>
              <p className="inline-flex items-center gap-1.5 text-emerald-400 font-semibold pt-1">
                <ShieldCheck className="w-4 h-4" />
                Paiement sécurisé Jumia Africa
              </p>
            </div>

            <div className="space-y-2">
              <p className="font-display text-sm font-semibold text-white">Navigation &amp; Rayons</p>
              <ul className="space-y-1.5 text-slate-300">
                <li>
                  <button type="button" onClick={() => handleNavigate('catalog')} className="hover:text-[#F59E0B] transition-colors">
                    Parc Matériel complet
                  </button>
                </li>
                <li>
                  <button type="button" onClick={() => handleNavigate('shops')} className="hover:text-[#F59E0B] transition-colors">
                    Annuaire des concessionnaires
                  </button>
                </li>
                <li>
                  <button type="button" onClick={() => handleNavigate('tracking')} className="hover:text-[#F59E0B] transition-colors">
                    Suivi de commande sans compte
                  </button>
                </li>
                <li>
                  <button type="button" onClick={() => setCartOpen(true)} className="hover:text-[#F59E0B] transition-colors">
                    Ouvrir mon panier ({totalCartItems})
                  </button>
                </li>
              </ul>
            </div>

            <div className="space-y-2">
              <p className="font-display text-sm font-semibold text-white">Acheter &amp; Vendre Pro</p>
              <ul className="space-y-1.5 text-slate-300">
                <li>
                  <button type="button" onClick={() => handleNavigate('pro')} className="hover:text-[#F59E0B] transition-colors">
                    Devenir vendeur / Espace Pro
                  </button>
                </li>
                <li className="text-slate-400">Commande directe sans création de compte</li>
                <li className="text-slate-400">Agrément KYC vérifié ({settings.reviewProcessingDelayLabel})</li>
                <li className="text-slate-400">{settings.defaultDeliveryPolicy}</li>
              </ul>
            </div>

            <div className="space-y-2">
              <p className="font-display text-sm font-semibold text-white">Légal &amp; Assistance</p>
              <ul className="space-y-1.5 text-slate-300">
                <li>
                  <button type="button" onClick={() => setLegalModal('mentions')} className="hover:text-[#F59E0B] transition-colors">
                    Mentions légales SIMCOVA
                  </button>
                </li>
                <li>
                  <button type="button" onClick={() => setLegalModal('cgv')} className="hover:text-[#F59E0B] transition-colors">
                    Conditions Générales de Vente (CGV)
                  </button>
                </li>
                <li>
                  <a href={`mailto:${settings.supportEmail}`} className="hover:text-[#F59E0B] transition-colors">
                    {settings.supportEmail}
                  </a>
                </li>
                <li className="font-mono-nums text-slate-400">{settings.supportPhone}</li>
              </ul>
            </div>
          </div>

          <div className="border-t border-[#232F3E] py-4 text-center text-[11px] text-slate-400">
            SIMCOVA Marketplace · Transactions directes sans compte acheteur · Devise affichée : {settings.currency}
          </div>
        </footer>

        {/* Modals & Drawers */}
        <ProductDetailModal
          productId={selectedProductId}
          currency={settings.currency}
          onClose={() => setSelectedProductId(null)}
          onAddToCart={handleAddToCart}
          onBuyNow={(product, variantId, variantLabel, price, qty, options) => {
            handleAddToCart(product, variantId, variantLabel, price, qty, options);
            setSelectedProductId(null);
            setCartOpen(true);
          }}
          onOpenShop={(slug) => {
            setSelectedProductId(null);
            setSelectedShopSlug(slug);
            setRoute('shop-detail');
          }}
          onOpenThread={(tok) => {
            setSelectedProductId(null);
            setThreadToken(tok);
            setRoute('thread');
          }}
          onToast={addToast}
        />

        <CartCheckoutDrawer
          open={cartOpen}
          items={cart}
          rules={rules}
          settings={settings}
          shops={shops}
          currency={settings.currency}
          onClose={() => setCartOpen(false)}
          onUpdateQty={handleUpdateCartQty}
          onRemoveItem={handleRemoveCartItem}
          onClearCart={() => setCart([])}
          onOrderCreated={rememberOrder}
          onOrderComplete={(tok) => {
            setCartOpen(false);
            setTrackingToken(tok);
            setRoute('tracking');
          }}
          onOpenThread={(tok) => {
            setCartOpen(false);
            setThreadToken(tok);
            setRoute('thread');
          }}
          onToast={addToast}
        />

        {legalModal && (
          <div
            role="dialog"
            aria-modal="true"
            onClick={() => setLegalModal(null)}
            className="fixed inset-0 z-[var(--sim-z-modal)] flex items-center justify-center bg-black/60 backdrop-blur-[2px] p-4"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg rounded-[var(--sim-radius-xl)] bg-[var(--sim-bg-surface)] border border-[var(--sim-border-strong)] p-6 shadow-[var(--sim-shadow-3)] space-y-4"
            >
              <div className="flex items-center justify-between border-b border-[var(--sim-border-hairline)] pb-3">
                <h2 className="font-display text-xl font-bold text-[var(--sim-text-primary)]">
                  {legalModal === 'mentions' ? 'Mentions légales — SIMCOVA' : 'Conditions Générales de Vente'}
                </h2>
                <button
                  type="button"
                  aria-label="Fermer"
                  onClick={() => setLegalModal(null)}
                  className="p-1 text-[var(--sim-text-muted)] hover:text-[var(--sim-text-primary)]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-sm text-[var(--sim-text-secondary)] leading-relaxed whitespace-pre-line">
                {legalModal === 'mentions' ? settings.legalMentions : settings.cgvText}
              </p>
              <p className="text-xs text-[var(--sim-text-muted)]">
                Support : {settings.supportEmail} · {settings.supportPhone}
              </p>
            </div>
          </div>
        )}

        <ConsentBanner />
        <OfflineIndicator />
        <ToastContainer
          toasts={toasts}
          onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))}
        />
      </div>
    </MotionConfig>
  );
}

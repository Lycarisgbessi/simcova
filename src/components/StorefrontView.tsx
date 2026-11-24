import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  Search,
  ShieldCheck,
  Star,
  Heart,
  Plus,
  ArrowRight,
  PackageOpen,
  Truck,
  CreditCard,
  Clock,
  SlidersHorizontal,
  Share2,
  RotateCcw,
  ChevronRight,
  ChevronLeft,
  LayoutGrid,
  List,
  ShoppingBag,
  PackageSearch,
  Briefcase,
  X,
  Store,
  MapPin,
  Award,
} from 'lucide-react';
import { formatCurrency } from '../shared/rulesEngine';
import type { Category, Product, ProductCondition, Shop } from '../shared/types';
import { PWAInstallButton, PushNotificationManager } from './PWAControls';

interface StorefrontViewProps {
  products: Product[];
  categories: Category[];
  shops: Shop[];
  searchedShops: Shop[];
  shopsLoading: boolean;
  searchMode: 'products' | 'shops';
  currency: string;
  loading: boolean;
  searchQuery: string;
  selectedCategory: string;
  sortBy: string;
  certifiedOnly: boolean;
  minPrice: string;
  maxPrice: string;
  minStock: string;
  conditionFilter: ProductCondition | '';
  maxDeliveryFee: string;
  filterShop: string;
  minRating: number;
  vendorMinSales: number;
  vendorCertifiedOnly: boolean;
  vendorBadge: string;
  vendorCity: string;
  vendorMinRating: number;
  vendorSort: string;
  wishlistIds: string[];
  cartCount: number;
  cartSubtotal: number;
  onSearchModeChange: (mode: 'products' | 'shops') => void;
  onSearchChange: (q: string) => void;
  onCategoryChange: (catId: string) => void;
  onSortChange: (sort: string) => void;
  onCertifiedToggle: (val: boolean) => void;
  onMinPriceChange: (val: string) => void;
  onMaxPriceChange: (val: string) => void;
  onMinStockChange: (val: string) => void;
  onConditionFilterChange: (val: ProductCondition | '') => void;
  onMaxDeliveryFeeChange: (val: string) => void;
  onFilterShopChange: (val: string) => void;
  onMinRatingChange: (val: number) => void;
  onVendorMinSalesChange: (val: number) => void;
  onVendorCertifiedToggle: (val: boolean) => void;
  onVendorBadgeChange: (val: string) => void;
  onVendorCityChange: (val: string) => void;
  onVendorMinRatingChange: (val: number) => void;
  onVendorSortChange: (val: string) => void;
  onResetAllFilters: () => void;
  onToggleWishlist: (productId: string) => void;
  onSelectProduct: (product: Product) => void;
  onQuickAddToCart: (product: Product) => void;
  onOpenShop: (slug: string) => void;
  onOpenPro: () => void;
  onOpenCart: () => void;
  onOpenTracking: () => void;
  onDeepLink: (link: string) => void;
  onToast: (type: 'success' | 'error' | 'info', title: string, description?: string) => void;
}

const SHOWCASE_SLIDES = [
  {
    id: 'slide-tracteurs',
    kicker: 'Matériel agricole & exploitations',
    title: 'Tracteurs 4x4 haute puissance & équipements attelés',
    subtitle: 'Machines neuves et contrôlées disponibles immédiatement auprès de concessionnaires certifiés.',
    image: '/src/assets/images/hero_heavy_machinery_1795288076600.jpg',
    alt: 'Tracteur agricole 4x4 et mini-pelle hydraulique SIMCOVA',
    categoryId: 'cat-tracteurs',
    ctaLabel: 'Explorer les tracteurs',
  },
  {
    id: 'slide-btp',
    kicker: 'Terrassement & chantiers VRD',
    title: 'Mini-pelles hydrauliques sur chenilles & chargeuses',
    subtitle: 'Tarifs de transport affichés par zone avant commande et paiement sécurisé Jumia Africa.',
    image: '/src/assets/images/product_mini_excavator_1795288076740.jpg',
    alt: 'Mini-pelle hydraulique sur chenilles pour chantier BTP',
    categoryId: 'cat-hydraulique',
    ctaLabel: 'Voir le matériel BTP',
  },
  {
    id: 'slide-energie',
    kicker: 'Énergie & continuité industrielle',
    title: 'Groupes électrogènes diesel triphasés insonorisés',
    subtitle: 'De 30 kVA à 100 kVA avec démarrage automatique ATS et garantie fournisseur vérifiée.',
    image: '/src/assets/images/product_diesel_generator_1795288076702.jpg',
    alt: 'Groupe électrogène diesel industriel insonorisé',
    categoryId: 'cat-groupes',
    ctaLabel: 'Découvrir les groupes',
  },
];

export const StorefrontView: React.FC<StorefrontViewProps> = ({
  products,
  categories,
  shops,
  searchedShops,
  shopsLoading,
  searchMode,
  currency,
  loading,
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
  vendorMinSales,
  vendorCertifiedOnly,
  vendorBadge,
  vendorCity,
  vendorMinRating,
  vendorSort,
  wishlistIds,
  cartCount,
  cartSubtotal,
  onSearchModeChange,
  onSearchChange,
  onCategoryChange,
  onSortChange,
  onCertifiedToggle,
  onMinPriceChange,
  onMaxPriceChange,
  onMinStockChange,
  onConditionFilterChange,
  onMaxDeliveryFeeChange,
  onFilterShopChange,
  onMinRatingChange,
  onVendorMinSalesChange,
  onVendorCertifiedToggle,
  onVendorBadgeChange,
  onVendorCityChange,
  onVendorMinRatingChange,
  onVendorSortChange,
  onResetAllFilters,
  onToggleWishlist,
  onSelectProduct,
  onQuickAddToCart,
  onOpenShop,
  onOpenPro,
  onOpenCart,
  onOpenTracking,
  onDeepLink,
  onToast,
}) => {
  const [wishlistOnly, setWishlistOnly] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [slideIdx, setSlideIdx] = useState(0);

  const visibleCategories = useMemo(
    () => categories.filter((c) => c.active && !c.forbidden),
    [categories]
  );

  const availableBadges = useMemo(() => {
    const set = new Set<string>(['Vendeur certifié']);
    for (const s of shops) {
      for (const b of s.badges) set.add(b);
    }
    return [...set];
  }, [shops]);

  const availableCities = useMemo(() => {
    const set = new Set<string>();
    for (const s of shops) {
      if (s.city?.trim()) set.add(s.city.trim());
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [shops]);

  const categoryCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of products) {
      map[p.categoryId] = (map[p.categoryId] || 0) + 1;
    }
    return map;
  }, [products]);

  const displayedProducts = useMemo(() => {
    if (!wishlistOnly) return products;
    return products.filter((p) => wishlistIds.includes(p.id));
  }, [products, wishlistOnly, wishlistIds]);

  const activeAdvancedCount = useMemo(() => {
    if (searchMode === 'shops') {
      let c = 0;
      if (vendorMinSales > 0) c++;
      if (vendorCertifiedOnly) c++;
      if (vendorBadge) c++;
      if (vendorCity.trim()) c++;
      if (vendorMinRating > 0) c++;
      return c;
    }
    let count = 0;
    if (minPrice.trim()) count++;
    if (maxPrice.trim()) count++;
    if (minStock.trim()) count++;
    if (conditionFilter) count++;
    if (maxDeliveryFee.trim()) count++;
    if (filterShop) count++;
    if (minRating > 0) count++;
    return count;
  }, [
    searchMode,
    minPrice,
    maxPrice,
    minStock,
    conditionFilter,
    maxDeliveryFee,
    filterShop,
    minRating,
    vendorMinSales,
    vendorCertifiedOnly,
    vendorBadge,
    vendorCity,
    vendorMinRating,
  ]);

  const hasAnyFilter = Boolean(
    searchQuery.trim() ||
      selectedCategory !== 'all' ||
      sortBy !== 'recent' ||
      certifiedOnly ||
      wishlistOnly ||
      activeAdvancedCount > 0
  );

  useEffect(() => {
    const id = window.setInterval(() => {
      setSlideIdx((prev) => (prev + 1) % SHOWCASE_SLIDES.length);
    }, 6500);
    return () => window.clearInterval(id);
  }, []);

  const currentSlide = SHOWCASE_SLIDES[slideIdx];

  const copySearchUrl = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      onToast('success', 'Lien de recherche copié', 'Partagez cette URL pour retrouver les mêmes filtres.');
    } catch {
      onToast('info', 'URL active dans votre navigateur');
    }
  };

  const scrollToCatalog = () => {
    const el = document.getElementById('catalogue-simcova');
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  };

  const activeShopObj = shops.find((s) => s.id === filterShop || s.slug === filterShop);
  const activeCatObj = visibleCategories.find((c) => c.id === selectedCategory);

  const quickChips =
    searchMode === 'products'
      ? ['Tracteur 4x4', 'Mini-pelle', 'Groupe 50 kVA', 'Soudage']
      : ['AgriForce', 'Abidjan', 'Vendeur certifié', 'Tracteur'];

  return (
    <div className="bg-[var(--sim-bg-canvas)]">
      {/* Barre de recherche double mode (Produits / Vendeurs) */}
      <div className="border-b border-[var(--sim-steel-800)] bg-[var(--sim-steel-900)] text-white">
        <div className="mx-auto max-w-[1440px] px-4 py-2.5 sm:px-6 space-y-2">
          <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:gap-3">
            {/* Sélecteur de mode de recherche Produits / Vendeurs */}
            <div
              role="group"
              aria-label="Mode de recherche"
              className="inline-flex rounded-[var(--sim-radius-md)] border border-[#37475A] bg-[#131921] p-0.5 shrink-0 self-start lg:self-auto"
            >
              <button
                type="button"
                onClick={() => onSearchModeChange('products')}
                aria-pressed={searchMode === 'products'}
                className={`inline-flex items-center gap-1.5 rounded-[var(--sim-radius-sm)] px-3 py-1.5 text-xs font-bold transition-colors whitespace-nowrap ${
                  searchMode === 'products'
                    ? 'bg-[#F59E0B] text-[#0F1111]'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <PackageSearch className="w-3.5 h-3.5" />
                <span>Produits</span>
              </button>
              <button
                type="button"
                onClick={() => onSearchModeChange('shops')}
                aria-pressed={searchMode === 'shops'}
                className={`inline-flex items-center gap-1.5 rounded-[var(--sim-radius-sm)] px-3 py-1.5 text-xs font-bold transition-colors whitespace-nowrap ${
                  searchMode === 'shops'
                    ? 'bg-[#F59E0B] text-[#0F1111]'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <Store className="w-3.5 h-3.5" />
                <span>Vendeurs</span>
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                scrollToCatalog();
              }}
              className="flex flex-1 items-stretch overflow-hidden rounded-[var(--sim-radius-md)] border border-[#3B4A5A] bg-white focus-within:ring-2 focus-within:ring-[#F59E0B]"
            >
              {searchMode === 'products' ? (
                <>
                  <label htmlFor="bar-category-scope" className="sr-only">
                    Rayon de recherche
                  </label>
                  <select
                    id="bar-category-scope"
                    value={selectedCategory}
                    onChange={(e) => onCategoryChange(e.target.value)}
                    className="hidden sm:block max-w-[185px] border-r border-[#D5D9D9] bg-[#F3F4F6] px-3 py-2 text-xs font-semibold text-[#0F1111] focus:outline-none truncate"
                  >
                    <option value="all">Tous les rayons</option>
                    {visibleCategories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </>
              ) : (
                <>
                  <label htmlFor="bar-vendor-city-scope" className="sr-only">
                    Ville du concessionnaire
                  </label>
                  <select
                    id="bar-vendor-city-scope"
                    value={vendorCity}
                    onChange={(e) => onVendorCityChange(e.target.value)}
                    className="hidden sm:block max-w-[175px] border-r border-[#D5D9D9] bg-[#F3F4F6] px-3 py-2 text-xs font-semibold text-[#0F1111] focus:outline-none truncate"
                  >
                    <option value="">Toutes les villes</option>
                    {availableCities.map((city) => (
                      <option key={city} value={city}>
                        {city}
                      </option>
                    ))}
                  </select>
                </>
              )}

              <label htmlFor="bar-search-input" className="sr-only">
                {searchMode === 'products'
                  ? 'Rechercher un produit dans le catalogue SIMCOVA'
                  : 'Rechercher un vendeur ou concessionnaire SIMCOVA'}
              </label>
              <input
                id="bar-search-input"
                type="search"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={
                  searchMode === 'products'
                    ? 'Tracteur 4x4, mini-pelle BTP, groupe 50 kVA, référence ou concessionnaire...'
                    : 'Nom du vendeur, ville (Abidjan, Dakar...), spécialité, badge ou certification...'
                }
                className="min-w-0 flex-1 bg-white px-3.5 py-2 text-sm text-[#0F1111] placeholder:text-[#565959] focus:outline-none"
              />

              <button
                type="submit"
                aria-label="Rechercher"
                className="inline-flex items-center justify-center gap-1.5 bg-[#F59E0B] px-4 py-2 text-xs font-bold text-[#0F1111] hover:bg-[#D97706] transition-colors shrink-0"
              >
                <Search className="w-4 h-4" />
                <span className="hidden sm:inline">Rechercher</span>
              </button>
            </form>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() =>
                  searchMode === 'products'
                    ? onCertifiedToggle(!certifiedOnly)
                    : onVendorCertifiedToggle(!vendorCertifiedOnly)
                }
                className={`inline-flex items-center gap-1.5 rounded-[var(--sim-radius-md)] border px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                  (searchMode === 'products' ? certifiedOnly : vendorCertifiedOnly)
                    ? 'border-[#F59E0B] bg-[#F59E0B] text-[#0F1111]'
                    : 'border-[#37475A] bg-[#131921] text-slate-200 hover:border-[#F59E0B]'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Vendeurs certifiés</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  onSearchModeChange('products');
                  setWishlistOnly((v) => !v);
                }}
                className={`inline-flex items-center gap-1.5 rounded-[var(--sim-radius-md)] border px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                  wishlistOnly && searchMode === 'products'
                    ? 'border-[#F59E0B] bg-[#F59E0B] text-[#0F1111]'
                    : 'border-[#37475A] bg-[#131921] text-slate-200 hover:border-[#F59E0B]'
                }`}
              >
                <Heart className={`w-3.5 h-3.5 ${wishlistOnly ? 'fill-current' : ''}`} />
                <span>Favoris ({wishlistIds.length})</span>
              </button>

              <div className="hidden xl:flex items-center gap-2">
                <PWAInstallButton
                  onInstalledToast={() =>
                    onToast('success', 'Application installée', 'SIMCOVA est maintenant disponible sur votre écran d’accueil.')
                  }
                />
                <PushNotificationManager onDeepLink={onDeepLink} onToast={onToast} />
              </div>
            </div>
          </div>

          {/* Suggestions de recherche rapide */}
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-300">
            <span className="text-slate-400 font-medium">Recherches fréquentes :</span>
            {quickChips.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => {
                  onSearchChange(chip);
                  scrollToCatalog();
                }}
                className="rounded-[var(--sim-radius-sm)] border border-[#37475A] bg-[#131921] px-2 py-0.5 font-medium text-slate-200 hover:border-[#F59E0B] hover:text-[#F59E0B] transition-colors"
              >
                {chip}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Cockpit Marketplace style Alibaba : Arbre des rayons + Vitrine centrale + Bloc Acheteur */}
      <section className="mx-auto max-w-[1440px] px-4 pt-4 sm:px-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
          {/* Colonne gauche : Rayons & Catégories */}
          <aside className="hidden lg:flex lg:col-span-3 flex-col justify-between rounded-[var(--sim-radius-md)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] overflow-hidden shadow-[var(--sim-shadow-1)]">
            <div>
              <div className="border-b border-[var(--sim-border-hairline)] bg-[var(--sim-bg-subtle)] px-4 py-2.5 flex items-center justify-between">
                <h2 className="font-display text-sm font-bold text-[var(--sim-text-primary)]">
                  Rayons &amp; Équipements
                </h2>
                <span className="font-mono-nums text-[11px] font-semibold text-[var(--sim-text-muted)]">
                  {products.length} fiches
                </span>
              </div>
              <ul className="divide-y divide-[var(--sim-border-hairline)]">
                <li>
                  <button
                    type="button"
                    onClick={() => {
                      onCategoryChange('all');
                      scrollToCatalog();
                    }}
                    className={`w-full flex items-center justify-between px-4 py-2 text-left text-xs font-semibold transition-colors ${
                      selectedCategory === 'all'
                        ? 'bg-[var(--sim-accent-50)] text-[var(--sim-accent-600)]'
                        : 'text-[var(--sim-text-primary)] hover:bg-[var(--sim-bg-subtle)]'
                    }`}
                  >
                    <span>Tout le parc matériel</span>
                    <ChevronRight className="w-3.5 h-3.5 text-[var(--sim-text-muted)]" />
                  </button>
                </li>
                {visibleCategories.map((cat) => (
                  <li key={cat.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onCategoryChange(cat.id);
                        scrollToCatalog();
                      }}
                      className={`w-full flex items-center justify-between gap-2 px-4 py-2 text-left text-xs font-medium transition-colors ${
                        selectedCategory === cat.id
                          ? 'bg-[var(--sim-accent-50)] font-bold text-[var(--sim-accent-600)]'
                          : 'text-[var(--sim-text-secondary)] hover:bg-[var(--sim-bg-subtle)] hover:text-[var(--sim-text-primary)]'
                      }`}
                    >
                      <span className="truncate">{cat.name}</span>
                      <span className="inline-flex items-center gap-1 font-mono-nums text-[11px] text-[var(--sim-text-muted)] shrink-0">
                        {categoryCounts[cat.id] ? `(${categoryCounts[cat.id]})` : ''}
                        <ChevronRight className="w-3.5 h-3.5" />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="border-t border-[var(--sim-border-hairline)] bg-[var(--sim-bg-subtle)] px-4 py-2.5 flex items-center justify-between text-xs">
              <span className="text-[var(--sim-text-muted)] font-medium">
                {shops.length} concessionnaire{shops.length > 1 ? 's' : ''} actifs
              </span>
              <button
                type="button"
                onClick={onOpenPro}
                className="font-bold text-[var(--sim-accent-600)] hover:underline"
              >
                Vendre →
              </button>
            </div>
          </aside>

          {/* Colonne centrale : Carrousel / Vitrine engins lourds */}
          <div className="lg:col-span-6">
            <div className="relative h-[250px] sm:h-[300px] lg:h-full min-h-[295px] overflow-hidden rounded-[var(--sim-radius-md)] border border-[var(--sim-border-hairline)] bg-[var(--sim-steel-950)] shadow-[var(--sim-shadow-1)]">
              <img
                src={currentSlide.image}
                alt={currentSlide.alt}
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#131921]/95 via-[#131921]/70 to-[#131921]/10" />

              <div className="absolute top-3 right-3 flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label="Diapositive précédente"
                  onClick={() => setSlideIdx((prev) => (prev - 1 + SHOWCASE_SLIDES.length) % SHOWCASE_SLIDES.length)}
                  className="flex h-8 w-8 items-center justify-center rounded-[var(--sim-radius-sm)] border border-white/15 bg-[#131921]/80 text-white hover:bg-[#131921] transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  aria-label="Diapositive suivante"
                  onClick={() => setSlideIdx((prev) => (prev + 1) % SHOWCASE_SLIDES.length)}
                  className="flex h-8 w-8 items-center justify-center rounded-[var(--sim-radius-sm)] border border-white/15 bg-[#131921]/80 text-white hover:bg-[#131921] transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <div className="absolute inset-x-0 bottom-0 p-5 sm:p-6">
                <p className="font-mono-nums text-xs font-medium tracking-wide text-[#F59E0B]">
                  {currentSlide.kicker}
                </p>
                <h1 className="mt-1 font-display text-2xl sm:text-3xl font-bold tracking-tight text-white leading-tight max-w-xl">
                  {currentSlide.title}
                </h1>
                <p className="mt-1.5 text-xs sm:text-sm text-slate-200 max-w-lg line-clamp-2">
                  {currentSlide.subtitle}
                </p>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      const exists = visibleCategories.some((c) => c.id === currentSlide.categoryId);
                      onCategoryChange(exists ? currentSlide.categoryId : 'all');
                      scrollToCatalog();
                    }}
                    className="inline-flex items-center gap-2 rounded-[var(--sim-radius-md)] bg-[#F59E0B] px-4 py-2 text-xs font-bold text-[#0F1111] hover:bg-[#D97706] transition-colors"
                  >
                    <span>{currentSlide.ctaLabel}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>

                  <div className="flex items-center gap-1.5">
                    {SHOWCASE_SLIDES.map((s, idx) => (
                      <button
                        key={s.id}
                        type="button"
                        aria-label={`Afficher ${s.kicker}`}
                        onClick={() => setSlideIdx(idx)}
                        className={`h-1.5 transition-all rounded-[var(--sim-radius-sm)] ${
                          idx === slideIdx ? 'w-7 bg-[#F59E0B]' : 'w-3 bg-white/45 hover:bg-white/80'
                        }`}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Colonne droite : Panneau d'accès rapide Acheteur & Sourcing Pro */}
          <div className="lg:col-span-3 flex flex-col gap-3">
            <div className="flex-1 rounded-[var(--sim-radius-md)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-4 shadow-[var(--sim-shadow-1)] flex flex-col justify-between">
              <div>
                <p className="text-[11px] font-semibold text-[var(--sim-text-muted)]">
                  Achat direct sans compte
                </p>
                <h2 className="mt-1 font-display text-lg font-bold tracking-tight text-[var(--sim-text-primary)]">
                  {cartCount > 0 ? `Votre panier (${cartCount} article${cartCount > 1 ? 's' : ''})` : 'Commandez & suivez vos machines'}
                </h2>
                <p className="mt-1 text-xs text-[var(--sim-text-secondary)] leading-relaxed">
                  {cartCount > 0
                    ? `Sous-total en cours : ${formatCurrency(cartSubtotal, currency)} — Livraison calculée par zone.`
                    : 'Paiement sécurisé Jumia Africa et lien de suivi horodaté envoyé dès validation.'}
                </p>
              </div>

              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2">
                {cartCount > 0 ? (
                  <button
                    type="button"
                    onClick={onOpenCart}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-[var(--sim-radius-md)] bg-[#F59E0B] px-3.5 py-2 text-xs font-bold text-[#0F1111] hover:bg-[#D97706] transition-colors"
                  >
                    <ShoppingBag className="w-3.5 h-3.5" />
                    <span>Passer commande</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onOpenTracking}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-[var(--sim-radius-md)] bg-[#131921] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#232F3E] transition-colors"
                  >
                    <PackageSearch className="w-3.5 h-3.5 text-[#F59E0B]" />
                    <span>Suivre une commande</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={onOpenPro}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-[var(--sim-radius-md)] border border-[var(--sim-border-strong)] bg-[var(--sim-bg-surface)] px-3.5 py-2 text-xs font-semibold text-[var(--sim-text-primary)] hover:border-[var(--sim-accent-500)] transition-colors"
                >
                  <Briefcase className="w-3.5 h-3.5 text-[var(--sim-accent-500)]" />
                  <span>Devenir concessionnaire</span>
                </button>
              </div>
            </div>

            <div className="rounded-[var(--sim-radius-md)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-3.5 shadow-[var(--sim-shadow-1)] grid grid-cols-2 gap-2.5 text-[11px]">
              <div className="flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 shrink-0 text-[var(--sim-success-text)] mt-0.5" />
                <div>
                  <p className="font-bold text-[var(--sim-text-primary)]">Agréés KYC</p>
                  <p className="text-[var(--sim-text-muted)]">Vendeurs vérifiés</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <CreditCard className="w-4 h-4 shrink-0 text-[var(--sim-accent-500)] mt-0.5" />
                <div>
                  <p className="font-bold text-[var(--sim-text-primary)]">Jumia Africa</p>
                  <p className="text-[var(--sim-text-muted)]">Mobile Money &amp; CB</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Truck className="w-4 h-4 shrink-0 text-[var(--sim-accent-500)] mt-0.5" />
                <div>
                  <p className="font-bold text-[var(--sim-text-primary)]">Tarifs par zone</p>
                  <p className="text-[var(--sim-text-muted)]">Abidjan · Intérieur</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Clock className="w-4 h-4 shrink-0 text-[var(--sim-accent-500)] mt-0.5" />
                <div>
                  <p className="font-bold text-[var(--sim-text-primary)]">Suivi horodaté</p>
                  <p className="text-[var(--sim-text-muted)]">Sans création compte</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Section Catalogue Principale : Rail de filtres à facettes gauche + Grille/Liste Amazon/Alibaba */}
      <section id="catalogue-simcova" className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6">
        {/* Bouton tiroir filtres sur mobile */}
        <div className="mb-3 flex items-center justify-between gap-3 lg:hidden">
          <button
            type="button"
            onClick={() => setMobileFiltersOpen((v) => !v)}
            aria-expanded={mobileFiltersOpen}
            className="inline-flex items-center gap-2 rounded-[var(--sim-radius-md)] border border-[var(--sim-border-strong)] bg-[var(--sim-bg-surface)] px-3.5 py-2 text-xs font-semibold text-[var(--sim-text-primary)]"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-[var(--sim-accent-500)]" />
            <span>Filtres{activeAdvancedCount > 0 ? ` (${activeAdvancedCount})` : ''}</span>
          </button>
          <span className="font-mono-nums text-xs font-semibold text-[var(--sim-text-muted)]">
            {searchMode === 'shops'
              ? `${searchedShops.length} vendeur${searchedShops.length > 1 ? 's' : ''}`
              : `${displayedProducts.length} résultat${displayedProducts.length > 1 ? 's' : ''}`}
          </span>
        </div>

        <div className="flex flex-col lg:flex-row gap-5 items-start">
          {/* Rail gauche persistant de filtres contextuels (Produits ou Vendeurs) */}
          <aside
            aria-label={searchMode === 'shops' ? 'Filtres vendeurs' : 'Filtres du catalogue'}
            className={`w-full lg:w-64 shrink-0 rounded-[var(--sim-radius-md)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-4 shadow-[var(--sim-shadow-1)] space-y-5 ${
              mobileFiltersOpen ? 'block' : 'hidden lg:block'
            }`}
          >
            <div className="flex items-center justify-between border-b border-[var(--sim-border-hairline)] pb-2.5">
              <h2 className="font-display text-sm font-bold text-[var(--sim-text-primary)]">
                {searchMode === 'shops' ? 'Filtres vendeurs' : 'Filtres produits'}
              </h2>
              {hasAnyFilter && (
                <button
                  type="button"
                  onClick={() => {
                    setWishlistOnly(false);
                    onResetAllFilters();
                  }}
                  className="text-[11px] font-bold text-[var(--sim-accent-600)] hover:underline"
                >
                  Réinitialiser
                </button>
              )}
            </div>

            {searchMode === 'shops' ? (
              <>
                <div>
                  <label htmlFor="vendor-min-sales" className="sim-label">
                    Ventes déjà effectuées (min.)
                  </label>
                  <select
                    id="vendor-min-sales"
                    value={vendorMinSales}
                    onChange={(e) => onVendorMinSalesChange(Number(e.target.value))}
                    className="sim-input text-xs py-1.5"
                  >
                    <option value={0}>Toutes expériences</option>
                    <option value={1}>1+ vente confirmée</option>
                    <option value={2}>2+ ventes confirmées</option>
                    <option value={5}>5+ ventes confirmées</option>
                  </select>
                </div>

                <div className="border-t border-[var(--sim-border-hairline)] pt-4">
                  <label htmlFor="vendor-badge-filter" className="sim-label">
                    Certification &amp; Badges
                  </label>
                  <select
                    id="vendor-badge-filter"
                    value={vendorBadge}
                    onChange={(e) => onVendorBadgeChange(e.target.value)}
                    className="sim-input text-xs py-1.5"
                  >
                    <option value="">Tous les badges</option>
                    {availableBadges.map((badge) => (
                      <option key={badge} value={badge}>
                        {badge}
                      </option>
                    ))}
                  </select>
                  <label className="mt-2.5 flex items-center gap-2 cursor-pointer text-xs text-[var(--sim-text-primary)] font-medium">
                    <input
                      type="checkbox"
                      checked={vendorCertifiedOnly}
                      onChange={(e) => onVendorCertifiedToggle(e.target.checked)}
                    />
                    <span>Uniquement vendeurs certifiés</span>
                  </label>
                </div>

                <div className="border-t border-[var(--sim-border-hairline)] pt-4">
                  <label htmlFor="vendor-city-filter" className="sim-label">
                    Ville / Localisation
                  </label>
                  <input
                    id="vendor-city-filter"
                    type="text"
                    value={vendorCity}
                    onChange={(e) => onVendorCityChange(e.target.value)}
                    placeholder="Ex. Abidjan, Yamoussoukro..."
                    className="sim-input text-xs py-1.5"
                  />
                </div>

                <div className="border-t border-[var(--sim-border-hairline)] pt-4">
                  <label htmlFor="vendor-rating-filter" className="sim-label">
                    Note minimale du vendeur
                  </label>
                  <select
                    id="vendor-rating-filter"
                    value={vendorMinRating}
                    onChange={(e) => onVendorMinRatingChange(Number(e.target.value))}
                    className="sim-input text-xs py-1.5"
                  >
                    <option value={0}>Toutes les notes</option>
                    <option value={4}>4★ et plus</option>
                    <option value={4.5}>4,5★ et plus</option>
                  </select>
                </div>
              </>
            ) : (
              <>
                {/* Facette Catégories */}
                <div>
                  <p className="sim-label">Catégorie</p>
                  <div className="space-y-1">
                    <button
                      type="button"
                      onClick={() => onCategoryChange('all')}
                      className={`w-full text-left px-2 py-1 rounded-[var(--sim-radius-sm)] text-xs transition-colors ${
                        selectedCategory === 'all'
                          ? 'bg-[var(--sim-accent-50)] font-bold text-[var(--sim-accent-600)]'
                          : 'text-[var(--sim-text-secondary)] hover:bg-[var(--sim-bg-subtle)]'
                      }`}
                    >
                      Tout le matériel
                    </button>
                    {visibleCategories.map((cat) => (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => onCategoryChange(cat.id)}
                        className={`w-full flex items-center justify-between gap-2 text-left px-2 py-1 rounded-[var(--sim-radius-sm)] text-xs transition-colors ${
                          selectedCategory === cat.id
                            ? 'bg-[var(--sim-accent-50)] font-bold text-[var(--sim-accent-600)]'
                            : 'text-[var(--sim-text-secondary)] hover:bg-[var(--sim-bg-subtle)]'
                        }`}
                      >
                        <span className="truncate">{cat.name}</span>
                        {categoryCounts[cat.id] ? (
                          <span className="font-mono-nums text-[11px] text-[var(--sim-text-muted)]">
                            {categoryCounts[cat.id]}
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Facette Budget / Prix */}
                <div className="border-t border-[var(--sim-border-hairline)] pt-4">
                  <p className="sim-label">Budget / Tarifs ({currency})</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label htmlFor="filter-min-price" className="sr-only">
                        Prix minimum ({currency})
                      </label>
                      <input
                        id="filter-min-price"
                        type="number"
                        min={0}
                        placeholder="Min"
                        value={minPrice}
                        onChange={(e) => onMinPriceChange(e.target.value)}
                        className="sim-input text-xs py-1.5 font-mono-nums"
                      />
                    </div>
                    <div>
                      <label htmlFor="filter-max-price" className="sr-only">
                        Prix maximum ({currency})
                      </label>
                      <input
                        id="filter-max-price"
                        type="number"
                        min={0}
                        placeholder="Max"
                        value={maxPrice}
                        onChange={(e) => onMaxPriceChange(e.target.value)}
                        className="sim-input text-xs py-1.5 font-mono-nums"
                      />
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {[
                      { label: '< 1 M', min: '', max: '1000000' },
                      { label: '1 M – 10 M', min: '1000000', max: '10000000' },
                      { label: '> 10 M', min: '10000000', max: '' },
                    ].map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => {
                          onMinPriceChange(preset.min);
                          onMaxPriceChange(preset.max);
                        }}
                        className="rounded-[var(--sim-radius-sm)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-subtle)] px-2 py-1 font-mono-nums text-[11px] font-semibold text-[var(--sim-text-secondary)] hover:border-[var(--sim-accent-500)] hover:text-[var(--sim-text-primary)]"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Quantité / Stock min & État & Livraison max */}
                <div className="border-t border-[var(--sim-border-hairline)] pt-4 space-y-3">
                  <div>
                    <label htmlFor="filter-min-stock" className="sim-label">
                      Quantité min. en stock
                    </label>
                    <input
                      id="filter-min-stock"
                      type="number"
                      min={1}
                      placeholder="Ex. 2 unités"
                      value={minStock}
                      onChange={(e) => onMinStockChange(e.target.value)}
                      className="sim-input text-xs py-1.5 font-mono-nums"
                    />
                  </div>
                  <div>
                    <label htmlFor="filter-condition" className="sim-label">
                      État du matériel
                    </label>
                    <select
                      id="filter-condition"
                      value={conditionFilter}
                      onChange={(e) => onConditionFilterChange(e.target.value as ProductCondition | '')}
                      className="sim-input text-xs py-1.5"
                    >
                      <option value="">Tous les états</option>
                      <option value="Neuf">Neuf</option>
                      <option value="Reconditionné">Reconditionné</option>
                      <option value="Artisanal">Artisanal</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="filter-max-delivery" className="sim-label">
                      Livraison max ({currency})
                    </label>
                    <input
                      id="filter-max-delivery"
                      type="number"
                      min={0}
                      placeholder="Ex. 5000"
                      value={maxDeliveryFee}
                      onChange={(e) => onMaxDeliveryFeeChange(e.target.value)}
                      className="sim-input text-xs py-1.5 font-mono-nums"
                    />
                  </div>
                </div>

                {/* Facette Concessionnaire */}
                <div className="border-t border-[var(--sim-border-hairline)] pt-4">
                  <label htmlFor="filter-shop" className="sim-label">
                    Concessionnaire
                  </label>
                  <select
                    id="filter-shop"
                    value={filterShop}
                    onChange={(e) => onFilterShopChange(e.target.value)}
                    className="sim-input text-xs py-1.5"
                  >
                    <option value="">Tous les concessionnaires</option>
                    {shops.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Facette Note clients */}
                <div className="border-t border-[var(--sim-border-hairline)] pt-4">
                  <label htmlFor="filter-rating" className="sim-label">
                    Note clients minimale
                  </label>
                  <select
                    id="filter-rating"
                    value={minRating}
                    onChange={(e) => onMinRatingChange(Number(e.target.value))}
                    className="sim-input text-xs py-1.5"
                  >
                    <option value={0}>Toutes les notes</option>
                    <option value={4}>4★ et plus</option>
                    <option value={4.5}>4,5★ et plus</option>
                  </select>
                </div>

                {/* Critères & Partage */}
                <div className="border-t border-[var(--sim-border-hairline)] pt-4 space-y-2.5 text-xs">
                  <label className="flex items-center gap-2 cursor-pointer text-[var(--sim-text-primary)] font-medium">
                    <input
                      type="checkbox"
                      checked={certifiedOnly}
                      onChange={(e) => onCertifiedToggle(e.target.checked)}
                    />
                    <span>Concessionnaires certifiés</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-[var(--sim-text-primary)] font-medium">
                    <input
                      type="checkbox"
                      checked={wishlistOnly}
                      onChange={(e) => setWishlistOnly(e.target.checked)}
                    />
                    <span>Ma sélection uniquement ({wishlistIds.length})</span>
                  </label>
                </div>
              </>
            )}

            <div className="border-t border-[var(--sim-border-hairline)] pt-3">
              <button
                type="button"
                onClick={copySearchUrl}
                className="w-full sim-btn-secondary py-1.5 text-[11px]"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span>Copier le lien de recherche</span>
              </button>
            </div>
          </aside>

          {/* Colonne principale résultats (Produits ou Vendeurs) */}
          <div className="flex-1 min-w-0 w-full space-y-4">
            <div className="rounded-[var(--sim-radius-md)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] px-4 py-2.5 shadow-[var(--sim-shadow-1)] flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-mono-nums font-bold text-[var(--sim-text-primary)]">
                  {searchMode === 'shops'
                    ? `${searchedShops.length} vendeur${searchedShops.length > 1 ? 's' : ''} trouvé${searchedShops.length > 1 ? 's' : ''}`
                    : `${displayedProducts.length} résultat${displayedProducts.length > 1 ? 's' : ''}`}
                </span>
                {searchMode === 'products' && activeCatObj && (
                  <button
                    type="button"
                    onClick={() => onCategoryChange('all')}
                    className="inline-flex items-center gap-1 rounded-[var(--sim-radius-sm)] border border-[var(--sim-border-strong)] bg-[var(--sim-bg-subtle)] px-2 py-0.5 font-semibold text-[var(--sim-text-primary)] hover:border-[var(--sim-accent-500)]"
                  >
                    <span>{activeCatObj.name}</span>
                    <X className="w-3 h-3" />
                  </button>
                )}
                {searchMode === 'products' && activeShopObj && (
                  <button
                    type="button"
                    onClick={() => onFilterShopChange('')}
                    className="inline-flex items-center gap-1 rounded-[var(--sim-radius-sm)] border border-[var(--sim-border-strong)] bg-[var(--sim-bg-subtle)] px-2 py-0.5 font-semibold text-[var(--sim-text-primary)] hover:border-[var(--sim-accent-500)]"
                  >
                    <span>{activeShopObj.name}</span>
                    <X className="w-3 h-3" />
                  </button>
                )}
                {searchMode === 'products' && conditionFilter && (
                  <button
                    type="button"
                    onClick={() => onConditionFilterChange('')}
                    className="inline-flex items-center gap-1 rounded-[var(--sim-radius-sm)] border border-[var(--sim-border-strong)] bg-[var(--sim-bg-subtle)] px-2 py-0.5 font-semibold text-[var(--sim-text-primary)] hover:border-[var(--sim-accent-500)]"
                  >
                    <span>État : {conditionFilter}</span>
                    <X className="w-3 h-3" />
                  </button>
                )}
                {searchMode === 'shops' && vendorBadge && (
                  <button
                    type="button"
                    onClick={() => onVendorBadgeChange('')}
                    className="inline-flex items-center gap-1 rounded-[var(--sim-radius-sm)] border border-[var(--sim-border-strong)] bg-[var(--sim-bg-subtle)] px-2 py-0.5 font-semibold text-[var(--sim-text-primary)] hover:border-[var(--sim-accent-500)]"
                  >
                    <span>Badge : {vendorBadge}</span>
                    <X className="w-3 h-3" />
                  </button>
                )}
                {searchMode === 'shops' && vendorMinSales > 0 && (
                  <button
                    type="button"
                    onClick={() => onVendorMinSalesChange(0)}
                    className="inline-flex items-center gap-1 rounded-[var(--sim-radius-sm)] border border-[var(--sim-border-strong)] bg-[var(--sim-bg-subtle)] px-2 py-0.5 font-semibold text-[var(--sim-text-primary)] hover:border-[var(--sim-accent-500)]"
                  >
                    <span>{vendorMinSales}+ ventes</span>
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2.5 ml-auto">
                {searchMode === 'products' ? (
                  <>
                    <div className="inline-flex items-center rounded-[var(--sim-radius-sm)] border border-[var(--sim-border-strong)] bg-[var(--sim-bg-subtle)] p-0.5">
                      <button
                        type="button"
                        aria-label="Vue grille"
                        aria-pressed={viewMode === 'grid'}
                        onClick={() => setViewMode('grid')}
                        className={`rounded-[var(--sim-radius-sm)] p-1.5 transition-colors ${
                          viewMode === 'grid'
                            ? 'bg-[var(--sim-bg-surface)] text-[var(--sim-text-primary)] shadow-sm'
                            : 'text-[var(--sim-text-muted)] hover:text-[var(--sim-text-primary)]'
                        }`}
                      >
                        <LayoutGrid className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label="Vue liste détaillée"
                        aria-pressed={viewMode === 'list'}
                        onClick={() => setViewMode('list')}
                        className={`rounded-[var(--sim-radius-sm)] p-1.5 transition-colors ${
                          viewMode === 'list'
                            ? 'bg-[var(--sim-bg-surface)] text-[var(--sim-text-primary)] shadow-sm'
                            : 'text-[var(--sim-text-muted)] hover:text-[var(--sim-text-primary)]'
                        }`}
                      >
                        <List className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="inline-flex items-center gap-1.5 rounded-[var(--sim-radius-sm)] border border-[var(--sim-border-strong)] bg-[var(--sim-bg-surface)] px-2.5 py-1.5">
                      <label htmlFor="catalog-sort" className="text-xs font-medium text-[var(--sim-text-muted)]">
                        Trier :
                      </label>
                      <select
                        id="catalog-sort"
                        value={sortBy}
                        onChange={(e) => onSortChange(e.target.value)}
                        className="bg-transparent text-xs font-semibold text-[var(--sim-text-primary)] focus:outline-none"
                      >
                        <option value="recent">Arrivages récents</option>
                        <option value="relevance">Pertinence</option>
                        <option value="rating">Mieux notés</option>
                        <option value="price_asc">Prix croissant</option>
                        <option value="price_desc">Prix décroissant</option>
                      </select>
                    </div>
                  </>
                ) : (
                  <div className="inline-flex items-center gap-1.5 rounded-[var(--sim-radius-sm)] border border-[var(--sim-border-strong)] bg-[var(--sim-bg-surface)] px-2.5 py-1.5">
                    <label htmlFor="vendor-sort" className="text-xs font-medium text-[var(--sim-text-muted)]">
                      Trier :
                    </label>
                    <select
                      id="vendor-sort"
                      value={vendorSort}
                      onChange={(e) => onVendorSortChange(e.target.value)}
                      className="bg-transparent text-xs font-semibold text-[var(--sim-text-primary)] focus:outline-none"
                    >
                      <option value="sales_desc">Plus de ventes réalisées</option>
                      <option value="rating">Mieux notés</option>
                      <option value="name">Nom A–Z</option>
                    </select>
                  </div>
                )}
              </div>
            </div>

            {searchMode === 'shops' ? (
              shopsLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {[1, 2, 3].map((idx) => (
                    <div key={idx} className="h-48 rounded-[var(--sim-radius-md)] sim-skeleton" />
                  ))}
                </div>
              ) : searchedShops.length === 0 ? (
                <div className="rounded-[var(--sim-radius-md)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] py-16 px-6 text-center shadow-[var(--sim-shadow-1)]">
                  <Store className="mx-auto w-10 h-10 text-[var(--sim-text-muted)]" />
                  <h2 className="mt-4 font-display text-xl font-bold text-[var(--sim-text-primary)]">
                    Aucun vendeur ne correspond à vos critères
                  </h2>
                  <p className="mt-1.5 text-sm text-[var(--sim-text-secondary)]">
                    Ajustez les filtres de ventes réalisées, certification, badge ou ville pour élargir votre sélection.
                  </p>
                  <button
                    type="button"
                    onClick={onResetAllFilters}
                    className="mt-5 inline-flex items-center gap-2 rounded-[var(--sim-radius-md)] bg-[#F59E0B] px-5 py-2.5 text-xs font-bold text-[#0F1111] hover:bg-[#D97706] transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Réinitialiser les filtres</span>
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {searchedShops.map((shop) => {
                    const isCertified = shop.vendorStatus === 'certifie' || shop.badges.includes('Vendeur certifié');
                    return (
                      <article
                        key={shop.id}
                        className="flex flex-col justify-between rounded-[var(--sim-radius-md)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-5 shadow-[var(--sim-shadow-1)] hover:border-[var(--sim-border-strong)] transition-colors"
                      >
                        <div>
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                              {shop.logoUrl ? (
                                <img
                                  src={shop.logoUrl}
                                  alt={shop.name}
                                  className="h-12 w-12 shrink-0 rounded-[var(--sim-radius-sm)] object-cover border border-[var(--sim-border-hairline)]"
                                />
                              ) : (
                                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[var(--sim-radius-sm)] bg-[#131921] font-display text-base font-extrabold uppercase text-[#F59E0B]">
                                  {shop.name.slice(0, 2)}
                                </div>
                              )}
                              <div className="min-w-0">
                                <h3 className="font-display text-lg font-bold text-[var(--sim-text-primary)] truncate">
                                  {shop.name}
                                </h3>
                                <p className="inline-flex items-center gap-1 text-xs text-[var(--sim-text-muted)]">
                                  <MapPin className="w-3.5 h-3.5" />
                                  <span>{shop.city || 'Livraison nationale'}</span>
                                </p>
                              </div>
                            </div>
                            {isCertified && (
                              <span className="inline-flex items-center gap-1 rounded-[var(--sim-radius-sm)] bg-[var(--sim-success-bg)] px-2 py-0.5 text-[11px] font-bold text-[var(--sim-success-text)] shrink-0">
                                <ShieldCheck className="w-3.5 h-3.5" />
                                Certifié
                              </span>
                            )}
                          </div>

                          <p className="mt-3 text-xs text-[var(--sim-text-secondary)] line-clamp-2 leading-relaxed">
                            {shop.description}
                          </p>

                          <div className="mt-3 grid grid-cols-3 gap-2 rounded-[var(--sim-radius-sm)] bg-[var(--sim-bg-subtle)] px-3 py-2 text-xs">
                            <div>
                              <span className="text-[11px] text-[var(--sim-text-muted)]">Ventes</span>
                              <p className="font-mono-nums font-bold text-[var(--sim-text-primary)]">
                                {shop.salesCount ?? 0}
                              </p>
                            </div>
                            <div>
                              <span className="text-[11px] text-[var(--sim-text-muted)]">Équipements</span>
                              <p className="font-mono-nums font-bold text-[var(--sim-text-primary)]">
                                {shop.publishedProductsCount ?? 0}
                              </p>
                            </div>
                            <div>
                              <span className="text-[11px] text-[var(--sim-text-muted)]">Note</span>
                              <p className="font-mono-nums font-bold text-[var(--sim-text-primary)]">
                                {shop.reviewCount > 0 ? `${shop.ratingAverage}/5` : 'Nouveau'}
                              </p>
                            </div>
                          </div>

                          {shop.badges.length > 0 && (
                            <p className="mt-2.5 inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--sim-text-secondary)]">
                              <Award className="w-3.5 h-3.5 text-[var(--sim-accent-500)] shrink-0" />
                              <span>{shop.badges.join(' · ')}</span>
                            </p>
                          )}
                        </div>

                        <div className="mt-4 pt-3 border-t border-[var(--sim-border-hairline)] flex flex-wrap items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              onFilterShopChange(shop.id);
                              onSearchModeChange('products');
                            }}
                            className="text-xs font-semibold text-[#007185] dark:text-sky-400 hover:underline"
                          >
                            Filtrer ses produits →
                          </button>
                          <button
                            type="button"
                            onClick={() => onOpenShop(shop.slug)}
                            className="rounded-[var(--sim-radius-sm)] bg-[#131921] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#C2410C] transition-colors whitespace-nowrap"
                          >
                            Voir la boutique
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )
            ) : loading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {[1, 2, 3, 4, 5, 6].map((idx) => (
                  <div
                    key={idx}
                    className="rounded-[var(--sim-radius-md)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] overflow-hidden"
                  >
                    <div className="aspect-[4/3] w-full sim-skeleton" />
                    <div className="p-4 space-y-2.5">
                      <div className="h-3 w-1/2 rounded sim-skeleton" />
                      <div className="h-5 w-4/5 rounded sim-skeleton" />
                      <div className="h-4 w-1/3 rounded sim-skeleton" />
                    </div>
                  </div>
                ))}
              </div>
            ) : displayedProducts.length === 0 ? (
              <div className="rounded-[var(--sim-radius-md)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] py-16 px-6 text-center shadow-[var(--sim-shadow-1)]">
                <PackageOpen className="mx-auto w-10 h-10 text-[var(--sim-text-muted)]" />
                <h2 className="mt-4 font-display text-xl font-bold text-[var(--sim-text-primary)]">
                  Aucun équipement ne correspond à votre recherche
                </h2>
                <p className="mt-1.5 text-sm text-[var(--sim-text-secondary)]">
                  Modifiez vos mots-clés ou réinitialisez les filtres actifs pour afficher l’ensemble du parc matériel.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setWishlistOnly(false);
                    onResetAllFilters();
                  }}
                  className="mt-5 inline-flex items-center gap-2 rounded-[var(--sim-radius-md)] bg-[#F59E0B] px-5 py-2.5 text-xs font-bold text-[#0F1111] hover:bg-[#D97706] transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Réinitialiser les filtres</span>
                </button>
              </div>
            ) : viewMode === 'list' ? (
              <div className="space-y-3">
                {displayedProducts.map((product) => {
                  const primaryImg = product.media[0]?.url;
                  const isCertified =
                    product.vendorStatus === 'certifie' ||
                    product.shopBadges?.includes('Vendeur certifié');
                  const isWished = wishlistIds.includes(product.id);

                  return (
                    <article
                      key={product.id}
                      className="flex flex-col md:flex-row gap-4 rounded-[var(--sim-radius-md)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-4 shadow-[var(--sim-shadow-1)] hover:border-[var(--sim-border-strong)] transition-colors"
                    >
                      <div className="relative w-full md:w-56 shrink-0 aspect-[4/3] overflow-hidden rounded-[var(--sim-radius-sm)] bg-[var(--sim-bg-subtle)]">
                        <button
                          type="button"
                          onClick={() => onSelectProduct(product)}
                          aria-label={`Voir la fiche technique de ${product.title}`}
                          className="block h-full w-full"
                        >
                          {primaryImg ? (
                            <img
                              src={primaryImg}
                              alt={product.media[0]?.alt || product.title}
                              referrerPolicy="no-referrer"
                              loading="lazy"
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center p-4 text-center text-xs font-semibold text-[var(--sim-text-muted)]">
                              {product.title}
                            </div>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => onToggleWishlist(product.id)}
                          aria-label={isWished ? `Retirer ${product.title} des favoris` : `Enregistrer ${product.title}`}
                          className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-[var(--sim-radius-sm)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)]/95 text-[var(--sim-text-primary)] hover:text-[var(--sim-accent-500)]"
                        >
                          <Heart className={`w-3.5 h-3.5 ${isWished ? 'fill-[var(--sim-accent-500)] text-[var(--sim-accent-500)]' : ''}`} />
                        </button>
                      </div>

                      <div className="flex-1 min-w-0 flex flex-col justify-between gap-2">
                        <div>
                          <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-[var(--sim-text-muted)]">
                            <span>{product.categoryName || 'Matériel'}</span>
                            <span aria-hidden="true">·</span>
                            <button
                              type="button"
                              onClick={() => product.shopSlug && onOpenShop(product.shopSlug)}
                              className="text-[#007185] dark:text-sky-400 hover:underline font-semibold"
                            >
                              {product.shopName || 'SIMCOVA Pro'}
                            </button>
                            {isCertified && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="inline-flex items-center gap-1 text-[var(--sim-success-text)] font-semibold">
                                  <ShieldCheck className="w-3.5 h-3.5" />
                                  Certifié
                                </span>
                              </>
                            )}
                          </div>

                          <h3 className="mt-1 font-display text-lg font-bold tracking-tight text-[var(--sim-text-primary)]">
                            <button
                              type="button"
                              onClick={() => onSelectProduct(product)}
                              className="text-left hover:text-[var(--sim-accent-500)] transition-colors"
                            >
                              {product.title}
                            </button>
                          </h3>

                          <p className="mt-1.5 text-xs text-[var(--sim-text-secondary)] line-clamp-2 leading-relaxed">
                            {product.description}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--sim-text-secondary)]">
                          <span>
                            État : <strong className="text-[var(--sim-text-primary)]">{product.condition}</strong>
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className={product.stock <= 3 ? 'font-semibold text-[var(--sim-warning-text)]' : 'font-semibold text-[var(--sim-success-text)]'}>
                            {product.stock <= 3 ? `Plus que ${product.stock} en stock` : `En stock (${product.stock})`}
                          </span>
                          {product.reviewCount > 0 && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="inline-flex items-center gap-1 font-semibold text-[var(--sim-text-primary)] tabular-nums">
                                <Star className="w-3.5 h-3.5 fill-amber-500 text-amber-500" />
                                {product.ratingAverage.toFixed(1)} ({product.reviewCount})
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="md:w-56 shrink-0 md:border-l border-[var(--sim-border-hairline)] md:pl-4 flex flex-col justify-between gap-3">
                        <div>
                          <p className="font-mono-nums text-xl font-bold text-[var(--sim-text-primary)]">
                            {formatCurrency(product.price, currency)}
                          </p>
                          <p className="mt-1 text-xs text-[var(--sim-text-secondary)]">
                            Livraison <span className="font-mono-nums font-semibold">{formatCurrency(product.deliveryFee, currency)}</span> · {product.deliveryDelay}
                          </p>
                        </div>
                        <div className="flex flex-col gap-2">
                          <motion.button
                            type="button"
                            whileTap={{ scale: 0.96 }}
                            onClick={() => onQuickAddToCart(product)}
                            className="w-full inline-flex items-center justify-center gap-1.5 rounded-[var(--sim-radius-md)] bg-[#F59E0B] px-3 py-2 text-xs font-bold text-[#0F1111] hover:bg-[#D97706] transition-colors"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>Ajouter au panier</span>
                          </motion.button>
                          <button
                            type="button"
                            onClick={() => onSelectProduct(product)}
                            className="w-full rounded-[var(--sim-radius-md)] border border-[var(--sim-border-strong)] py-1.5 text-xs font-semibold text-[var(--sim-text-primary)] hover:border-[var(--sim-accent-500)] transition-colors"
                          >
                            Voir la fiche
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {displayedProducts.map((product, index) => {
                  const primaryImg = product.media[0]?.url;
                  const isCertified =
                    product.vendorStatus === 'certifie' ||
                    product.shopBadges?.includes('Vendeur certifié');
                  const isWished = wishlistIds.includes(product.id);

                  return (
                    <motion.article
                      key={product.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        duration: 0.2,
                        delay: Math.min(index * 0.03, 0.2),
                        ease: [0.16, 1, 0.3, 1],
                      }}
                      className="group flex flex-col justify-between rounded-[var(--sim-radius-md)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] overflow-hidden shadow-[var(--sim-shadow-1)] hover:-translate-y-0.5 hover:border-[var(--sim-border-strong)] hover:shadow-[var(--sim-shadow-2)] transition-all duration-200"
                    >
                      <div>
                        <div className="relative aspect-[4/3] w-full overflow-hidden bg-[var(--sim-bg-subtle)] border-b border-[var(--sim-border-hairline)]">
                          <button
                            type="button"
                            onClick={() => onSelectProduct(product)}
                            aria-label={`Voir la fiche technique de ${product.title}`}
                            className="block h-full w-full text-left"
                          >
                            {primaryImg ? (
                              <img
                                src={primaryImg}
                                alt={product.media[0]?.alt || product.title}
                                referrerPolicy="no-referrer"
                                loading="lazy"
                                className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03]"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center bg-[var(--sim-bg-subtle)] p-6 text-center">
                                <span className="font-display text-sm font-semibold text-[var(--sim-text-secondary)]">
                                  {product.title}
                                </span>
                              </div>
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() => onToggleWishlist(product.id)}
                            aria-label={isWished ? `Retirer ${product.title} de la sélection` : `Enregistrer ${product.title}`}
                            className="absolute top-2.5 right-2.5 flex h-8 w-8 items-center justify-center rounded-[var(--sim-radius-sm)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)]/95 text-[var(--sim-text-primary)] shadow-[var(--sim-shadow-1)] hover:text-[var(--sim-accent-500)] transition-colors"
                          >
                            <Heart className={`w-4 h-4 ${isWished ? 'fill-[var(--sim-accent-500)] text-[var(--sim-accent-500)]' : ''}`} />
                          </button>
                        </div>

                        <div className="p-4">
                          <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-[var(--sim-text-muted)]">
                            <span>{product.categoryName || 'Matériel'}</span>
                            <span aria-hidden="true">·</span>
                            <button
                              type="button"
                              onClick={() => product.shopSlug && onOpenShop(product.shopSlug)}
                              className="text-[#007185] dark:text-sky-400 hover:underline font-semibold"
                            >
                              {product.shopName || 'SIMCOVA Pro'}
                            </button>
                            {isCertified && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="inline-flex items-center gap-1 text-[var(--sim-success-text)] font-semibold">
                                  <ShieldCheck className="w-3.5 h-3.5" />
                                  Certifié
                                </span>
                              </>
                            )}
                          </div>

                          <h3 className="mt-1.5 font-display text-[17px] font-bold tracking-tight text-[var(--sim-text-primary)] leading-snug">
                            <button
                              type="button"
                              onClick={() => onSelectProduct(product)}
                              className="text-left hover:text-[var(--sim-accent-500)] transition-colors"
                            >
                              {product.title}
                            </button>
                          </h3>

                          <div className="mt-2 flex items-center justify-between gap-2 text-xs text-[var(--sim-text-secondary)]">
                            <span>
                              État : <strong className="text-[var(--sim-text-primary)]">{product.condition}</strong> · Livraison{' '}
                              <span className="font-mono-nums">{formatCurrency(product.deliveryFee, currency)}</span>
                            </span>
                            {product.reviewCount > 0 && (
                              <span className="inline-flex items-center gap-1 font-semibold text-[var(--sim-text-primary)] tabular-nums shrink-0">
                                <Star className="w-3.5 h-3.5 fill-amber-500 text-amber-500" />
                                {product.ratingAverage.toFixed(1)} ({product.reviewCount})
                              </span>
                            )}
                          </div>

                          {product.stock > 0 && product.stock <= 3 && (
                            <p className="mt-1.5 text-xs font-semibold text-[var(--sim-warning-text)]">
                              Stock limité ({product.stock} unité{product.stock > 1 ? 's' : ''} restante{product.stock > 1 ? 's' : ''})
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 border-t border-[var(--sim-border-hairline)] bg-[var(--sim-bg-subtle)]/65 px-4 py-3">
                        <span className="font-mono-nums text-base font-bold text-[var(--sim-text-primary)] whitespace-nowrap">
                          {formatCurrency(product.price, currency)}
                        </span>
                        <motion.button
                          type="button"
                          whileTap={{ scale: 0.94 }}
                          onClick={() => onQuickAddToCart(product)}
                          className="inline-flex items-center gap-1 rounded-[var(--sim-radius-md)] bg-[#F59E0B] px-3.5 py-1.5 text-xs font-bold text-[#0F1111] hover:bg-[#D97706] transition-colors whitespace-nowrap shrink-0"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Ajouter</span>
                        </motion.button>
                      </div>
                    </motion.article>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Section Concessionnaires & Fournisseurs vérifiés */}
      <section className="mx-auto max-w-[1440px] px-4 pb-12 pt-4 sm:px-6">
        <div className="rounded-[var(--sim-radius-md)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-5 shadow-[var(--sim-shadow-1)]">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 border-b border-[var(--sim-border-hairline)] pb-3">
            <div>
              <h2 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-[var(--sim-text-primary)]">
                Concessionnaires &amp; Fournisseurs vérifiés
              </h2>
              <p className="text-xs text-[var(--sim-text-secondary)]">
                Chaque vendeur industriel est contrôlé selon les règles d’agrément et de conformité SIMCOVA.
              </p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
            {shops.map((shop) => {
              const isCertified = shop.vendorStatus === 'certifie' || shop.badges.includes('Vendeur certifié');
              return (
                <div
                  key={shop.id}
                  className="flex flex-col justify-between rounded-[var(--sim-radius-md)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-subtle)]/40 p-4 hover:border-[var(--sim-border-strong)] transition-colors"
                >
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        {shop.logoUrl ? (
                          <img
                            src={shop.logoUrl}
                            alt={shop.name}
                            className="h-10 w-10 shrink-0 rounded-[var(--sim-radius-sm)] object-cover border border-[var(--sim-border-hairline)]"
                          />
                        ) : (
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--sim-radius-sm)] bg-[#131921] font-display text-sm font-extrabold uppercase text-[#F59E0B]">
                            {shop.name.slice(0, 2)}
                          </div>
                        )}
                        <div className="min-w-0">
                          <h3 className="font-display text-base font-bold tracking-tight text-[var(--sim-text-primary)] truncate">
                            {shop.name}
                          </h3>
                          <p className="text-xs text-[var(--sim-text-muted)]">
                            {shop.city || 'Livraison nationale'}
                          </p>
                        </div>
                      </div>
                      {isCertified && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--sim-success-text)] shrink-0">
                          <ShieldCheck className="w-3.5 h-3.5" />
                          Certifié
                        </span>
                      )}
                    </div>
                    <p className="mt-2.5 text-xs text-[var(--sim-text-secondary)] line-clamp-2 leading-relaxed">
                      {shop.description}
                    </p>
                  </div>

                  <div className="mt-4 pt-3 border-t border-[var(--sim-border-hairline)] flex items-center justify-between gap-2 text-xs">
                    <span className="font-mono-nums text-[var(--sim-text-muted)]">
                      {shop.reviewCount > 0 ? `★ ${shop.ratingAverage}/5 · ${shop.reviewCount} avis` : `Délai ${shop.defaultDeliveryDelay}`}
                    </span>
                    <button
                      type="button"
                      onClick={() => onOpenShop(shop.slug)}
                      className="rounded-[var(--sim-radius-sm)] bg-[#131921] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#C2410C] transition-colors whitespace-nowrap"
                    >
                      Voir le parc
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
};

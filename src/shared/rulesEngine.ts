import type {
  Category,
  CustomSpecs,
  DeliveryZoneFee,
  OrderEvent,
  PaymentMethodId,
  PaymentMode,
  PlatformRule,
  Product,
  ProductCondition,
  RuleId,
  Shop,
  UserAccount,
} from './types.ts';

const FRENCH_STOPWORDS = new Set([
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'd', 'au', 'aux', 'et', 'ou',
  'en', 'dans', 'par', 'pour', 'avec', 'sans', 'sur', 'sous', 'vers', 'chez', 'est',
  'sont', 'etre', 'avoir', 'fait', 'plus', 'tres', 'tout', 'tous', 'toute', 'toutes',
  'ce', 'cet', 'cette', 'ces', 'mon', 'ton', 'son', 'nos', 'vos', 'leur', 'leurs',
  'qui', 'que', 'quoi', 'dont', 'mais', 'donc', 'or', 'ni', 'car', 'comme', 'si',
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'are', 'was', 'your', 'our',
]);

export function normalizeSearchText(input: string): string {
  return String(input || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * EXF-305: Automatic keyword extraction from product title, description, and category.
 */
export function extractKeywords(title: string, description: string, categoryName = ''): string[] {
  const combined = `${title} ${categoryName} ${description}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ');

  const counts = new Map<string, number>();
  for (const raw of combined.split(/\s+/)) {
    const token = raw.trim();
    if (token.length < 3 || FRENCH_STOPWORDS.has(token) || /^\d+$/.test(token)) {
      continue;
    }
    const weight = title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(token) ? 3 : 1;
    counts.set(token, (counts.get(token) ?? 0) + weight);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([word]) => word);
}

/**
 * EXF-101: Validate seller password policy (min 8 chars, 1 uppercase, 1 lowercase, 1 digit).
 */
export function validatePasswordStrength(password: string): { valid: boolean; reason?: string } {
  if (typeof password !== 'string' || password.length < 8) {
    return { valid: false, reason: 'Le mot de passe doit contenir au moins 8 caractères.' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, reason: 'Le mot de passe doit contenir au moins une lettre majuscule.' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, reason: 'Le mot de passe doit contenir au moins une lettre minuscule.' };
  }
  if (!/\d/.test(password)) {
    return { valid: false, reason: 'Le mot de passe doit contenir au moins un chiffre.' };
  }
  return { valid: true };
}

export interface PublishValidationInput {
  vendor: Pick<UserAccount, 'role' | 'status' | 'badges' | 'emailVerified'>;
  category: Category | undefined;
  rules: Record<RuleId, PlatformRule>;
  publishedCountExcludingCurrent: number;
  targetStatus: 'brouillon' | 'publie' | 'archive';
  stock: number;
}

/**
 * Enforces Chapter 7 management rules (RG-01, RG-02, RG-05, RG-06) + EXF-106 + EXF-310.
 */
export function validateProductPublication(input: PublishValidationInput): { allowed: boolean; reason?: string } {
  if (input.vendor.status === 'suspendu') {
    return {
      allowed: false,
      reason: 'Votre compte vendeur est suspendu. Contactez le support pour plus d’informations.',
    };
  }

  if (input.targetStatus !== 'publie') {
    return { allowed: true };
  }

  if (input.vendor.role !== 'admin' && !input.vendor.emailVerified) {
    return {
      allowed: false,
      reason: 'Veuillez confirmer votre adresse électronique avant de publier un produit.',
    };
  }

  if (input.vendor.role !== 'admin' && (input.vendor.status === 'en_attente' || input.vendor.status === 'rejete')) {
    return {
      allowed: false,
      reason: 'Votre compte vendeur doit être validé par l’administrateur avant de publier. Enregistrez ce produit en brouillon.',
    };
  }

  if (input.stock <= 0) {
    return {
      allowed: false,
      reason: 'Un produit avec un stock nul est automatiquement désactivé de la vente (EXF-310).',
    };
  }

  // RG-06: Allowed / forbidden categories
  if (!input.category || !input.category.active || input.category.forbidden) {
    return {
      allowed: false,
      reason: 'Cette catégorie est désactivée ou interdite par l’administrateur (RG-06).',
    };
  }

  // RG-01: Certification required to publish (applies to non-admin vendors when enabled)
  const rg01 = input.rules['RG-01'];
  const isCertified = input.vendor.status === 'certifie' || input.vendor.badges.includes('Vendeur certifié');
  if (input.vendor.role !== 'admin' && rg01?.enabled && !isCertified) {
    return {
      allowed: false,
      reason: 'La règle RG-01 exige le badge « Vendeur certifié » pour publier. Enregistrez votre fiche en brouillon en attendant la certification.',
    };
  }

  // RG-02: Required badge per category
  const rg02 = input.rules['RG-02'];
  if (input.vendor.role !== 'admin' && rg02?.enabled && input.category.requiredBadge) {
    if (!input.vendor.badges.includes(input.category.requiredBadge)) {
      return {
        allowed: false,
        reason: `La catégorie « ${input.category.name} » requiert le badge « ${input.category.requiredBadge} » (RG-02).`,
      };
    }
  }

  // RG-05: Publication cap for non-certified vendors
  const rg05 = input.rules['RG-05'];
  const maxProducts = Number((rg05?.valueJson?.maxProducts as number) ?? 10);
  if (input.vendor.role !== 'admin' && rg05?.enabled && !isCertified && input.publishedCountExcludingCurrent >= maxProducts) {
    return {
      allowed: false,
      reason: `Plafond atteint : les vendeurs non certifiés peuvent publier jusqu’à ${maxProducts} produits (RG-05). Obtenez la certification pour lever cette limite.`,
    };
  }

  return { allowed: true };
}

export interface OrderCalculationLineInput {
  productId: string;
  variantId?: string | null;
  quantity: number;
  isCustom?: boolean;
  customSpecs?: CustomSpecs | null;
}

export interface OrderCalculationResult {
  subtotal: number;
  deliveryTotal: number;
  totalAmount: number;
  /** TVA appliquée au montant HT (0 par défaut = prix tous taxes compris). */
  vatAmount: number;
  /** Montant TTC avant remise éventuelle. */
  grandTotalBeforeDiscount: number;
  /** Remise code promo appliquée (0 par défaut). */
  discountAmount: number;
  /** Montant TTC réellement dû par l'acheteur (TTC avant remise - remise). */
  grandTotal: number;
  /** Commission marketplace prélevée sur le sous-total produits (0 par défaut). */
  commissionAmount: number;
  /** Net à reverser au vendeur : sous-total + livraison - commission. */
  vendorNetAmount: number;
  hasCustomOffer: boolean;
  resolvedLines: Array<{
    productId: string;
    variantId: string | null;
    vendorId: string;
    shopId: string;
    productTitle: string;
    variantLabel: string | null;
    quantity: number;
    unitPrice: number;
    deliveryFee: number;
    customSpecs: CustomSpecs | null;
  }>;
}

export interface OrderFeeRates {
  /** Commission marketplace en % du sous-total produits (0-50, défaut 0). */
  commissionRatePercent?: number;
  /** TVA en % du montant HT produits + livraison (0-50, défaut 0). */
  vatRatePercent?: number;
}

function computeOrderFees(
  subtotal: number,
  deliveryTotal: number,
  rates: OrderFeeRates
): Pick<OrderCalculationResult, 'vatAmount' | 'grandTotal' | 'commissionAmount' | 'vendorNetAmount'> {
  const vatPct = Math.min(50, Math.max(0, Math.round(Number(rates.vatRatePercent ?? 0))));
  const commissionPct = Math.min(50, Math.max(0, Math.round(Number(rates.commissionRatePercent ?? 0))));
  const vatAmount = Math.round(((subtotal + deliveryTotal) * vatPct) / 100);
  const commissionAmount = Math.round((subtotal * commissionPct) / 100);
  return {
    vatAmount,
    grandTotal: subtotal + deliveryTotal + vatAmount,
    commissionAmount,
    vendorNetAmount: subtotal + deliveryTotal - commissionAmount,
  };
}

export function resolveProductDeliveryFee(params: {
  deliveryZones?: DeliveryZoneFee[];
  deliveryFee: number;
  deliveryZoneId: string;
  defaultDeliveryFee: number;
  zoneDefaults?: DeliveryZoneFee[];
}): number {
  const zoneRule = params.deliveryZones?.find((z) => z.zoneId === params.deliveryZoneId);
  if (zoneRule) {
    return zoneRule.fee;
  }
  if (params.deliveryFee >= 0) {
    return params.deliveryFee;
  }
  const platformZone = params.zoneDefaults?.find((z) => z.zoneId === params.deliveryZoneId);
  return platformZone ? platformZone.fee : params.defaultDeliveryFee;
}

export function estimateCartTotals(params: {
  items: Array<{
    shopId: string;
    price: number;
    quantity: number;
    deliveryFee: number;
    deliveryZones?: DeliveryZoneFee[];
  }>;
  deliveryZoneId: string;
  defaultDeliveryFee: number;
  zoneDefaults?: DeliveryZoneFee[];
  commissionRatePercent?: number;
  vatRatePercent?: number;
  /** Remise code promo (FCFA, plafonnée au TTC avant remise) — appliquée après TVA. */
  discountAmount?: number;
}): { subtotal: number; deliveryTotal: number; totalAmount: number; vatAmount: number; grandTotal: number; grandTotalBeforeDiscount: number; discountAmount: number; commissionAmount: number; vendorNetAmount: number } {
  let subtotal = 0;
  let deliveryTotal = 0;
  const chargedShops = new Set<string>();

  for (const item of params.items) {
    subtotal += item.price * item.quantity;
    if (!chargedShops.has(item.shopId)) {
      chargedShops.add(item.shopId);
      deliveryTotal += resolveProductDeliveryFee({
        deliveryZones: item.deliveryZones,
        deliveryFee: item.deliveryFee,
        deliveryZoneId: params.deliveryZoneId,
        defaultDeliveryFee: params.defaultDeliveryFee,
        zoneDefaults: params.zoneDefaults,
      });
    }
  }

  const fees = computeOrderFees(subtotal, deliveryTotal, params);
  const grandTotalBeforeDiscount = subtotal + deliveryTotal + fees.vatAmount;
  const discountAmount = Math.min(Math.max(0, Math.round(params.discountAmount ?? 0)), grandTotalBeforeDiscount);
  return {
    subtotal,
    deliveryTotal,
    totalAmount: subtotal + deliveryTotal,
    ...fees,
    grandTotalBeforeDiscount,
    discountAmount,
    grandTotal: grandTotalBeforeDiscount - discountAmount,
  };
}

export function hasValidCustomSpecs(specs?: CustomSpecs | null): boolean {
  if (!specs) return false;
  return Boolean(
    specs.dimensions?.trim() ||
      specs.technicalSpecs?.trim() ||
      specs.notes?.trim()
  );
}

/**
 * EXF-504 / EXF-508 / EXF-510: Server-authoritative order pricing and delivery calculation.
 */
export function calculateOrderTotals(params: {
  lines: OrderCalculationLineInput[];
  productsById: Map<string, Product>;
  deliveryZoneId: string;
  defaultDeliveryFee: number;
  zoneDefaults?: DeliveryZoneFee[];
  allowedPaymentMethods: PaymentMethodId[];
  requestedPaymentMethod: PaymentMethodId;
  paymentMode?: PaymentMode;
  commissionRatePercent?: number;
  vatRatePercent?: number;
  /** Remise validée côté serveur (FCFA) — plafonnée au TTC avant remise. */
  discountAmount?: number;
}): OrderCalculationResult {
  if (!params.lines.length) {
    throw new Error('Le panier est vide.');
  }
  const mode = params.paymentMode || 'full';
  const requiresOnlineMethodCheck = mode === 'full' || mode === 'deposit';
  if (requiresOnlineMethodCheck && !params.allowedPaymentMethods.includes(params.requestedPaymentMethod)) {
    throw new Error('Le mode de paiement sélectionné n’est pas autorisé par la plateforme.');
  }

  let subtotal = 0;
  let deliveryTotal = 0;
  let hasCustomOffer = false;
  const vendorDeliveryCharged = new Set<string>();
  const resolvedLines: OrderCalculationResult['resolvedLines'] = [];

  for (const line of params.lines) {
    const qty = Math.floor(Number(line.quantity));
    if (!Number.isFinite(qty) || qty <= 0 || qty > 99) {
      throw new Error('Quantité invalide dans le panier.');
    }
    const product = params.productsById.get(line.productId);
    if (!product || product.status !== 'publie') {
      throw new Error('Un des articles du panier n’est plus disponible à la vente.');
    }
    if (requiresOnlineMethodCheck && product.paymentMethods.length > 0 && !product.paymentMethods.includes(params.requestedPaymentMethod)) {
      throw new Error(`Le mode de paiement sélectionné n’est pas accepté pour « ${product.title} ».`);
    }

    let unitPrice = product.price;
    let resolvedVariantId: string | null = null;
    let variantLabel: string | null = null;
    let availableStock = product.stock;

    if (line.variantId) {
      const variant = product.variants.find((v) => v.id === line.variantId);
      if (!variant) {
        throw new Error(`Variante introuvable pour « ${product.title} ».`);
      }
      if (variant.priceOverride !== null && variant.priceOverride !== undefined) {
        unitPrice = variant.priceOverride;
      }
      resolvedVariantId = variant.id;
      variantLabel = variant.label;
      availableStock = variant.stock;
    }

    if (availableStock < qty) {
      throw new Error(`Stock insuffisant pour « ${product.title} » (${availableStock} disponible(s)).`);
    }

    const cleanSpecs: CustomSpecs | null =
      line.isCustom || hasValidCustomSpecs(line.customSpecs)
        ? {
            dimensions: line.customSpecs?.dimensions?.trim() || undefined,
            technicalSpecs: line.customSpecs?.technicalSpecs?.trim() || undefined,
            notes: line.customSpecs?.notes?.trim() || undefined,
          }
        : null;

    if (cleanSpecs && hasValidCustomSpecs(cleanSpecs)) {
      hasCustomOffer = true;
    } else if (line.isCustom) {
      throw new Error(`Veuillez préciser au moins une dimension ou spécificité technique pour l’offre sur mesure « ${product.title} ».`);
    }

    const productFee = resolveProductDeliveryFee({
      deliveryZones: product.deliveryZones,
      deliveryFee: product.deliveryFee,
      deliveryZoneId: params.deliveryZoneId,
      defaultDeliveryFee: params.defaultDeliveryFee,
      zoneDefaults: params.zoneDefaults,
    });

    // Charge delivery once per vendor per order so multi-item orders from the same shop stay fair
    let lineDeliveryFee = 0;
    if (!vendorDeliveryCharged.has(product.vendorId)) {
      lineDeliveryFee = productFee;
      vendorDeliveryCharged.add(product.vendorId);
      deliveryTotal += lineDeliveryFee;
    }

    subtotal += unitPrice * qty;
    resolvedLines.push({
      productId: product.id,
      variantId: resolvedVariantId,
      vendorId: product.vendorId,
      shopId: product.shopId,
      productTitle: product.title,
      variantLabel,
      quantity: qty,
      unitPrice,
      deliveryFee: lineDeliveryFee,
      customSpecs: cleanSpecs,
    });
  }

  const fees = computeOrderFees(subtotal, deliveryTotal, params);
  const grandTotalBeforeDiscount = subtotal + deliveryTotal + fees.vatAmount;
  const discountAmount = Math.min(Math.max(0, Math.round(params.discountAmount ?? 0)), grandTotalBeforeDiscount);
  return {
    subtotal,
    deliveryTotal,
    totalAmount: subtotal + deliveryTotal,
    ...fees,
    grandTotalBeforeDiscount,
    discountAmount,
    grandTotal: grandTotalBeforeDiscount - discountAmount,
    hasCustomOffer,
    resolvedLines,
  };
}

/**
 * Splits an all-inclusive (TTC) custom quote total into HT subtotal + VAT amount,
 * given the platform VAT rate (0 % keeps the historical behaviour intact).
 */
export function splitInclusiveVat(
  inclusiveTotal: number,
  vatRatePercent: number
): { vatAmount: number; netTotal: number } {
  const pct = Math.min(50, Math.max(0, Math.round(Number(vatRatePercent ?? 0))));
  if (pct === 0) return { vatAmount: 0, netTotal: Math.round(inclusiveTotal) };
  const netTotal = Math.round((inclusiveTotal * 100) / (100 + pct));
  return { vatAmount: Math.round(inclusiveTotal) - netTotal, netTotal };
}

/**
 * Validates and computes payment split across Full, Deposit (Acompte), Quote (Devis - custom offers only), and High-Value Bank Transfer.
 */
export function computePaymentBreakdown(params: {
  totalAmount: number;
  paymentMode: PaymentMode;
  depositPercent: number;
  hasCustomOffer: boolean;
  bankTransferThreshold: number;
  sellerHasBankDetails: boolean;
}): {
  valid: boolean;
  reason?: string;
  upfrontAmount: number;
  balanceDue: number;
  depositPercentApplied: number;
} {
  const total = Math.max(0, Math.round(params.totalAmount));
  if (params.paymentMode === 'quote') {
    if (!params.hasCustomOffer) {
      return {
        valid: false,
        reason: 'La demande de devis sans paiement immédiat est réservée uniquement aux offres personnalisées (dimensions ou spécificités sur mesure).',
        upfrontAmount: 0,
        balanceDue: total,
        depositPercentApplied: 0,
      };
    }
    return {
      valid: true,
      upfrontAmount: 0,
      balanceDue: total,
      depositPercentApplied: 0,
    };
  }

  if (params.paymentMode === 'bank_transfer') {
    if (total < params.bankTransferThreshold) {
      return {
        valid: false,
        reason: `Le paiement par virement bancaire (coordonnées bancaires du vendeur) est réservé aux commandes importantes à partir de ${formatCurrency(params.bankTransferThreshold)}.`,
        upfrontAmount: 0,
        balanceDue: total,
        depositPercentApplied: 0,
      };
    }
    if (!params.sellerHasBankDetails) {
      return {
        valid: false,
        reason: 'Le concessionnaire sélectionné n’a pas encore configuré ses coordonnées bancaires pour recevoir un virement.',
        upfrontAmount: 0,
        balanceDue: total,
        depositPercentApplied: 0,
      };
    }
    return {
      valid: true,
      upfrontAmount: 0,
      balanceDue: total,
      depositPercentApplied: 0,
    };
  }

  if (params.paymentMode === 'deposit') {
    const pct = Math.min(90, Math.max(10, Math.round(params.depositPercent || 30)));
    const upfrontAmount = Math.round((total * pct) / 100);
    const balanceDue = Math.max(0, total - upfrontAmount);
    return {
      valid: true,
      upfrontAmount,
      balanceDue,
      depositPercentApplied: pct,
    };
  }

  return {
    valid: true,
    upfrontAmount: total,
    balanceDue: 0,
    depositPercentApplied: 100,
  };
}

/**
 * Mandatory on-platform communication guard: blocks sharing of direct phone numbers, emails, external links, or off-platform apps.
 */
export function detectCircumvention(text: string): { blocked: boolean; reasons: string[] } {
  const value = String(text || '').trim();
  if (!value) return { blocked: false, reasons: [] };

  const reasons: string[] = [];

  if (/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(value)) {
    reasons.push('adresse électronique');
  }

  if (/(https?:\/\/|www\.|wa\.me\/|t\.me\/|bit\.ly\/)/i.test(value)) {
    reasons.push('lien externe');
  }

  // International phone (+225 07 11 22 33, +221771234567) or grouped local phone (07 11 22 33 44, 01-23-45-67)
  const intlPhone = /\+\d{1,3}(?:[\s.-]*\d){7,12}/.test(value);
  const groupedLocalPhone = /\b0\d(?:[\s.-]?\d{2}){3,4}\b/.test(value);
  const bareLongDigits = /(?:^|[^\d])(?:0\d{7,11}|(?:225|221|237|229|228|226|223)\d{8,10})(?!\d)/.test(value);
  if (intlPhone || groupedLocalPhone || bareLongDigits) {
    reasons.push('numéro de téléphone');
  }

  if (/\b(whatsapp|telegram|hors[- ]plateforme|hors[- ]simcova|en dehors de la plateforme)\b/i.test(value)) {
    reasons.push('tentative de contact hors plateforme');
  }

  return {
    blocked: reasons.length > 0,
    reasons,
  };
}

export interface ProductSearchFilters {
  q?: string;
  category?: string;
  shop?: string;
  certifiedOnly?: boolean;
  minPrice?: number;
  maxPrice?: number;
  minStock?: number;
  condition?: ProductCondition | '';
  maxDeliveryFee?: number;
  minRating?: number;
  sort?: string;
}

export function filterAndSortProducts(products: Product[], filters: ProductSearchFilters): Product[] {
  let result = [...products];
  const normQ = normalizeSearchText(filters.q || '');
  const tokens = normQ ? normQ.split(/\s+/).filter(Boolean) : [];

  if (tokens.length > 0) {
    result = result.filter((p) => {
      const variantText = p.variants.map((v) => v.label).join(' ');
      const hay = normalizeSearchText(
        `${p.title} ${p.description} ${p.categoryName || ''} ${p.shopName || ''} ${p.condition} ${p.keywords.join(' ')} ${variantText}`
      );
      return tokens.every((tok) => hay.includes(tok));
    });
  }

  if (filters.category && filters.category !== 'all') {
    result = result.filter((p) => p.categoryId === filters.category);
  }
  if (filters.shop && filters.shop !== 'all') {
    result = result.filter((p) => p.shopId === filters.shop || p.shopSlug === filters.shop);
  }
  if (filters.certifiedOnly) {
    result = result.filter((p) => p.vendorStatus === 'certifie' || p.shopBadges?.includes('Vendeur certifié'));
  }
  if (filters.minPrice && filters.minPrice > 0) {
    result = result.filter((p) => p.price >= filters.minPrice!);
  }
  if (filters.maxPrice && filters.maxPrice > 0) {
    result = result.filter((p) => p.price <= filters.maxPrice!);
  }
  if (filters.minStock && filters.minStock > 0) {
    result = result.filter((p) => p.stock >= filters.minStock!);
  }
  if (filters.condition) {
    result = result.filter((p) => p.condition === filters.condition);
  }
  if (filters.maxDeliveryFee !== undefined && filters.maxDeliveryFee >= 0 && !Number.isNaN(filters.maxDeliveryFee)) {
    result = result.filter((p) => p.deliveryFee <= filters.maxDeliveryFee!);
  }
  if (filters.minRating && filters.minRating > 0) {
    result = result.filter((p) => p.ratingAverage >= filters.minRating!);
  }

  const sort = filters.sort || 'recent';
  if (sort === 'price_asc') {
    result.sort((a, b) => a.price - b.price);
  } else if (sort === 'price_desc') {
    result.sort((a, b) => b.price - a.price);
  } else if (sort === 'rating') {
    result.sort((a, b) => b.ratingAverage - a.ratingAverage || b.reviewCount - a.reviewCount);
  } else if (tokens.length > 0 && sort === 'relevance') {
    result.sort((a, b) => {
      const aTitle = normalizeSearchText(a.title);
      const bTitle = normalizeSearchText(b.title);
      const aScore = tokens.reduce((acc, t) => acc + (aTitle.includes(t) ? 2 : 0), 0);
      const bScore = tokens.reduce((acc, t) => acc + (bTitle.includes(t) ? 2 : 0), 0);
      return bScore - aScore || b.ratingAverage - a.ratingAverage;
    });
  } else {
    result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  return result;
}

export interface VendorSearchFilters {
  q?: string;
  minSales?: number;
  certifiedOnly?: boolean;
  badge?: string;
  city?: string;
  minRating?: number;
  sort?: string;
  catalogTextByShopId?: Record<string, string>;
}

export function filterAndSortShops(shops: Shop[], filters: VendorSearchFilters): Shop[] {
  let result = [...shops];
  const normQ = normalizeSearchText(filters.q || '');
  const tokens = normQ ? normQ.split(/\s+/).filter(Boolean) : [];

  if (tokens.length > 0) {
    result = result.filter((s) => {
      const catalogText = filters.catalogTextByShopId?.[s.id] || '';
      const hay = normalizeSearchText(
        `${s.name} ${s.description} ${s.city || ''} ${s.badges.join(' ')} ${s.vendorStatus} ${catalogText}`
      );
      return tokens.every((tok) => hay.includes(tok));
    });
  }

  if (filters.minSales && filters.minSales > 0) {
    result = result.filter((s) => (s.salesCount ?? 0) >= filters.minSales!);
  }
  if (filters.certifiedOnly) {
    result = result.filter((s) => s.vendorStatus === 'certifie' || s.badges.includes('Vendeur certifié'));
  }
  if (filters.badge) {
    const normBadge = normalizeSearchText(filters.badge);
    result = result.filter((s) => s.badges.some((b) => normalizeSearchText(b) === normBadge));
  }
  if (filters.city) {
    const normCity = normalizeSearchText(filters.city);
    result = result.filter((s) => normalizeSearchText(s.city || '').includes(normCity));
  }
  if (filters.minRating && filters.minRating > 0) {
    result = result.filter((s) => s.ratingAverage >= filters.minRating!);
  }

  const sort = filters.sort || 'sales_desc';
  if (sort === 'sales_desc') {
    result.sort((a, b) => (b.salesCount ?? 0) - (a.salesCount ?? 0) || b.ratingAverage - a.ratingAverage);
  } else if (sort === 'rating') {
    result.sort((a, b) => b.ratingAverage - a.ratingAverage || (b.salesCount ?? 0) - (a.salesCount ?? 0));
  } else if (sort === 'name') {
    result.sort((a, b) => a.name.localeCompare(b.name));
  }

  return result;
}

/**
 * EXF-603: A buyer without an account may leave a review ONLY after the order is delivered.
 */
export function canLeaveReview(events: OrderEvent[], alreadyReviewed: boolean): { allowed: boolean; reason?: string } {
  if (alreadyReviewed) {
    return { allowed: false, reason: 'Vous avez déjà déposé un avis pour ce produit sur cette commande.' };
  }
  const hasDeliveredEvent = events.some((e) => e.status === 'livree');
  if (!hasDeliveredEvent) {
    return {
      allowed: false,
      reason: 'Les avis clients sont autorisés uniquement après la livraison confirmée de la commande (EXF-603).',
    };
  }
  return { allowed: true };
}

/**
 * RG-10: Determines if an unpaid order has expired.
 */
export function isOrderExpired(params: {
  paymentStatus: string;
  expiresAt: string | null;
  nowMs?: number;
}): boolean {
  if (params.paymentStatus !== 'pending' || !params.expiresAt) {
    return false;
  }
  const now = params.nowMs ?? Date.now();
  return now > Date.parse(params.expiresAt);
}

export function formatCurrency(amount: number, currency = 'FCFA'): string {
  return `${new Intl.NumberFormat('fr-FR').format(Math.round(amount))} ${currency}`;
}

export const ORDER_STATUS_LABELS: Record<string, string> = {
  creee: 'Commande créée',
  devis_demande: 'Devis demandé',
  devis_propose: 'Devis chiffré',
  en_attente_paiement: 'En attente de paiement',
  en_attente_virement: 'En attente de virement',
  acompte_paye: 'Acompte payé',
  payee: 'Payée',
  en_preparation: 'En préparation',
  expediee: 'Expédiée',
  livraison_commencee: 'Livraison commencée',
  livree: 'Livrée',
  annulee: 'Annulée',
  remboursee: 'Remboursée',
  expiree: 'Expirée',
};

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pending: 'En attente',
  paid: 'Confirmé',
  failed: 'Refusé',
  refunded: 'Remboursé',
  expired: 'Expiré',
};

export const PAYMENT_MODE_LABELS: Record<string, string> = {
  full: 'Paiement intégral',
  deposit: 'Acompte + solde livraison',
  quote: 'Devis sur mesure',
  bank_transfer: 'Virement bancaire',
};

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  jumia_card: 'Carte Bancaire (JumiaPay)',
  mobile_money_orange: 'Orange Money',
  mobile_money_mtn: 'MTN MoMo',
  mobile_money_wave: 'Wave',
  jumia_wallet: 'Portefeuille JumiaPay',
  bank_transfer: 'Virement bancaire',
  quote: 'Devis personnalisé',
};

/**
 * Accepts either a raw tracking token or a full tracking URL containing `?suivi=<token>`.
 */
export function extractTrackingTokenFromInput(raw: string): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';

  if (/suivi=/i.test(trimmed) || trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('/?')) {
    try {
      const normalized =
        trimmed.startsWith('http://') || trimmed.startsWith('https://')
          ? trimmed
          : trimmed.startsWith('/')
          ? `https://simcova.local${trimmed}`
          : trimmed.startsWith('?')
          ? `https://simcova.local/${trimmed}`
          : `https://simcova.local/?${trimmed}`;
      const u = new URL(normalized);
      const param = u.searchParams.get('suivi');
      if (param && param.trim()) {
        return param.trim();
      }
    } catch {
      const match = trimmed.match(/[?&]suivi=([^&#]+)/i);
      if (match?.[1]) {
        try {
          return decodeURIComponent(match[1]).trim();
        } catch {
          return match[1].trim();
        }
      }
    }
  }

  return trimmed;
}

/**
 * Computes the highest logistical milestone reached across all order events so post-delivery balance settlement
 * (`confirm-balance`, which records a `payee` event) never regresses step 4 ("Livrée") back to step 1.
 */
export function computeOrderProgressRank(
  events: Array<Pick<OrderEvent, 'status'>>,
  paymentStatus: string
): { isTerminalNegative: boolean; latestStatus: string; rank: number } {
  const latestStatus = events[events.length - 1]?.status || 'creee';
  const isTerminalNegative =
    ['annulee', 'remboursee', 'expiree'].includes(latestStatus) ||
    paymentStatus === 'refunded' ||
    paymentStatus === 'expired';

  if (isTerminalNegative) {
    return { isTerminalNegative: true, latestStatus, rank: -1 };
  }

  let rank = paymentStatus === 'paid' ? 0 : -1;
  for (const ev of events) {
    const st = ev.status;
    if (st === 'livree') {
      rank = Math.max(rank, 3);
    } else if (st === 'expediee' || st === 'livraison_commencee') {
      rank = Math.max(rank, 2);
    } else if (st === 'en_preparation') {
      rank = Math.max(rank, 1);
    } else if (st === 'payee' || st === 'acompte_paye') {
      rank = Math.max(rank, 0);
    }
  }

  return { isTerminalNegative: false, latestStatus, rank };
}

/**
 * Mirrors server-side bank transfer validation: every distinct shop in the cart must have valid RIB/IBAN details.
 */
export function allCartShopsHaveBankDetails(
  shopIds: string[],
  shops: Array<Pick<Shop, 'id' | 'hasBankDetails'>>
): boolean {
  const uniqueIds = [...new Set(shopIds.filter(Boolean))];
  if (uniqueIds.length === 0) return false;
  return uniqueIds.every((sid) => Boolean(shops.find((s) => s.id === sid)?.hasBankDetails));
}


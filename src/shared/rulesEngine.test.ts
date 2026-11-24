import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allCartShopsHaveBankDetails,
  calculateOrderTotals,
  canLeaveReview,
  computeOrderProgressRank,
  computePaymentBreakdown,
  detectCircumvention,
  estimateCartTotals,
  extractKeywords,
  extractTrackingTokenFromInput,
  filterAndSortProducts,
  filterAndSortShops,
  isOrderExpired,
  resolveProductDeliveryFee,
  splitInclusiveVat,
  validatePasswordStrength,
  validateProductPublication,
} from './rulesEngine';
import type { Category, PlatformRule, Product, RuleId, Shop } from './types';

function makeDefaultRules(): Record<RuleId, PlatformRule> {
  const now = new Date().toISOString();
  const base = (ruleId: RuleId, enabled: boolean, valueJson: Record<string, unknown> = {}): PlatformRule => ({
    ruleId,
    title: ruleId,
    helpText: '',
    enabled,
    valueJson,
    updatedBy: 'admin',
    updatedAt: now,
  });
  return {
    'RG-01': base('RG-01', false),
    'RG-02': base('RG-02', false),
    'RG-03': base('RG-03', true, { requiredDocs: ['piece_identite'] }),
    'RG-04': base('RG-04', true, { requiredFields: ['fullName', 'email', 'password', 'shopName'] }),
    'RG-05': base('RG-05', true, { maxProducts: 10 }),
    'RG-06': base('RG-06', true),
    'RG-07': base('RG-07', true, { threshold: 3 }),
    'RG-08': base('RG-08', true, { methods: ['jumia_card', 'mobile_money_orange', 'mobile_money_mtn'] }),
    'RG-09': base('RG-09', true, { defaultFlatFee: 2000 }),
    'RG-10': base('RG-10', true, { expirationHours: 48 }),
  };
}

test('extractKeywords strips French stopwords and prioritizes title keywords', () => {
  const kw = extractKeywords(
    'Sac Cabas Cuir Cognac',
    'Un magnifique sac artisanal en cuir véritable cousu à la main pour la ville et le travail.',
    'Maroquinerie'
  );
  assert.ok(kw.includes('cuir'));
  assert.ok(kw.includes('cabas'));
  assert.ok(kw.includes('cognac'));
  assert.ok(!kw.includes('pour'));
  assert.ok(!kw.includes('avec'));
});

test('validatePasswordStrength enforces complexity rules (EXF-101)', () => {
  assert.equal(validatePasswordStrength('short').valid, false);
  assert.equal(validatePasswordStrength('lowercase123').valid, false);
  assert.equal(validatePasswordStrength('NoDigitsHere').valid, false);
  assert.equal(validatePasswordStrength('Simcova2026!').valid, true);
});

test('RG-01 blocks uncertified vendor from publishing when enabled, allows drafts', () => {
  const rules = makeDefaultRules();
  rules['RG-01'].enabled = true;
  const cat: Category = { id: 'c1', name: 'Mode', slug: 'mode', active: true, forbidden: false, requiredBadge: null };

  const draftAttempt = validateProductPublication({
    vendor: { role: 'vendor', status: 'valide', badges: [], emailVerified: true },
    category: cat,
    rules,
    publishedCountExcludingCurrent: 0,
    targetStatus: 'brouillon',
    stock: 5,
  });
  assert.equal(draftAttempt.allowed, true);

  const publishBlocked = validateProductPublication({
    vendor: { role: 'vendor', status: 'valide', badges: [], emailVerified: true },
    category: cat,
    rules,
    publishedCountExcludingCurrent: 0,
    targetStatus: 'publie',
    stock: 5,
  });
  assert.equal(publishBlocked.allowed, false);

  const certifiedAllowed = validateProductPublication({
    vendor: { role: 'vendor', status: 'certifie', badges: ['Vendeur certifié'], emailVerified: true },
    category: cat,
    rules,
    publishedCountExcludingCurrent: 0,
    targetStatus: 'publie',
    stock: 5,
  });
  assert.equal(certifiedAllowed.allowed, true);
});

test('RG-02 blocks publication in badge-gated category unless vendor holds required badge', () => {
  const rules = makeDefaultRules();
  rules['RG-02'].enabled = true;
  const techCat: Category = {
    id: 'cat-tracteurs',
    name: 'Tracteurs & Engins Agricoles',
    slug: 'tracteurs-agricoles',
    active: true,
    forbidden: false,
    requiredBadge: 'Vendeur certifié',
  };

  const blocked = validateProductPublication({
    vendor: { role: 'vendor', status: 'valide', badges: [], emailVerified: true },
    category: techCat,
    rules,
    publishedCountExcludingCurrent: 0,
    targetStatus: 'publie',
    stock: 5,
  });
  assert.equal(blocked.allowed, false);

  const allowed = validateProductPublication({
    vendor: { role: 'vendor', status: 'certifie', badges: ['Vendeur certifié'], emailVerified: true },
    category: techCat,
    rules,
    publishedCountExcludingCurrent: 0,
    targetStatus: 'publie',
    stock: 5,
  });
  assert.equal(allowed.allowed, true);
});

test('RG-05 enforces publication cap for uncertified vendors', () => {
  const rules = makeDefaultRules();
  rules['RG-05'].valueJson = { maxProducts: 2 };
  const cat: Category = { id: 'c1', name: 'Audio', slug: 'audio', active: true, forbidden: false, requiredBadge: null };

  const blockedAtCap = validateProductPublication({
    vendor: { role: 'vendor', status: 'valide', badges: [], emailVerified: true },
    category: cat,
    rules,
    publishedCountExcludingCurrent: 2,
    targetStatus: 'publie',
    stock: 3,
  });
  assert.equal(blockedAtCap.allowed, false);

  const certifiedBypassesCap = validateProductPublication({
    vendor: { role: 'vendor', status: 'certifie', badges: ['Vendeur certifié'], emailVerified: true },
    category: cat,
    rules,
    publishedCountExcludingCurrent: 15,
    targetStatus: 'publie',
    stock: 3,
  });
  assert.equal(certifiedBypassesCap.allowed, true);
});

test('calculateOrderTotals and estimateCartTotals match identically across delivery zones & enforce paymentMethods', () => {
  const prod: Product = {
    id: 'p1',
    vendorId: 'v1',
    shopId: 's1',
    title: 'Casque Studio',
    description: 'Audio haute fidélité',
    categoryId: 'c1',
    price: 45000,
    condition: 'Neuf',
    status: 'publie',
    stock: 10,
    keywords: ['casque'],
    media: [],
    videoUrl: null,
    variants: [{ id: 'var1', label: 'Noir Mat', priceOverride: 48000, stock: 4 }],
    deliveryFee: 2500,
    deliveryZones: [
      { zoneId: 'abidjan', zoneName: 'Abidjan', fee: 1500 },
      { zoneId: 'national', zoneName: 'Intérieur', fee: 3500 },
    ],
    deliveryDelay: '24-48h',
    paymentMethods: ['jumia_card', 'mobile_money_orange'],
    ratingAverage: 4.9,
    reviewCount: 3,
    createdAt: '',
    updatedAt: '',
  };

  const map = new Map<string, Product>([['p1', prod]]);
  const serverResult = calculateOrderTotals({
    lines: [{ productId: 'p1', variantId: 'var1', quantity: 2 }],
    productsById: map,
    deliveryZoneId: 'national',
    defaultDeliveryFee: 2000,
    allowedPaymentMethods: ['jumia_card', 'mobile_money_orange', 'mobile_money_mtn'],
    requestedPaymentMethod: 'mobile_money_orange',
  });
  const cartEstimate = estimateCartTotals({
    items: [
      {
        shopId: 's1',
        price: 48000,
        quantity: 2,
        deliveryFee: 2500,
        deliveryZones: prod.deliveryZones,
      },
    ],
    deliveryZoneId: 'national',
    defaultDeliveryFee: 2000,
  });

  assert.equal(serverResult.subtotal, 96000);
  assert.equal(serverResult.deliveryTotal, 3500);
  assert.equal(serverResult.totalAmount, 99500);
  assert.deepEqual(cartEstimate, {
    subtotal: serverResult.subtotal,
    deliveryTotal: serverResult.deliveryTotal,
    totalAmount: serverResult.totalAmount,
    vatAmount: serverResult.vatAmount,
    grandTotal: serverResult.grandTotal,
    grandTotalBeforeDiscount: serverResult.grandTotalBeforeDiscount,
    discountAmount: serverResult.discountAmount,
    commissionAmount: serverResult.commissionAmount,
    vendorNetAmount: serverResult.vendorNetAmount,
  });

  assert.equal(
    resolveProductDeliveryFee({
      deliveryZones: [],
      deliveryFee: -1,
      deliveryZoneId: 'regional',
      defaultDeliveryFee: 2000,
      zoneDefaults: [{ zoneId: 'regional', zoneName: 'Régional', fee: 6500 }],
    }),
    6500
  );

  assert.throws(() => {
    calculateOrderTotals({
      lines: [{ productId: 'p1', variantId: 'var1', quantity: 1 }],
      productsById: map,
      deliveryZoneId: 'abidjan',
      defaultDeliveryFee: 2000,
      allowedPaymentMethods: ['jumia_card', 'mobile_money_orange', 'mobile_money_mtn'],
      requestedPaymentMethod: 'mobile_money_mtn',
    });
  }, /pas accepté/);
});

test('canLeaveReview requires delivered order event and prevents duplicate review', () => {
  const paidOnly = [{ id: 'e1', orderId: 'o1', status: 'payee' as const, note: '', actor: 'sys', createdAt: '' }];
  assert.equal(canLeaveReview(paidOnly, false).allowed, false);

  const delivered = [
    ...paidOnly,
    { id: 'e2', orderId: 'o1', status: 'livree' as const, note: '', actor: 'vendor', createdAt: '' },
  ];
  assert.equal(canLeaveReview(delivered, false).allowed, true);
  assert.equal(canLeaveReview(delivered, true).allowed, false);
});

test('isOrderExpired checks RG-10 deadline for pending orders', () => {
  const past = new Date(Date.now() - 3600_000).toISOString();
  const future = new Date(Date.now() + 3600_000).toISOString();
  assert.equal(isOrderExpired({ paymentStatus: 'pending', expiresAt: past }), true);
  assert.equal(isOrderExpired({ paymentStatus: 'pending', expiresAt: future }), false);
  assert.equal(isOrderExpired({ paymentStatus: 'paid', expiresAt: past }), false);
});

test('VAT & marketplace commission: zero rates keep legacy totals, non-zero rates stay consistent client/server', () => {
  const prod: Product = {
    id: 'p2',
    vendorId: 'v2',
    shopId: 's2',
    title: 'Groupe Électrogène',
    description: 'Groupe diesel 10 kVA',
    categoryId: 'c1',
    price: 1000000,
    condition: 'Neuf',
    status: 'publie',
    stock: 5,
    keywords: [],
    media: [],
    videoUrl: null,
    variants: [],
    deliveryFee: 50000,
    deliveryZones: [],
    deliveryDelay: '24-48h',
    paymentMethods: ['jumia_card'],
    ratingAverage: 0,
    reviewCount: 0,
    createdAt: '',
    updatedAt: '',
  };
  const map = new Map<string, Product>([['p2', prod]]);

  // Default rates (0 %) — strict legacy parity
  const legacy = calculateOrderTotals({
    lines: [{ productId: 'p2', quantity: 1 }],
    productsById: map,
    deliveryZoneId: 'abidjan',
    defaultDeliveryFee: 2000,
    allowedPaymentMethods: ['jumia_card'],
    requestedPaymentMethod: 'jumia_card',
  });
  assert.equal(legacy.vatAmount, 0);
  assert.equal(legacy.commissionAmount, 0);
  assert.equal(legacy.grandTotal, legacy.totalAmount);
  assert.equal(legacy.vendorNetAmount, legacy.totalAmount);

  // 18 % VAT + 5 % commission — identical computation on both sides
  const rates = { vatRatePercent: 18, commissionRatePercent: 5 };
  const server = calculateOrderTotals({
    lines: [{ productId: 'p2', quantity: 1 }],
    productsById: map,
    deliveryZoneId: 'abidjan',
    defaultDeliveryFee: 2000,
    allowedPaymentMethods: ['jumia_card'],
    requestedPaymentMethod: 'jumia_card',
    ...rates,
  });
  const client = estimateCartTotals({
    items: [{ shopId: 's2', price: 1000000, quantity: 1, deliveryFee: 50000, deliveryZones: [] }],
    deliveryZoneId: 'abidjan',
    defaultDeliveryFee: 2000,
    ...rates,
  });

  assert.equal(server.subtotal, 1000000);
  assert.equal(server.deliveryTotal, 50000);
  assert.equal(server.vatAmount, Math.round(1050000 * 0.18));
  assert.equal(server.grandTotal, 1050000 + Math.round(1050000 * 0.18));
  assert.equal(server.commissionAmount, 50000);
  assert.equal(server.vendorNetAmount, 1050000 - 50000);
  assert.deepEqual(client, {
    subtotal: server.subtotal,
    deliveryTotal: server.deliveryTotal,
    totalAmount: server.totalAmount,
    vatAmount: server.vatAmount,
    grandTotal: server.grandTotal,
    grandTotalBeforeDiscount: server.grandTotalBeforeDiscount,
    discountAmount: server.discountAmount,
    commissionAmount: server.commissionAmount,
    vendorNetAmount: server.vendorNetAmount,
  });

  // Inclusive (TTC) custom-quote split: 1 180 000 FCFA TTC @18 % → HT 1 000 000
  const split = splitInclusiveVat(1180000, 18);
  assert.equal(split.netTotal, 1000000);
  assert.equal(split.vatAmount, 180000);
  assert.deepEqual(splitInclusiveVat(1180000, 0), { vatAmount: 0, netTotal: 1180000 });
});

test('computePaymentBreakdown enforces quote-only-when-custom, deposit split, and bank transfer threshold/RIB', () => {
  const full = computePaymentBreakdown({
    totalAmount: 1000000,
    paymentMode: 'full',
    depositPercent: 30,
    hasCustomOffer: false,
    bankTransferThreshold: 5000000,
    sellerHasBankDetails: true,
  });
  assert.equal(full.valid, true);
  assert.equal(full.upfrontAmount, 1000000);
  assert.equal(full.balanceDue, 0);

  const dep = computePaymentBreakdown({
    totalAmount: 1000000,
    paymentMode: 'deposit',
    depositPercent: 30,
    hasCustomOffer: false,
    bankTransferThreshold: 5000000,
    sellerHasBankDetails: false,
  });
  assert.equal(dep.valid, true);
  assert.equal(dep.upfrontAmount, 300000);
  assert.equal(dep.balanceDue, 700000);

  const invalidQuote = computePaymentBreakdown({
    totalAmount: 1000000,
    paymentMode: 'quote',
    depositPercent: 30,
    hasCustomOffer: false,
    bankTransferThreshold: 5000000,
    sellerHasBankDetails: false,
  });
  assert.equal(invalidQuote.valid, false);

  const validQuote = computePaymentBreakdown({
    totalAmount: 1000000,
    paymentMode: 'quote',
    depositPercent: 30,
    hasCustomOffer: true,
    bankTransferThreshold: 5000000,
    sellerHasBankDetails: false,
  });
  assert.equal(validQuote.valid, true);
  assert.equal(validQuote.upfrontAmount, 0);

  const bankBelowThreshold = computePaymentBreakdown({
    totalAmount: 4500000,
    paymentMode: 'bank_transfer',
    depositPercent: 30,
    hasCustomOffer: false,
    bankTransferThreshold: 5000000,
    sellerHasBankDetails: true,
  });
  assert.equal(bankBelowThreshold.valid, false);

  const bankNoRib = computePaymentBreakdown({
    totalAmount: 6500000,
    paymentMode: 'bank_transfer',
    depositPercent: 30,
    hasCustomOffer: false,
    bankTransferThreshold: 5000000,
    sellerHasBankDetails: false,
  });
  assert.equal(bankNoRib.valid, false);

  const bankOk = computePaymentBreakdown({
    totalAmount: 6500000,
    paymentMode: 'bank_transfer',
    depositPercent: 30,
    hasCustomOffer: false,
    bankTransferThreshold: 5000000,
    sellerHasBankDetails: true,
  });
  assert.equal(bankOk.valid, true);
  assert.equal(bankOk.balanceDue, 6500000);
});

test('detectCircumvention blocks phone numbers, emails, links, and off-platform cues while allowing technical specs', () => {
  assert.equal(
    detectCircumvention('Largeur godet 1800 mm, pression hydraulique 210 bars, moteur diesel 90 CV.').blocked,
    false
  );
  assert.equal(detectCircumvention('Appelez-moi au +225 07 11 22 33 44').blocked, true);
  assert.equal(detectCircumvention('Mon mail : acheteur@test.ci').blocked, true);
  assert.equal(detectCircumvention('Écrivez-moi sur WhatsApp').blocked, true);
  assert.equal(detectCircumvention('Voir https://mon-site-externe.com').blocked, true);
});

test('filterAndSortProducts and filterAndSortShops support rich multi-token search and contextual filters', () => {
  const baseProd = (over: Partial<Product>): Product => ({
    id: 'p1',
    vendorId: 'v1',
    shopId: 's1',
    title: 'Tracteur Agricole',
    description: 'Moteur diesel 90 CV',
    categoryId: 'cat-tracteurs',
    categoryName: 'Tracteurs',
    shopName: 'Agrimat CI',
    vendorStatus: 'certifie',
    shopBadges: ['Vendeur certifié'],
    price: 12000000,
    condition: 'Neuf',
    status: 'publie',
    stock: 4,
    keywords: ['diesel', '4x4'],
    media: [],
    videoUrl: null,
    variants: [],
    deliveryFee: 25000,
    deliveryZones: [],
    deliveryDelay: '72h',
    paymentMethods: ['jumia_card'],
    ratingAverage: 4.8,
    reviewCount: 5,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  });

  const prods = [
    baseProd({ id: 'p1', title: 'Tracteur Pelle Hydraulique', stock: 5, condition: 'Neuf', deliveryFee: 15000 }),
    baseProd({ id: 'p2', title: 'Groupe Électrogène 30 kVA', stock: 1, condition: 'Reconditionné', deliveryFee: 50000, price: 4000000 }),
  ];

  const found = filterAndSortProducts(prods, {
    q: 'hydraulique pelle',
    minStock: 3,
    condition: 'Neuf',
    maxDeliveryFee: 20000,
    sort: 'relevance',
  });
  assert.equal(found.length, 1);
  assert.equal(found[0].id, 'p1');

  const shops: Shop[] = [
    {
      id: 's1',
      vendorId: 'v1',
      name: 'Abidjan Heavy Equip',
      slug: 'abidjan-heavy',
      description: 'Matériel BTP',
      logoUrl: null,
      city: 'Abidjan',
      contactEmail: '',
      contactPhone: null,
      defaultDeliveryFee: 15000,
      defaultDeliveryDelay: '48h',
      vendorStatus: 'certifie',
      badges: ['Vendeur certifié', 'Livraison express'],
      ratingAverage: 4.9,
      reviewCount: 12,
      salesCount: 28,
      publishedProductsCount: 8,
      createdAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 's2',
      vendorId: 'v2',
      name: 'Atelier Bouaké',
      slug: 'atelier-bouake',
      description: 'Outillage',
      logoUrl: null,
      city: 'Bouaké',
      contactEmail: '',
      contactPhone: null,
      defaultDeliveryFee: 5000,
      defaultDeliveryDelay: '72h',
      vendorStatus: 'valide',
      badges: [],
      ratingAverage: 4.1,
      reviewCount: 2,
      salesCount: 3,
      publishedProductsCount: 2,
      createdAt: '2026-01-01T00:00:00Z',
    },
  ];

  const matchedShops = filterAndSortShops(shops, {
    q: 'btp abidjan',
    minSales: 10,
    certifiedOnly: true,
    badge: 'Livraison express',
  });
  assert.equal(matchedShops.length, 1);
  assert.equal(matchedShops[0].id, 's1');
});

test('extractTrackingTokenFromInput parses raw tokens, full URLs, and query snippets', () => {
  const tok = 'eyJvcmRlcklkIjoib3JkLTEyMyIsInYiOjF9.abcDEF_123';
  assert.equal(extractTrackingTokenFromInput(tok), tok);
  assert.equal(extractTrackingTokenFromInput(`  https://simcova.africa/?suivi=${encodeURIComponent(tok)}  `), tok);
  assert.equal(extractTrackingTokenFromInput(`/?suivi=${tok}`), tok);
  assert.equal(extractTrackingTokenFromInput(`suivi=${tok}`), tok);
  assert.equal(extractTrackingTokenFromInput('   '), '');
});

test('computeOrderProgressRank preserves step 4 (livree) after post-delivery confirm-balance event', () => {
  const afterDepositAndDeliveryAndBalance = [
    { status: 'creee' as const },
    { status: 'en_attente_paiement' as const },
    { status: 'acompte_paye' as const },
    { status: 'en_preparation' as const },
    { status: 'expediee' as const },
    { status: 'livree' as const },
    { status: 'payee' as const },
  ];
  const res = computeOrderProgressRank(afterDepositAndDeliveryAndBalance, 'paid');
  assert.equal(res.isTerminalNegative, false);
  assert.equal(res.rank, 3);

  const cancelled = computeOrderProgressRank([...afterDepositAndDeliveryAndBalance, { status: 'remboursee' as const }], 'refunded');
  assert.equal(cancelled.isTerminalNegative, true);
  assert.equal(cancelled.rank, -1);
});

test('allCartShopsHaveBankDetails enforces RIB on every distinct shop in cart', () => {
  const shops = [
    { id: 's1', hasBankDetails: true },
    { id: 's2', hasBankDetails: false },
    { id: 's3', hasBankDetails: true },
  ];
  assert.equal(allCartShopsHaveBankDetails(['s1', 's3'], shops), true);
  assert.equal(allCartShopsHaveBankDetails(['s1', 's2'], shops), false);
  assert.equal(allCartShopsHaveBankDetails([], shops), false);
});


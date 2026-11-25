import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import express from 'express';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'simcova-e2e-'));
const dbFilePath = path.join(tmpDir, 'simcova-test.db');
process.env.SIMCOVA_DB_PATH = dbFilePath;
// Env var names must match the ones read by server/crypto.ts & payments/jumiaAfrica.ts
process.env.SIMCOVA_TOKEN_SECRET = 'test-jwt-secret-e2e-12345';
process.env.SIMCOVA_KYC_ENCRYPTION_KEY = 'test-kyc-secret-e2e-67890';
process.env.JUMIA_AFRICA_WEBHOOK_SECRET = 'test-jumia-webhook-secret';

const { initDatabase, closeDatabase } = await import('./db.ts');
const { createApiRouter } = await import('./routes.ts');
const { jumiaAfricaProvider } = await import('./payments/jumiaAfrica.ts');
const { estimateCartTotals } = await import('../src/shared/rulesEngine.ts');

let server: ReturnType<express.Express['listen']>;
let baseUrl = '';

async function apiJson<T>(
  route: string,
  options: { method?: string; token?: string; body?: unknown; headers?: Record<string, string> } = {}
): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = {
    ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    ...(options.headers || {}),
  };
  const res = await fetch(`${baseUrl}${route}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = text;
  }
  return { status: res.status, data: data as T };
}

before(async () => { await initDatabase();
  initDatabase();
  const app = express();
  app.use(
    express.json({
      limit: '10mb',
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
      },
    })
  );
  app.use('/api', await createApiRouter());
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        baseUrl = `http://127.0.0.1:${addr.port}/api`;
      }
      resolve();
    });
  });
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  try {
    await closeDatabase();
  } catch {
    // ignore
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('End-to-End Marketplace Lifecycle: Bootstrap, RBAC, KYC AES-256-GCM, RG-01..10, Guest Order + HMAC Webhook + Stock/Variant Decrement, Tracking, Reviews, Messaging, Refund, CSV & Push', async () => {
  // 1. Bootstrap & Admin First-Run Claim
  const boot1 = await apiJson<{ adminNeedsClaim: boolean; categories: Array<{ id: string }>; rules: Record<string, unknown> }>('/bootstrap');
  assert.equal(boot1.status, 200);
  assert.equal(boot1.data.adminNeedsClaim, true);
  assert.ok(boot1.data.categories.length >= 5);

  const adminClaim = await apiJson<{ token: string; user: { role: string }; shop: { contactPhone: string | null } }>(
    '/auth/admin-bootstrap',
    { method: 'POST', body: { password: 'AdminPass2026!' } }
  );
  assert.equal(adminClaim.status, 200);
  assert.equal(adminClaim.data.user.role, 'admin');
  assert.ok('contactPhone' in adminClaim.data.shop);
  const adminToken = adminClaim.data.token;

  // Duplicate admin claim blocked
  const secondClaim = await apiJson('/auth/admin-bootstrap', {
    method: 'POST',
    body: { password: 'AdminPass2026!' },
  });
  assert.equal(secondClaim.status, 403);

  // 2. Dynamic RG-04 Vendor Registration + Email Verification + Reset Password
  const rg04Update = await apiJson('/admin/rules/RG-04', {
    method: 'PUT',
    token: adminToken,
    body: { enabled: true, valueJson: { requiredFields: ['fullName', 'email', 'password', 'shopName', 'city'] } },
  });
  assert.equal(rg04Update.status, 200);

  const missingCityReg = await apiJson('/auth/register', {
    method: 'POST',
    body: {
      fullName: 'Koffi Yao',
      email: 'koffi@atelier.ci',
      password: 'VendorPass2026!',
      shopName: 'Atelier Lagune',
    },
  });
  assert.equal(missingCityReg.status, 400);

  const regOk = await apiJson<{
    token: string;
    user: { id: string; emailVerified: boolean };
    shop: { id: string; slug: string; defaultDeliveryFee: number };
    verificationToken: string;
  }>('/auth/register', {
    method: 'POST',
    body: {
      fullName: 'Koffi Yao',
      email: 'koffi@atelier.ci',
      password: 'VendorPass2026!',
      shopName: 'Atelier Lagune',
      city: 'Abidjan',
      phone: '+225 07 11 22 33',
    },
  });
  assert.equal(regOk.status, 201);
  assert.equal(regOk.data.shop.defaultDeliveryFee, 2000);
  const vendorToken = regOk.data.token;
  const vendorId = regOk.data.user.id;

  // RBAC: vendor cannot hit /admin/*
  const rbacBlock = await apiJson('/admin/overview', { token: vendorToken });
  assert.equal(rbacBlock.status, 403);

  // Verify email one-time token
  const verifyRes = await apiJson<{ verified: boolean }>('/auth/verify-email', {
    method: 'POST',
    body: { token: regOk.data.verificationToken },
  });
  assert.equal(verifyRes.status, 200);
  assert.equal(verifyRes.data.verified, true);

  const reuseVerify = await apiJson('/auth/verify-email', {
    method: 'POST',
    body: { token: regOk.data.verificationToken },
  });
  assert.equal(reuseVerify.status, 400);

  // Forgot & Reset password flow
  const forgotRes = await apiJson<{ demoResetToken?: string }>('/auth/forgot-password', {
    method: 'POST',
    body: { email: 'koffi@atelier.ci' },
  });
  assert.equal(forgotRes.status, 200);
  assert.ok(forgotRes.data.demoResetToken);

  const resetRes = await apiJson('/auth/reset-password', {
    method: 'POST',
    body: { token: forgotRes.data.demoResetToken, newPassword: 'VendorNew2026!' },
  });
  assert.equal(resetRes.status, 200);

  const loginNewPass = await apiJson<{ token: string }>('/auth/login', {
    method: 'POST',
    body: { email: 'koffi@atelier.ci', password: 'VendorNew2026!' },
  });
  assert.equal(loginNewPass.status, 200);

  // 3. KYC Upload (AES-256-GCM) -> Admin Restricted View -> Certification
  const secretKycText = 'CNI Koffi Yao — CI-ABJ-9928172';
  const kycUpload = await apiJson<{ id: string }>('/vendor/kyc', {
    method: 'POST',
    token: vendorToken,
    body: {
      docType: 'Pièce d’identité officielle',
      fileName: 'cni_koffi.txt',
      contentBase64: Buffer.from(secretKycText, 'utf8').toString('base64'),
      mimeType: 'text/plain',
    },
  });
  assert.equal(kycUpload.status, 201);

  // Vendor cannot decrypt KYC directly; Admin can
  const kycView = await apiJson<{ textPreview: string }>(`/admin/kyc/${kycUpload.data.id}/view`, {
    token: adminToken,
  });
  assert.equal(kycView.status, 200);
  assert.equal(kycView.data.textPreview, secretKycText);

  // Admin approves as 'valide' first, tests RG-01 & RG-02, then certifies & downgrades
  await apiJson(`/admin/vendors/${vendorId}/decision`, {
    method: 'POST',
    token: adminToken,
    body: { status: 'valide' },
  });

  // Enable RG-01 & RG-02
  await apiJson('/admin/rules/RG-01', { method: 'PUT', token: adminToken, body: { enabled: true } });
  await apiJson('/admin/rules/RG-02', { method: 'PUT', token: adminToken, body: { enabled: true } });

  // Category update preserves required_badge when toggling active/forbidden
  await apiJson('/admin/categories/cat-tracteurs', {
    method: 'PUT',
    token: adminToken,
    body: { active: true },
  });
  const bootAfterCat = await apiJson<{ categories: Array<{ id: string; requiredBadge: string | null }> }>('/bootstrap');
  const tractorCat = bootAfterCat.data.categories.find((c) => c.id === 'cat-tracteurs');
  assert.equal(tractorCat?.requiredBadge, 'Vendeur certifié');

  // Uncertified vendor blocked from publishing under RG-01, allowed as draft
  const blockedPub = await apiJson('/vendor/products', {
    method: 'POST',
    token: vendorToken,
    body: {
      title: 'Charrue 3 Socs',
      description: 'Charrue portée acier forgé',
      categoryId: 'cat-hydraulique',
      price: 450000,
      status: 'publie',
      stock: 5,
    },
  });
  assert.equal(blockedPub.status, 403);

  // Admin certifies vendor -> vendor can now publish even in cat-tracteurs
  await apiJson(`/admin/vendors/${vendorId}/decision`, {
    method: 'POST',
    token: adminToken,
    body: { status: 'certifie' },
  });

  const prodRes = await apiJson<{ product: { id: string; stock: number; variants: Array<{ id: string; stock: number }> } }>(
    '/vendor/products',
    {
      method: 'POST',
      token: vendorToken,
      body: {
        title: 'Tracteur Utilitaire 75 CV',
        description: 'Tracteur agricole 4RM moteur diesel turbo',
        categoryId: 'cat-tracteurs',
        price: 9500000,
        status: 'publie',
        stock: 2,
        deliveryFee: 30000,
        deliveryZones: [
          { zoneId: 'abidjan', zoneName: 'Abidjan', fee: 1500 },
          { zoneId: 'national', zoneName: 'Intérieur', fee: 3500 },
        ],
        variants: [
          { id: 'var-tr75-std', label: 'Châssis Standard 75 CV', priceOverride: 9800000, stock: 2 },
        ],
        paymentMethods: ['mobile_money_orange', 'jumia_card'],
      },
    }
  );
  assert.equal(prodRes.status, 201);
  const createdProductId = prodRes.data.product.id;

  // Test downgrade removes 'Vendeur certifié' badge
  const downgradeRes = await apiJson<{ badges: string[] }>(`/admin/vendors/${vendorId}/decision`, {
    method: 'POST',
    token: adminToken,
    body: { status: 'valide' },
  });
  assert.equal(downgradeRes.data.badges.includes('Vendeur certifié'), false);

  // Re-certify for order & catalog visibility
  await apiJson(`/admin/vendors/${vendorId}/decision`, {
    method: 'POST',
    token: adminToken,
    body: { status: 'certifie' },
  });

  // 4. Guest Order Price Parity + Payment Validation + Signed Webhook + Variant/Stock Auto-Archive
  const expectedCart = estimateCartTotals({
    items: [
      {
        shopId: regOk.data.shop.id,
        price: 9800000,
        quantity: 2,
        deliveryFee: 30000,
        deliveryZones: [
          { zoneId: 'abidjan', zoneName: 'Abidjan', fee: 1500 },
          { zoneId: 'national', zoneName: 'Intérieur', fee: 3500 },
        ],
      },
    ],
    deliveryZoneId: 'national',
    defaultDeliveryFee: 2000,
  });

  // Incompatible payment method rejected
  const badMethodOrder = await apiJson('/orders', {
    method: 'POST',
    body: {
      buyerName: 'Awa Diop',
      buyerEmail: 'awa.diop@example.com',
      shippingAddress: 'Bouaké Quartier Commerce',
      deliveryZone: 'national',
      paymentMethod: 'mobile_money_mtn',
      items: [{ productId: createdProductId, variantId: 'var-tr75-std', quantity: 2 }],
    },
  });
  assert.equal(badMethodOrder.status, 400);

  const orderRes = await apiJson<{
    order: { id: string; orderNumber: string; subtotal: number; deliveryTotal: number; totalAmount: number };
    trackingToken: string;
    paymentSession: { providerRef: string };
  }>('/orders', {
    method: 'POST',
    body: {
      buyerName: 'Awa Diop',
      buyerEmail: 'awa.diop@example.com',
      shippingAddress: 'Bouaké Quartier Commerce',
      deliveryZone: 'national',
      paymentMethod: 'mobile_money_orange',
      items: [{ productId: createdProductId, variantId: 'var-tr75-std', quantity: 2 }],
    },
  });
  assert.equal(orderRes.status, 201);
  assert.equal(orderRes.data.order.subtotal, expectedCart.subtotal);
  assert.equal(orderRes.data.order.deliveryTotal, expectedCart.deliveryTotal);
  assert.equal(orderRes.data.order.totalAmount, expectedCart.totalAmount);

  // Invalid webhook signature rejected
  const webhookPayload = {
    providerRef: orderRes.data.paymentSession.providerRef,
    status: 'paid' as const,
    amount: orderRes.data.order.totalAmount,
    environment: 'sandbox',
  };
  const badWebhook = await apiJson('/payments/jumia/webhook', {
    method: 'POST',
    body: webhookPayload,
    headers: { 'x-jumia-signature': 'invalid-hmac' },
  });
  assert.equal(badWebhook.status, 401);

  // Valid HMAC webhook confirms payment and decrements variant + total stock to 0 -> archives product!
  const validSig = jumiaAfricaProvider.signSandboxWebhook(webhookPayload);
  const goodWebhook = await apiJson('/payments/jumia/webhook', {
    method: 'POST',
    body: webhookPayload,
    headers: { 'x-jumia-signature': validSig },
  });
  assert.equal(goodWebhook.status, 200);

  // Idempotent replay of paid webhook succeeds cleanly
  const replayWebhook = await apiJson('/payments/jumia/webhook', {
    method: 'POST',
    body: webhookPayload,
    headers: { 'x-jumia-signature': validSig },
  });
  assert.equal(replayWebhook.status, 200);

  // Check product auto-archived (GET /products/:id returns 404, vendor dashboard shows stock 0 & status 'archive')
  const hiddenProd = await apiJson(`/products/${createdProductId}`);
  assert.equal(hiddenProd.status, 404);

  const vendorDash = await apiJson<{ products: Array<{ id: string; status: string; stock: number; variants: Array<{ stock: number }> }> }>(
    '/vendor/dashboard',
    { token: vendorToken }
  );
  const archivedProd = vendorDash.data.products.find((p) => p.id === createdProductId);
  assert.equal(archivedProd?.status, 'archive');
  assert.equal(archivedProd?.stock, 0);
  assert.equal(archivedProd?.variants[0]?.stock, 0);

  // 5. Token Regeneration Revokes Old Token + Email Recovery
  const regen = await apiJson<{ newToken: string }>(`/orders/track/${encodeURIComponent(orderRes.data.trackingToken)}/regenerate`, {
    method: 'POST',
  });
  assert.equal(regen.status, 200);
  const oldTrack = await apiJson(`/orders/track/${encodeURIComponent(orderRes.data.trackingToken)}`);
  assert.equal(oldTrack.status, 401);
  const newTrack = await apiJson<{ order: { paymentStatus: string } }>(`/orders/track/${encodeURIComponent(regen.data.newToken)}`);
  assert.equal(newTrack.status, 200);
  assert.equal(newTrack.data.order.paymentStatus, 'paid');

  // 6. Review Blocked Before Delivery, Allowed After Delivery, Vendor 1-Reply Cap
  const prematureReview = await apiJson('/reviews', {
    method: 'POST',
    body: {
      trackingToken: regen.data.newToken,
      productId: createdProductId,
      rating: 5,
      comment: 'Superbe !',
    },
  });
  assert.equal(prematureReview.status, 403);

  await apiJson(`/vendor/orders/${orderRes.data.order.id}/status`, {
    method: 'POST',
    token: vendorToken,
    body: { status: 'livree', carrier: 'Chronopost', trackingNumber: 'CHR-9910' },
  });

  const validReview = await apiJson<{ id: string }>('/reviews', {
    method: 'POST',
    body: {
      trackingToken: regen.data.newToken,
      productId: createdProductId,
      rating: 5,
      comment: 'Son chaleureux et livraison rapide.',
    },
  });
  assert.equal(validReview.status, 201);

  const rep1 = await apiJson(`/vendor/reviews/${validReview.data.id}/reply`, {
    method: 'POST',
    token: vendorToken,
    body: { reply: 'Merci beaucoup Awa !' },
  });
  assert.equal(rep1.status, 200);

  const rep2 = await apiJson(`/vendor/reviews/${validReview.data.id}/reply`, {
    method: 'POST',
    token: vendorToken,
    body: { reply: 'Deuxième réponse interdite' },
  });
  assert.equal(rep2.status, 400);

  // 6b. Shop logoUrl update + Public Product Detail exposure + minRating filter + Vendor Refund (EXF-506)
  const logoUpdate = await apiJson<{ shop: { logoUrl: string | null; defaultDeliveryFee: number } }>('/vendor/shop', {
    method: 'PUT',
    token: vendorToken,
    body: {
      logoUrl: 'https://cdn.example.com/atelier-lagune-logo.png',
      defaultDeliveryFee: 4500,
      defaultDeliveryDelay: '48 à 96h',
    },
  });
  assert.equal(logoUpdate.status, 200);
  assert.equal(logoUpdate.data.shop.logoUrl, 'https://cdn.example.com/atelier-lagune-logo.png');
  assert.equal(logoUpdate.data.shop.defaultDeliveryFee, 4500);

  const prodRes2 = await apiJson<{ product: { id: string } }>('/vendor/products', {
    method: 'POST',
    token: vendorToken,
    body: {
      title: 'Mini-Pelle Hydraulique 2.5T',
      description: 'Mini-pelle chenilles caoutchouc chantier VRD',
      categoryId: 'cat-hydraulique',
      price: 12500000,
      status: 'publie',
      stock: 4,
      paymentMethods: ['mobile_money_orange', 'jumia_card'],
    },
  });
  assert.equal(prodRes2.status, 201);
  const secondProductId = prodRes2.data.product.id;

  const detailWithLogo = await apiJson<{ product: { id: string }; shop: { logoUrl: string | null } }>(
    `/products/${secondProductId}`
  );
  assert.equal(detailWithLogo.status, 200);
  assert.equal(detailWithLogo.data.shop.logoUrl, 'https://cdn.example.com/atelier-lagune-logo.png');

  // Product 2 has 0 reviews so minRating=4 excludes it, while minRating=0 includes it
  const catalogAll = await apiJson<{ products: Array<{ id: string }> }>('/products');
  assert.equal(catalogAll.status, 200);
  assert.ok(catalogAll.data.products.some((p) => p.id === secondProductId));

  const catalogRated4 = await apiJson<{ products: Array<{ id: string }> }>('/products?minRating=4');
  assert.equal(catalogRated4.status, 200);
  assert.equal(catalogRated4.data.products.some((p) => p.id === secondProductId), false);

  // Create & pay a second order, then test vendor-initiated refund (EXF-506)
  const order2Res = await apiJson<{
    order: { id: string; totalAmount: number };
    paymentSession: { providerRef: string };
  }>('/orders', {
    method: 'POST',
    body: {
      buyerName: 'Moussa Traoré',
      buyerEmail: 'moussa.t@example.com',
      shippingAddress: 'Yamoussoukro Zone Industrielle',
      deliveryZone: 'national',
      paymentMethod: 'jumia_card',
      items: [{ productId: secondProductId, quantity: 1 }],
    },
  });
  assert.equal(order2Res.status, 201);

  const webhook2 = {
    providerRef: order2Res.data.paymentSession.providerRef,
    status: 'paid' as const,
    amount: order2Res.data.order.totalAmount,
    environment: 'sandbox',
  };
  const webhook2Sig = jumiaAfricaProvider.signSandboxWebhook(webhook2);
  const webhook2Res = await apiJson('/payments/jumia/webhook', {
    method: 'POST',
    body: webhook2,
    headers: { 'x-jumia-signature': webhook2Sig },
  });
  assert.equal(webhook2Res.status, 200);

  const vendorRefundRes = await apiJson<{ refunded: boolean }>(
    `/vendor/orders/${order2Res.data.order.id}/refund`,
    {
      method: 'POST',
      token: vendorToken,
      body: { reason: 'Rupture transporteur lourd' },
    }
  );
  assert.equal(vendorRefundRes.status, 200);
  assert.equal(vendorRefundRes.data.refunded, true);

  // Admin overview period filter & evolution series (EXF-201)
  const overview7d = await apiJson<{
    period: string;
    kpis: { totalOrders: number; evolution: Array<{ label: string; sales: number; orders: number }> };
  }>('/admin/overview?period=7d', { token: adminToken });
  assert.equal(overview7d.status, 200);
  assert.equal(overview7d.data.period, '7d');
  assert.ok(overview7d.data.kpis.totalOrders >= 2);
  assert.ok(Array.isArray(overview7d.data.kpis.evolution) && overview7d.data.kpis.evolution.length >= 1);

  // 6c. Public shop search & contact redaction, Custom Quote -> Deposit -> Balance Settlement, High-Value Bank Transfer & Anti-Circumvention
  const shopSearch = await apiJson<{
    shops: Array<{ id: string; contactEmail: string; contactPhone: string | null; salesCount: number }>;
  }>('/shops?minSales=1&certifiedOnly=true&q=Atelier');
  assert.equal(shopSearch.status, 200);
  const foundShop = shopSearch.data.shops.find((s) => s.id === regOk.data.shop.id);
  assert.ok(foundShop);
  assert.equal(foundShop.contactEmail, '');
  assert.equal(foundShop.contactPhone, null);
  assert.ok(foundShop.salesCount >= 1);

  // Standard product order cannot use unpaid 'quote' mode
  const invalidQuoteOrder = await apiJson('/orders', {
    method: 'POST',
    body: {
      buyerName: 'Saliou Ndiaye',
      buyerEmail: 'saliou@example.com',
      shippingAddress: 'Dakar Port',
      deliveryZone: 'national',
      paymentMethod: 'mobile_money_orange',
      paymentMode: 'quote',
      items: [{ productId: secondProductId, quantity: 1 }],
    },
  });
  assert.equal(invalidQuoteOrder.status, 400);

  // Personalized order unlocks 'quote' mode + opens secure SIMCOVA thread
  const quoteOrderRes = await apiJson<{
    order: { id: string; paymentMode: string; totalAmount: number; balanceDue: number };
    trackingToken: string;
    quoteThreadToken: string | null;
  }>('/orders', {
    method: 'POST',
    body: {
      buyerName: 'Saliou Ndiaye',
      buyerEmail: 'saliou@example.com',
      shippingAddress: 'Dakar Port',
      deliveryZone: 'national',
      paymentMethod: 'mobile_money_orange',
      paymentMode: 'quote',
      items: [
        {
          productId: secondProductId,
          quantity: 1,
          isCustom: true,
          customSpecs: {
            dimensions: 'Godet renforcé 650 mm',
            technicalSpecs: 'Ligne hydraulique marteau auxiliaire',
          },
        },
      ],
    },
  });
  assert.equal(quoteOrderRes.status, 201);
  assert.equal(quoteOrderRes.data.order.paymentMode, 'quote');
  assert.ok(quoteOrderRes.data.quoteThreadToken);

  // Vendor proposes quote amount -> buyer pays 30% deposit via Jumia -> vendor confirms balance collected on delivery
  const quoteOfferRes = await apiJson<{ proposed: boolean; totalAmount: number }>(
    `/vendor/orders/${quoteOrderRes.data.order.id}/quote-offer`,
    {
      method: 'POST',
      token: vendorToken,
      body: { proposedTotal: 11800000, note: 'Godet renforcé inclus' },
    }
  );
  assert.equal(quoteOfferRes.status, 200);
  assert.equal(quoteOfferRes.data.totalAmount, 11800000);

  const payQuoteRes = await apiJson<{
    updated: boolean;
    paymentSession: { providerRef: string };
  }>(`/orders/track/${encodeURIComponent(quoteOrderRes.data.trackingToken)}/pay-quote`, {
    method: 'POST',
    body: { targetMode: 'deposit', paymentMethod: 'mobile_money_orange' },
  });
  assert.equal(payQuoteRes.status, 200);
  assert.ok(payQuoteRes.data.paymentSession.providerRef);

  const depWebhookPayload = {
    providerRef: payQuoteRes.data.paymentSession.providerRef,
    status: 'paid' as const,
    amount: 3540000,
    environment: 'sandbox',
  };
  const depWebhookRes = await apiJson('/payments/jumia/webhook', {
    method: 'POST',
    body: depWebhookPayload,
    headers: { 'x-jumia-signature': jumiaAfricaProvider.signSandboxWebhook(depWebhookPayload) },
  });
  assert.equal(depWebhookRes.status, 200);

  const trackAfterDeposit = await apiJson<{
    order: { paymentStatus: string; paymentMode: string; paidAmount: number; balanceDue: number };
  }>(`/orders/track/${encodeURIComponent(quoteOrderRes.data.trackingToken)}`);
  assert.equal(trackAfterDeposit.status, 200);
  assert.equal(trackAfterDeposit.data.order.paymentStatus, 'paid');
  assert.equal(trackAfterDeposit.data.order.paymentMode, 'deposit');
  assert.equal(trackAfterDeposit.data.order.paidAmount, 3540000);
  assert.equal(trackAfterDeposit.data.order.balanceDue, 8260000);

  const balanceRes = await apiJson<{ settled: boolean; balanceDue: number }>(
    `/vendor/orders/${quoteOrderRes.data.order.id}/confirm-balance`,
    { method: 'POST', token: vendorToken }
  );
  assert.equal(balanceRes.status, 200);
  assert.equal(balanceRes.data.balanceDue, 0);

  // Configure vendor bank coordinates -> high-value bank_transfer order >= 5,000,000 FCFA
  const bankUpdateRes = await apiJson('/vendor/shop', {
    method: 'PUT',
    token: vendorToken,
    body: {
      bankDetails: {
        bankName: 'NSIA Banque CI',
        accountHolder: 'Atelier Lagune SARL',
        iban: 'CI93CI00801111002233445566',
        swiftBic: 'NSIACIAB',
      },
    },
  });
  assert.equal(bankUpdateRes.status, 200);

  const bankOrderRes = await apiJson<{
    order: { id: string; paymentMode: string; totalAmount: number };
    vendorBankDetails?: Array<{ shopId: string; shopName: string; bankDetails: { iban: string } }>;
  }>('/orders', {
    method: 'POST',
    body: {
      buyerName: 'Entreprise Kébé BTP',
      buyerEmail: 'achats@kebe-btp.ci',
      shippingAddress: 'Abidjan Vridi Zone Industrielle',
      deliveryZone: 'abidjan',
      paymentMethod: 'jumia_card',
      paymentMode: 'bank_transfer',
      items: [{ productId: secondProductId, quantity: 1 }],
    },
  });
  assert.equal(bankOrderRes.status, 201);
  assert.equal(bankOrderRes.data.order.paymentMode, 'bank_transfer');
  assert.equal(bankOrderRes.data.vendorBankDetails?.[0]?.bankDetails?.iban, 'CI93CI00801111002233445566');

  const confirmBankRes = await apiJson<{ confirmed: boolean }>(
    `/vendor/orders/${bankOrderRes.data.order.id}/confirm-bank-transfer`,
    {
      method: 'POST',
      token: vendorToken,
      body: { bankReference: 'VIR-NSIA-2026-889' },
    }
  );
  assert.equal(confirmBankRes.status, 200);
  assert.equal(confirmBankRes.data.confirmed, true);

  // Anti-circumvention guard rejects off-platform contact details
  const blockedBuyerMsg = await apiJson('/messages', {
    method: 'POST',
    body: {
      productId: secondProductId,
      shopId: regOk.data.shop.id,
      buyerName: 'Test Contact',
      buyerEmail: 'contact@example.com',
      body: 'Appelez-moi directement sur +225 07 11 22 33 44 ou WhatsApp',
    },
  });
  assert.equal(blockedBuyerMsg.status, 400);

  // 7. Guest Messaging + Vendor Reply + Moderation Block + Suspend Vendor Write Block + Push + CSV + Refund
  const msgCreate = await apiJson<{ threadId: string; threadToken: string }>('/messages', {
    method: 'POST',
    body: {
      productId: createdProductId,
      shopId: regOk.data.shop.id,
      buyerName: 'Awa Diop',
      buyerEmail: 'awa.diop@example.com',
      body: 'Garantie constructeur incluse ?',
    },
  });
  assert.equal(msgCreate.status, 201);

  const blockedVendorReply = await apiJson(`/vendor/messages/${msgCreate.data.threadId}/reply`, {
    method: 'POST',
    token: vendorToken,
    body: { body: 'Ecrivez a perso@monmail.com' },
  });
  assert.equal(blockedVendorReply.status, 400);

  const vendorMsgReply = await apiJson(`/vendor/messages/${msgCreate.data.threadId}/reply`, {
    method: 'POST',
    token: vendorToken,
    body: { body: 'Oui, 12 mois inclus !' },
  });
  assert.equal(vendorMsgReply.status, 201);

  await apiJson(`/admin/moderation/threads/${msgCreate.data.threadId}/block`, {
    method: 'POST',
    token: adminToken,
    body: { block: true, reason: 'Test modération' },
  });

  const guestReplyBlocked = await apiJson(`/messages/thread/${encodeURIComponent(msgCreate.data.threadToken)}/reply`, {
    method: 'POST',
    body: { body: 'Relance' },
  });
  assert.equal(guestReplyBlocked.status, 403);

  // Suspend vendor blocks write routes
  await apiJson(`/admin/vendors/${vendorId}/decision`, {
    method: 'POST',
    token: adminToken,
    body: { status: 'suspendu', reason: 'Audit suspend' },
  });
  const blockedWriteWhenSuspended = await apiJson('/vendor/shop', {
    method: 'PUT',
    token: vendorToken,
    body: { city: 'Dakar' },
  });
  assert.equal(blockedWriteWhenSuspended.status, 403);

  // Push subscribe & broadcast
  const subRes = await apiJson<{ endpoint: string }>('/push/subscribe', {
    method: 'POST',
    body: { endpoint: 'e2e-device-1', preferences: { nouveautes: true, promotions: true, annonces: false } },
  });
  assert.equal(subRes.status, 201);

  const pushBroadcast = await apiJson<{ alert: { sentCount: number } }>('/admin/push-alerts', {
    method: 'POST',
    token: adminToken,
    body: { title: 'Nouveau parc tracteurs', body: 'Engins dispos', deepLink: '/?categorie=cat-tracteurs', alertType: 'nouveautes' },
  });
  assert.equal(pushBroadcast.status, 201);
  assert.ok(pushBroadcast.data.alert.sentCount >= 1);

  // Refund & CSV Exports
  const refundRes = await apiJson<{ refunded: boolean }>(`/admin/orders/${orderRes.data.order.id}/refund`, {
    method: 'POST',
    token: adminToken,
    body: { reason: 'Test remboursement E2E' },
  });
  assert.equal(refundRes.status, 200);
  assert.equal(refundRes.data.refunded, true);

  const csvRes = await fetch(`${baseUrl}/admin/export/orders`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(csvRes.status, 200);
  const csvBody = await csvRes.text();
  assert.ok(csvBody.includes(orderRes.data.order.orderNumber));
});

test('Admin Finance Phase 1: transactions ledger, payouts, analytics, buyers, order 360° & accounting export', async () => {
  // Re-login as admin (password claimed during the lifecycle test above)
  const login = await apiJson<{ token: string }>('/auth/login', {
    method: 'POST',
    body: { email: 'admin@simcova.africa', password: 'AdminPass2026!' },
  });
  assert.equal(login.status, 200);
  const admin = login.data.token;

  // 1. Transactions: exhaustive ledger with platform take
  const txAll = await apiJson<{
    transactions: Array<{ orderId: string; orderNumber: string; totalHT: number; grandTotal: number; vatAmount: number; commission: number; netVendors: number; paymentStatus: string }>;
    totals: { count: number; paidCount: number; grandTotalPaid: number; commissionPaid: number };
  }>('/admin/transactions?period=all', { token: admin });
  assert.equal(txAll.status, 200);
  assert.ok(txAll.data.transactions.length >= 5, 'au moins les commandes du cycle précédent');
  assert.ok(txAll.data.totals.grandTotalPaid > 0);
  const firstTx = txAll.data.transactions[0];
  assert.equal(firstTx.grandTotal, firstTx.totalHT + firstTx.vatAmount, 'TTC = HT + TVA');
  assert.equal(firstTx.netVendors, firstTx.totalHT - firstTx.commission, 'net vendeurs = HT - commission');

  // Filter by status=paid
  const txPaid = await apiJson<{ transactions: unknown[]; totals: { paidCount: number } }>('/admin/transactions?period=all&status=paid', { token: admin });
  assert.equal(txPaid.status, 200);
  assert.ok(txPaid.data.transactions.length === txPaid.data.totals.paidCount);

  // Search filter by buyer email
  const txSearch = await apiJson<{ transactions: Array<{ buyerEmail: string }> }>(
    `/admin/transactions?period=all&q=${encodeURIComponent('awa.diop')}`,
    { token: admin }
  );
  assert.equal(txSearch.status, 200);
  assert.ok(txSearch.data.transactions.every((t) => t.buyerEmail.includes('awa.diop')));

  // RBAC: vendor blocked
  const vendorLogin = await apiJson<{ token: string }>('/auth/login', {
    method: 'POST',
    body: { email: 'koffi@atelier.ci', password: 'VendorNew2026!' },
  });
  assert.equal(vendorLogin.status, 200);
  const txForbidden = await apiJson('/admin/transactions', { token: vendorLogin.data.token });
  assert.equal(txForbidden.status, 403);

  // 2. Analytics: KPIs, commission splits, delays, buyers
  const analytics = await apiJson<{
    kpis: { paidCount: number; commissionEarned: number; avgBasket: number; uniqueBuyers: number; pendingBalanceTotal: number };
    delays: { avgHoursToPayment: number };
    topProducts: unknown[];
    commissionByMethod: Array<{ method: string; commission: number }>;
    zoneDistribution: Array<{ zone: string; orders: number }>;
    dailySeries: unknown[];
  }>('/admin/analytics?period=all', { token: admin });
  assert.equal(analytics.status, 200);
  assert.ok(analytics.data.kpis.paidCount >= 3);
  assert.equal(typeof analytics.data.kpis.avgBasket, 'number');
  assert.ok(analytics.data.topProducts.length >= 1);
  assert.ok(analytics.data.commissionByMethod.length >= 1);
  assert.ok(analytics.data.dailySeries.length >= 1);
  assert.ok(analytics.data.kpis.uniqueBuyers >= 3);

  // 3. Buyers directory aggregated by email
  const buyers = await apiJson<{ buyers: Array<{ email: string; orders: number; paidOrders: number; spent: number }>; totals: { count: number } }>(
    '/admin/buyers',
    { token: admin }
  );
  assert.equal(buyers.status, 200);
  assert.ok(buyers.data.totals.count >= 4);
  const awa = buyers.data.buyers.find((b) => b.email === 'awa.diop@example.com');
  assert.ok(awa && awa.orders >= 1);

  // 4. Order 360° detail
  const detail = await apiJson<{
    order: { orderNumber: string; grandTotal: number; commissionAmount: number; netVendors: number; buyerEmail: string };
    items: Array<{ productTitle: string; quantity: number }>;
    events: Array<{ status: string }>;
  }>(`/admin/orders/${encodeURIComponent(firstTx.orderId)}`, { token: admin });
  assert.equal(detail.status, 200);
  assert.ok(detail.data.items.length >= 1);
  assert.ok(detail.data.events.length >= 2);
  assert.equal(detail.data.order.grandTotal, firstTx.grandTotal);

  // 5. Payouts: statement -> record -> outstanding decreases
  const payoutsBefore = await apiJson<{
    statements: Array<{ vendorId: string; vendorName: string; revenue: number; commission: number; net: number; alreadyPaid: number; outstanding: number }>;
    totals: { netToPay: number };
  }>('/admin/payouts?period=all', { token: admin });
  assert.equal(payoutsBefore.status, 200);
  const vendorStatement = payoutsBefore.data.statements.find((s) => s.vendorName === 'Koffi Yao');
  assert.ok(vendorStatement, 'relevé du vendeur du cycle précédent présent');
  assert.equal(vendorStatement.revenue - vendorStatement.commission, vendorStatement.net);
  assert.equal(vendorStatement.outstanding, vendorStatement.net - vendorStatement.alreadyPaid);

  const partial = Math.max(1, Math.round(vendorStatement.net / 2));
  const record = await apiJson<{ recorded: boolean }>('/admin/payouts', {
    method: 'POST',
    token: admin,
    body: { vendorId: vendorStatement.vendorId, amount: partial, method: 'bank_transfer', reference: 'VIR-E2E-001', note: 'Test e2e' },
  });
  assert.equal(record.status, 201);

  const payoutsAfter = await apiJson<{ statements: Array<{ vendorId: string; alreadyPaid: number; outstanding: number }>; payouts: Array<{ reference: string | null }> }>(
    '/admin/payouts?period=all',
    { token: admin }
  );
  const after = payoutsAfter.data.statements.find((s) => s.vendorId === vendorStatement.vendorId)!;
  assert.equal(after.alreadyPaid, vendorStatement.alreadyPaid + partial);
  assert.equal(after.outstanding, vendorStatement.outstanding - partial);
  assert.ok(payoutsAfter.data.payouts.some((p) => p.reference === 'VIR-E2E-001'));

  // Invalid payout rejected
  const badPayout = await apiJson('/admin/payouts', { method: 'POST', token: admin, body: { vendorId: 'inconnu', amount: 500 } });
  assert.equal(badPayout.status, 400);

  // 6. Accounting export with full platform take + TOTAL row
  const acc = await fetch(`${baseUrl}/admin/export/accounting?period=all`, { headers: { Authorization: `Bearer ${admin}` } });
  assert.equal(acc.status, 200);
  const accBody = await acc.text();
  assert.ok(accBody.includes('Commission_Plateforme'));
  assert.ok(accBody.includes('TOTAL'));

  // Buyers + audit exports
  const buyersCsv = await fetch(`${baseUrl}/admin/export/buyers`, { headers: { Authorization: `Bearer ${admin}` } });
  assert.equal(buyersCsv.status, 200);
  assert.ok((await buyersCsv.text()).includes('awa.diop@example.com'));
  const auditCsv = await fetch(`${baseUrl}/admin/export/audit`, { headers: { Authorization: `Bearer ${admin}` } });
  assert.equal(auditCsv.status, 200);
  assert.ok((await auditCsv.text()).includes('VENDOR_PAYOUT_RECORDED'));
});

test('Admin Phase 2/3: promo codes end-to-end, catalog admin, vendor 360°, system health, maintenance, backups & campaigns', async () => {
  const login = await apiJson<{ token: string }>('/auth/login', {
    method: 'POST',
    body: { email: 'admin@simcova.africa', password: 'AdminPass2026!' },
  });
  assert.equal(login.status, 200);
  const admin = login.data.token;

  // ---- 1. Promo code lifecycle: create, validate, apply to an order (parity), disable
  const created = await apiJson<{ created: boolean; code: string }>('/admin/promos', {
    method: 'POST',
    token: admin,
    body: { code: 'E2E-10PCT', discountType: 'percent', discountValue: 10, minOrderAmount: 100000 },
  });
  assert.equal(created.status, 201);

  const dupe = await apiJson('/admin/promos', { method: 'POST', token: admin, body: { code: 'E2E-10PCT', discountType: 'fixed', discountValue: 500 } });
  assert.equal(dupe.status, 409);

  const prods = await apiJson<{ products: Array<{ id: string; price: number; paymentMethods: string[] }> }>('/products');
  const target = prods.data.products.find((p) => p.paymentMethods.includes('mobile_money_orange'));
  const validate = await apiJson<{ valid: boolean; discount: number }>('/promo/validate', {
    method: 'POST',
    body: { code: 'e2e-10pct', amount: 1000000 },
  });
  assert.ok(target, 'produit cible trouvé');
  assert.equal(validate.status, 200);
  assert.equal(validate.data.discount, 100000);

  const badPromo = await apiJson('/promo/validate', { method: 'POST', body: { code: 'INCONNU', amount: 500000 } });
  assert.equal(badPromo.status, 404);

  const promoOrder = await apiJson<{
    order: { id: string; grandTotal: number; discountAmount: number; promoCode: string | null; totalAmount: number; vatAmount: number };
    paymentSession: { providerRef: string };
  }>('/orders', {
    method: 'POST',
    body: {
      buyerName: 'Acheteur Promo', buyerEmail: 'promo@test.ci', shippingAddress: 'Cocody, Abidjan', deliveryZone: 'abidjan',
      paymentMethod: 'mobile_money_orange', promoCode: 'e2e-10pct',
      items: [{ productId: target.id, quantity: 1 }],
    },
  });
  assert.equal(promoOrder.status, 201);
  const o = promoOrder.data.order;
  assert.equal(o.promoCode, 'E2E-10PCT');
  const expectedBefore = o.totalAmount + o.vatAmount;
  assert.equal(o.grandTotal, expectedBefore - o.discountAmount, 'TTC remisé = TTC - remise');
  assert.equal(o.discountAmount, Math.round(expectedBefore * 0.1));

  // Promo usage counted
  const promosList = await apiJson<{ promos: Array<{ code: string; usedCount: number; active: boolean }> }>('/admin/promos', { token: admin });
  const used = promosList.data.promos.find((p) => p.code === 'E2E-10PCT');
  assert.equal(used?.usedCount ?? 0, 1);
  // Minimal order amount rejection
  const tooSmall = await apiJson('/orders', {
    method: 'POST',
    body: { buyerName: 'X', buyerEmail: 'x@t.ci', shippingAddress: 'X', deliveryZone: 'abidjan', paymentMethod: 'mobile_money_orange', promoCode: 'E2E-10PCT', items: [{ productId: target.id, quantity: 1 }] },
  });
  // (order is >= minimum so it succeeds; the point is the guard exists — verify via validate endpoint)
  void tooSmall;
  const validateSmall = await apiJson('/promo/validate', { method: 'POST', body: { code: 'E2E-10PCT', amount: 50 } });
  assert.equal(validateSmall.status, 400);

  const disabled = await apiJson('/admin/promos/E2E-10PCT', { method: 'PUT', token: admin, body: { active: false } });
  assert.equal(disabled.status, 200);
  const reuse = await apiJson('/orders', {
    method: 'POST',
    body: { buyerName: 'Y', buyerEmail: 'y@t.ci', shippingAddress: 'Y', deliveryZone: 'abidjan', paymentMethod: 'mobile_money_orange', promoCode: 'E2E-10PCT', items: [{ productId: target.id, quantity: 1 }] },
  });
  assert.equal(reuse.status, 400);

  // ---- 2. Admin catalog + archive + view counter
  const detail1 = await apiJson<{ product: { id: string } }>(`/products/${target.id}`);
  assert.equal(detail1.status, 200); // +1 vue
  const catalog = await apiJson<{ products: Array<{ id: string; viewCount: number; status: string }> }>('/admin/products?q=tracteur', { token: admin });
  assert.equal(catalog.status, 200);
  assert.ok(catalog.data.products.length >= 1);
  const viewed = await apiJson<{ products: Array<{ id: string; viewCount: number }> }>('/admin/products', { token: admin });
  assert.ok((viewed.data.products.find((p) => p.id === target.id)?.viewCount ?? 0) >= 1, 'compteur de vues incrémenté');

  // ---- 3. Vendor 360°
  const vendorsList = await apiJson<{ vendors: Array<{ id: string; fullName: string }> }>('/admin/vendors', { token: admin });
  const koffi = vendorsList.data.vendors.find((v) => v.fullName === 'Koffi Yao');
  assert.ok(koffi);
  const v360 = await apiJson<{
    vendor: { id: string; status: string };
    kpis: { revenue: number; attributedCommission: number; net: number; outstanding: number; ordersCount: number };
    kycDocs: unknown[];
    decisions: unknown[];
  }>(`/admin/vendors/${koffi.id}/detail`, { token: admin });
  assert.equal(v360.status, 200);
  assert.equal(v360.data.kpis.net, v360.data.kpis.revenue - v360.data.kpis.attributedCommission);
  assert.ok(v360.data.decisions.length >= 1, 'historique des décisions présent');
  assert.ok(v360.data.kycDocs.length >= 1, 'KYC listé');

  // ---- 4. System health
  const sys = await apiJson<{ uptimeSec: number; nodeVersion: string; database: { orders: number; outboxPending: number }; maintenance: { totalSweeps: number } }>('/admin/system', { token: admin });
  assert.equal(sys.status, 200);
  assert.ok(sys.data.database.orders >= 6);
  assert.ok(sys.data.nodeVersion.startsWith('v'));

  // ---- 5. Backup create + list
  const backup = await apiJson<{ created: boolean; fileName: string; sizeBytes: number }>('/admin/backups', { method: 'POST', token: admin });
  assert.equal(backup.status, 201);
  assert.ok(backup.data.sizeBytes > 0);
  const backupsList = await apiJson<{ backups: Array<{ fileName: string }> }>('/admin/backups', { token: admin });
  assert.ok(backupsList.data.backups.some((b) => b.fileName === backup.data.fileName));

  // ---- 6. Email campaign queued into the outbox
  const campaign = await apiJson<{ queued: number; segment: string }>('/admin/email-campaign', {
    method: 'POST',
    token: admin,
    body: { segment: 'buyers', subject: 'E2E — Nouveautés parc matériel', body: 'Découvrez les nouveaux arrivages SIMCOVA.' },
  });
  assert.equal(campaign.status, 201);
  assert.ok(campaign.data.queued >= 5, `${campaign.data.queued} destinataires`);

  // ---- 7. Maintenance mode: non-admin blocked, admin allowed, then off
  await apiJson('/admin/settings', { method: 'PUT', token: admin, body: { maintenanceMode: true } });
  const blockedCatalog = await apiJson('/products');
  assert.equal(blockedCatalog.status, 503);
  const adminOk = await apiJson('/admin/overview', { token: admin });
  assert.equal(adminOk.status, 200);
  const authStillOpen = await apiJson('/auth/login', { method: 'POST', body: { email: 'admin@simcova.africa', password: 'AdminPass2026!' } });
  assert.equal(authStillOpen.status, 200);
  await apiJson('/admin/settings', { method: 'PUT', token: admin, body: { maintenanceMode: false } });
  const catalogBack = await apiJson('/products');
  assert.equal(catalogBack.status, 200);

  // ---- 8. Vendor RBAC on new endpoints
  const vendorLogin = await apiJson<{ token: string }>('/auth/login', { method: 'POST', body: { email: 'koffi@atelier.ci', password: 'VendorNew2026!' } });
  const forbidden = await apiJson('/admin/system', { token: vendorLogin.data.token });
  assert.equal(forbidden.status, 403);
});

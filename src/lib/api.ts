import type {
  AuditLogItem,
  Category,
  CustomSpecs,
  KycDocumentMeta,
  MessageThreadItem,
  Order,
  OutboxEmail,
  PaymentMethodId,
  PaymentMode,
  PlatformRule,
  PlatformSettings,
  Product,
  PushAlertItem,
  ReviewItem,
  RuleId,
  Shop,
  UserAccount,
  VendorBankCoordinate,
  VendorStatus,
} from '../shared/types';
import type {
  AdminAnalyticsResponse,
  AdminBuyersResponse,
  AdminOrderDetail,
  AdminPayoutsResponse,
  AdminProductRow,
  AdminPromoRow,
  AdminSystemInfo,
  AdminBackup,
  AdminTransactionsResponse,
  AdminVendorDetail,
} from '../shared/adminTypes';

// Auth token kept in JS memory and mirrored into sessionStorage so a page refresh
// keeps the Pro session alive (cleared when the tab closes, never in localStorage).
const SESSION_STORAGE_KEY = 'simcova_session_token_v1';
let authToken: string | null = null;
try {
  authToken = sessionStorage.getItem(SESSION_STORAGE_KEY);
} catch {
  authToken = null;
}

export function setAuthToken(token: string | null): void {
  authToken = token;
  try {
    if (token) {
      sessionStorage.setItem(SESSION_STORAGE_KEY, token);
    } else {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch {
    // Storage unavailable (private mode) — memory-only session.
  }
}

export function getAuthToken(): string | null {
  return authToken;
}

/** Event fired when the server rejects an expired/invalid session (401). */
export const SESSION_EXPIRED_EVENT = 'simcova:session-expired';

const DEFAULT_TIMEOUT_MS = 30_000;

async function request<T>(url: string, options: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers as Record<string, string> | undefined),
  };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { ...options, headers, signal: options.signal ?? controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Délai d’attente dépassé : le serveur SIMCOVA n’a pas répondu.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text || 'Réponse serveur invalide.' };
  }
  if (res.status === 401 && authToken && typeof window !== 'undefined') {
    // Session expired server-side: drop it and let the UI fall back to the login panel.
    setAuthToken(null);
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
  }
  if (!res.ok) {
    throw new Error(String(data.error || `Erreur HTTP ${res.status}`));
  }
  return data as T;
}

export interface BootstrapResponse {
  categories: Category[];
  rules: Record<RuleId, PlatformRule>;
  settings: PlatformSettings;
  shops: Shop[];
  adminNeedsClaim: boolean;
}

export const api = {
  bootstrap: () => request<BootstrapResponse>('/api/bootstrap'),

  // Auth
  adminBootstrap: (password: string) =>
    request<{ token: string; user: UserAccount; shop: Shop }>('/api/auth/admin-bootstrap', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
  login: (email: string, password: string) =>
    request<{ token: string; user: UserAccount; shop: Shop }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  me: () => request<{ user: UserAccount; shop: Shop }>('/api/auth/me'),
  register: (payload: {
    fullName: string;
    email: string;
    password: string;
    shopName: string;
    phone?: string;
    city?: string;
    shopDescription?: string;
  }) =>
    request<{
      token: string;
      user: UserAccount;
      shop: Shop;
      verificationToken?: string;
      verificationUrl?: string;
    }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  verifyEmail: (token: string) =>
    request<{ verified: boolean; user: UserAccount }>('/api/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),
  resendVerification: () =>
    request<{ sent: boolean; verificationToken: string; verificationUrl: string }>('/api/auth/resend-verification', {
      method: 'POST',
    }),
  forgotPassword: (email: string) =>
    request<{ sent: boolean; demoResetToken?: string }>('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  resetPassword: (token: string, newPassword: string) =>
    request<{ reset: boolean }>('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, newPassword }),
    }),

  // Public catalog & shops
  getProducts: (params: Record<string, string | number | boolean | undefined> = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '' && v !== false) {
        qs.set(k, String(v));
      }
    }
    const qStr = qs.toString();
    return request<{ products: Product[] }>(`/api/products${qStr ? `?${qStr}` : ''}`);
  },
  getShops: (params: Record<string, string | number | boolean | undefined> = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '' && v !== false) {
        qs.set(k, String(v));
      }
    }
    const qStr = qs.toString();
    return request<{ shops: Shop[] }>(`/api/shops${qStr ? `?${qStr}` : ''}`);
  },
  getProduct: (id: string) =>
    request<{ product: Product; shop: Shop; reviews: ReviewItem[] }>(`/api/products/${encodeURIComponent(id)}`),
  getShop: (slug: string) =>
    request<{ shop: Shop; products: Product[]; reviews: ReviewItem[] }>(`/api/shops/${encodeURIComponent(slug)}`),

  // Guest orders & Jumia Africa / Deposit / Quote / Bank Transfer payment
  createOrder: (payload: {
    buyerName: string;
    buyerEmail: string;
    buyerPhone?: string;
    shippingAddress: string;
    deliveryZone: string;
    paymentMethod?: PaymentMethodId;
    paymentMode?: PaymentMode;
    bankTransferRef?: string;
    promoCode?: string;
    items: Array<{
      productId: string;
      variantId?: string | null;
      quantity: number;
      isCustom?: boolean;
      customSpecs?: CustomSpecs | null;
    }>;
  }) =>
    request<{
      order: Order;
      trackingToken: string;
      trackingUrl: string;
      quoteThreadToken?: string | null;
      quoteThreadUrl?: string | null;
      vendorBankDetails?: VendorBankCoordinate[];
      paymentSession: {
        provider: string;
        environment: string;
        providerRef: string;
        checkoutUrl: string;
        expiresAt: string;
      } | null;
    }>('/api/orders', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  completeSandboxPayment: (providerRef: string, outcome: 'paid' | 'failed' | 'cancelled') =>
    request<{ processed: boolean; outcome: string; orderNumber: string; trackingToken: string }>(
      '/api/payments/jumia/sandbox-complete',
      {
        method: 'POST',
        body: JSON.stringify({ providerRef, outcome }),
      }
    ),
  trackOrder: (token: string) =>
    request<{
      order: Order;
      items: Array<{
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
        shopId?: string;
        shopName: string;
        shopSlug: string;
        alreadyReviewed: boolean;
        media: Array<{ url: string; alt: string }>;
        customSpecs?: CustomSpecs | null;
      }>;
      events: Array<{ id: string; status: string; note: string; actor: string; createdAt: string }>;
      payment: { provider_ref: string; method: string; status: string; amount?: number } | null;
      canReviewProducts: boolean;
    }>(`/api/orders/track/${encodeURIComponent(token)}`),
  payQuoteOrder: (
    token: string,
    payload: { targetMode: 'full' | 'deposit' | 'bank_transfer'; paymentMethod?: PaymentMethodId; bankTransferRef?: string }
  ) =>
    request<{
      updated: boolean;
      paymentSession: {
        provider: string;
        environment: string;
        providerRef: string;
        checkoutUrl: string;
        expiresAt: string;
      } | null;
    }>(`/api/orders/track/${encodeURIComponent(token)}/pay-quote`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  regenerateTrackingLink: (token: string) =>
    request<{ newToken: string; trackingUrl: string }>(`/api/orders/track/${encodeURIComponent(token)}/regenerate`, {
      method: 'POST',
    }),
  recoverOrders: (email: string) =>
    request<{ sent: boolean; message: string }>('/api/orders/recover', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  // Guest messaging & reviews
  sendContactMessage: (payload: {
    productId?: string;
    shopId: string;
    buyerName: string;
    buyerEmail: string;
    body: string;
  }) =>
    request<{ sent: boolean; threadId: string; threadToken: string; threadUrl: string }>('/api/messages', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getGuestThread: (token: string) =>
    request<{ threadId: string; blocked: boolean; messages: MessageThreadItem[] }>(
      `/api/messages/thread/${encodeURIComponent(token)}`
    ),
  replyGuestThread: (token: string, body: string) =>
    request<{ sent: boolean }>(`/api/messages/thread/${encodeURIComponent(token)}/reply`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),
  submitReview: (payload: { trackingToken: string; productId: string; rating: number; comment: string }) =>
    request<{ id: string; created: boolean }>('/api/reviews', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Vendor workspace
  vendorDashboard: () =>
    request<{
      user: UserAccount;
      shop: Shop;
      kpis: {
        revenueTotal: number;
        commissionTotal: number;
        netRevenue: number;
        pendingOrdersCount: number;
        publishedProductsCount: number;
        totalProductsCount: number;
        avgRating: number;
        reviewCount: number;
      };
      products: Product[];
      orderItems: Array<Record<string, unknown>>;
      kycDocs: KycDocumentMeta[];
      reviews: ReviewItem[];
      messages: MessageThreadItem[];
    }>('/api/vendor/dashboard'),
  suggestKeywords: (title: string, description: string, categoryName: string) =>
    request<{ keywords: string[]; source: string }>('/api/vendor/keywords/suggest', {
      method: 'POST',
      body: JSON.stringify({ title, description, categoryName }),
    }),
  uploadMedia: (dataUrl: string, fileName: string) =>
    request<{ url: string; mime: string }>('/api/uploads', {
      method: 'POST',
      body: JSON.stringify({ dataUrl, fileName }),
    }),
  createProduct: (payload: Partial<Product>) =>
    request<{ product: Product }>('/api/vendor/products', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateProduct: (id: string, payload: Partial<Product>) =>
    request<{ product: Product }>(`/api/vendor/products/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  duplicateProduct: (id: string) =>
    request<{ product: Product }>(`/api/vendor/products/${encodeURIComponent(id)}/duplicate`, {
      method: 'POST',
    }),
  deleteProduct: (id: string) =>
    request<{ deleted?: boolean; archived?: boolean }>(`/api/vendor/products/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  updateShop: (payload: Record<string, unknown>) =>
    request<{ shop: Shop }>('/api/vendor/shop', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  uploadKyc: (payload: { docType: string; fileName: string; contentBase64: string; mimeType: string }) =>
    request<{ id: string; uploadedAt: string }>('/api/vendor/kyc', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateOrderStatus: (orderId: string, payload: { status: string; carrier?: string; trackingNumber?: string; note?: string }) =>
    request<{ updated: boolean }>(`/api/vendor/orders/${encodeURIComponent(orderId)}/status`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  vendorConfirmBankTransfer: (orderId: string, bankReference?: string) =>
    request<{ confirmed: boolean; paidAmount: number }>(`/api/vendor/orders/${encodeURIComponent(orderId)}/confirm-bank-transfer`, {
      method: 'POST',
      body: JSON.stringify({ bankReference }),
    }),
  vendorConfirmBalance: (orderId: string) =>
    request<{ settled: boolean; paidAmount: number; balanceDue: number }>(
      `/api/vendor/orders/${encodeURIComponent(orderId)}/confirm-balance`,
      {
        method: 'POST',
      }
    ),
  vendorProposeQuote: (orderId: string, proposedTotal: number, note?: string) =>
    request<{ proposed: boolean; totalAmount: number }>(`/api/vendor/orders/${encodeURIComponent(orderId)}/quote-offer`, {
      method: 'POST',
      body: JSON.stringify({ proposedTotal, note }),
    }),
  vendorRefundOrder: (orderId: string, reason: string) =>
    request<{ refunded: boolean }>(`/api/vendor/orders/${encodeURIComponent(orderId)}/refund`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  vendorReplyMessage: (threadId: string, body: string) =>
    request<{ sent: boolean; threadUrl: string }>(`/api/vendor/messages/${encodeURIComponent(threadId)}/reply`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),
  vendorReportThread: (threadId: string) =>
    request<{ reported: boolean }>(`/api/vendor/messages/${encodeURIComponent(threadId)}/report`, {
      method: 'POST',
    }),
  vendorReplyReview: (reviewId: string, reply: string) =>
    request<{ replied: boolean }>(`/api/vendor/reviews/${encodeURIComponent(reviewId)}/reply`, {
      method: 'POST',
      body: JSON.stringify({ reply }),
    }),
  vendorReportReview: (reviewId: string) =>
    request<{ reported: boolean }>(`/api/vendor/reviews/${encodeURIComponent(reviewId)}/report`, {
      method: 'POST',
    }),

  // Admin Console
  adminOverview: (period: '7d' | '30d' | '90d' | 'all' = 'all') =>
    request<{
      period: string;
      kpis: {
        totalSales: number;
        vatCollected: number;
        commissionEarned: number;
        totalOrders: number;
        statusCounts: Record<string, number>;
        publishedProducts: number;
        activeVendors: number;
        pendingVendors: number;
        pendingModeration: number;
        evolution: Array<{ label: string; sales: number; orders: number }>;
      };
    }>(`/api/admin/overview?period=${encodeURIComponent(period)}`),
  adminVendors: () =>
    request<{
      vendors: Array<
        UserAccount & {
          shopId: string | null;
          shopName: string | null;
          shopSlug: string | null;
          shopCity: string | null;
          publishedCount: number;
          kycDocs: KycDocumentMeta[];
        }
      >;
    }>('/api/admin/vendors'),
  adminViewKyc: (docId: string) =>
    request<{
      id: string;
      docType: string;
      fileName: string;
      mimeType: string;
      textPreview: string | null;
      dataUrl: string | null;
    }>(`/api/admin/kyc/${encodeURIComponent(docId)}/view`),
  adminPurgeKyc: (docId: string) =>
    request<{ purged: boolean }>(`/api/admin/kyc/${encodeURIComponent(docId)}/purge`, { method: 'POST' }),
  adminVendorDecision: (vendorId: string, status: VendorStatus, reason?: string, badges?: string[]) =>
    request<{ updated: boolean }>(`/api/admin/vendors/${encodeURIComponent(vendorId)}/decision`, {
      method: 'POST',
      body: JSON.stringify({ status, reason, badges }),
    }),
  adminUpdateRule: (ruleId: RuleId, enabled: boolean, valueJson?: Record<string, unknown>) =>
    request<{ rules: PlatformRule[] }>(`/api/admin/rules/${encodeURIComponent(ruleId)}`, {
      method: 'PUT',
      body: JSON.stringify({ enabled, valueJson }),
    }),
  adminCreateCategory: (name: string, requiredBadge?: string | null) =>
    request<{ id: string }>('/api/admin/categories', {
      method: 'POST',
      body: JSON.stringify({ name, requiredBadge }),
    }),
  adminUpdateCategory: (id: string, payload: { name?: string; active?: boolean; forbidden?: boolean; requiredBadge?: string | null }) =>
    request<{ updated: boolean }>(`/api/admin/categories/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  adminModeration: () =>
    request<{
      reviews: ReviewItem[];
      threads: Array<{
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
      }>;
    }>('/api/admin/moderation'),
  adminModerateReview: (id: string, status: 'visible' | 'retire') =>
    request<{ updated: boolean }>(`/api/admin/moderation/reviews/${encodeURIComponent(id)}`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    }),
  adminBlockThread: (threadId: string, block: boolean, reason?: string) =>
    request<{ updated: boolean }>(`/api/admin/moderation/threads/${encodeURIComponent(threadId)}/block`, {
      method: 'POST',
      body: JSON.stringify({ block, reason }),
    }),
  adminGetPushAlerts: () =>
    request<{ alerts: PushAlertItem[]; subscriberCount: number; liveConnections: number }>('/api/admin/push-alerts'),
  adminSendPushAlert: (payload: {
    title: string;
    body: string;
    deepLink: string;
    alertType: 'nouveautes' | 'promotions' | 'annonces';
  }) =>
    request<{ alert: PushAlertItem }>('/api/admin/push-alerts', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  adminOrders: () => request<{ orders: Array<Record<string, unknown>> }>('/api/admin/orders'),
  adminRefundOrder: (orderId: string, reason: string) =>
    request<{ refunded: boolean }>(`/api/admin/orders/${encodeURIComponent(orderId)}/refund`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  adminUpdateSettings: (payload: Partial<PlatformSettings>) =>
    request<{ settings: PlatformSettings }>('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  adminAuditLogs: () =>
    request<{
      logs: AuditLogItem[];
      emails: Array<OutboxEmail & { sentAt: string | null; attempts: number; lastError: string | null }>;
    }>('/api/admin/audit-logs'),

  // Admin finance, analytics & directory (SPEC-ADMIN Phase 1)
  adminTransactions: (params: { period?: string; from?: string; to?: string; status?: string; method?: string; vendorId?: string; q?: string; minAmount?: number; maxAmount?: number } = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '' && v !== null) qs.set(k, String(v));
    }
    const qStr = qs.toString();
    return request<AdminTransactionsResponse>(`/api/admin/transactions${qStr ? `?${qStr}` : ''}`);
  },
  adminPayouts: (period: '7d' | '30d' | '90d' | 'all' = 'all') =>
    request<AdminPayoutsResponse>(`/api/admin/payouts?period=${encodeURIComponent(period)}`),
  adminRecordPayout: (payload: { vendorId: string; amount: number; method?: string; reference?: string; note?: string; periodStart?: string; periodEnd?: string }) =>
    request<{ recorded: boolean; id: string }>('/api/admin/payouts', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  adminAnalytics: (period: '7d' | '30d' | '90d' | 'all' = 'all') =>
    request<AdminAnalyticsResponse>(`/api/admin/analytics?period=${encodeURIComponent(period)}`),
  adminBuyers: (params: { q?: string; minOrders?: number } = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '' && v !== null) qs.set(k, String(v));
    }
    const qStr = qs.toString();
    return request<AdminBuyersResponse>(`/api/admin/buyers${qStr ? `?${qStr}` : ''}`);
  },
  adminOrderDetail: (orderId: string) =>
    request<AdminOrderDetail>(`/api/admin/orders/${encodeURIComponent(orderId)}`),

  // Admin catalog, vendor 360°, promos, system & campaigns (SPEC-ADMIN Phase 2/3)
  adminProducts: (params: { status?: string; vendorId?: string; q?: string } = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') qs.set(k, String(v));
    }
    const qStr = qs.toString();
    return request<{ products: AdminProductRow[]; totals: { count: number; published: number } }>(
      `/api/admin/products${qStr ? `?${qStr}` : ''}`
    );
  },
  adminArchiveProduct: (id: string) =>
    request<{ archived: boolean }>(`/api/admin/products/${encodeURIComponent(id)}/archive`, { method: 'POST' }),
  adminVendorDetail: (vendorId: string) =>
    request<AdminVendorDetail>(`/api/admin/vendors/${encodeURIComponent(vendorId)}/detail`),
  adminPromos: () => request<{ promos: AdminPromoRow[] }>('/api/admin/promos'),
  adminCreatePromo: (payload: { code: string; discountType: 'percent' | 'fixed'; discountValue: number; minOrderAmount?: number; maxUses?: number | null; expiresAt?: string | null }) =>
    request<{ created: boolean; code: string }>('/api/admin/promos', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  adminTogglePromo: (code: string, active: boolean) =>
    request<{ updated: boolean }>(`/api/admin/promos/${encodeURIComponent(code)}`, {
      method: 'PUT',
      body: JSON.stringify({ active }),
    }),
  adminDeletePromo: (code: string) =>
    request<{ deleted: boolean }>(`/api/admin/promos/${encodeURIComponent(code)}`, { method: 'DELETE' }),
  validatePromo: (code: string, amount: number) =>
    request<{ valid: boolean; code: string; discountType: 'percent' | 'fixed'; discountValue: number; discount: number }>(
      '/api/promo/validate',
      { method: 'POST', body: JSON.stringify({ code, amount }) }
    ),
  adminSystem: () => request<AdminSystemInfo>('/api/admin/system'),
  adminCreateBackup: () => request<{ created: boolean; fileName: string; sizeBytes: number }>('/api/admin/backups', { method: 'POST' }),
  adminBackups: () => request<{ backups: AdminBackup[] }>('/api/admin/backups'),
  adminEmailCampaign: (payload: { segment: 'buyers' | 'vendors' | 'all'; subject: string; body: string }) =>
    request<{ queued: number; segment: string }>('/api/admin/email-campaign', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Push preferences
  subscribePush: (endpoint: string, preferences: { nouveautes: boolean; promotions: boolean; annonces: boolean }) =>
    request<{ subscribed: boolean; endpoint: string }>('/api/push/subscribe', {
      method: 'POST',
      body: JSON.stringify({ endpoint, preferences }),
    }),
  updatePushPreferences: (endpoint: string, preferences: { nouveautes: boolean; promotions: boolean; annonces: boolean }) =>
    request<{ updated: boolean }>('/api/push/preferences', {
      method: 'PUT',
      body: JSON.stringify({ endpoint, preferences }),
    }),
  unsubscribePush: (endpoint: string) =>
    request<{ unsubscribed: boolean }>('/api/push/unsubscribe', {
      method: 'DELETE',
      body: JSON.stringify({ endpoint }),
    }),
};

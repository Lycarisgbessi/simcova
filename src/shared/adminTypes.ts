// Types des charges utiles admin (SPEC-ADMIN.md) — partagés entre api.ts et les vues console.
// (AdminTransactionRow et AdminOrderDetail, enrichis remise promo, sont définis en fin de fichier.)

export interface AdminTransactionsResponse {
  transactions: AdminTransactionRow[];
  totals: {
    count: number;
    paidCount: number;
    grandTotalPaid: number;
    vatPaid: number;
    commissionPaid: number;
    netVendorsPaid: number;
    refundedCount: number;
  };
}

export interface AdminPayoutStatement {
  vendorId: string;
  vendorName: string;
  shopName: string;
  ordersCount: number;
  revenue: number;
  commission: number;
  net: number;
  revenuePeriod: number;
  commissionPeriod: number;
  netPeriod: number;
  ordersPeriodCount: number;
  alreadyPaid: number;
  outstanding: number;
}

export interface AdminPayoutRecord {
  id: string;
  vendor_id: string;
  vendor_name: string;
  shop_name: string | null;
  amount: number;
  method: string;
  reference: string | null;
  note: string | null;
  created_by: string;
  created_at: string;
}

export interface AdminPayoutsResponse {
  statements: AdminPayoutStatement[];
  payouts: AdminPayoutRecord[];
  totals: { netToPay: number; totalCommission: number; totalRevenue: number; totalPaidOut: number };
}

export interface AdminAnalyticsResponse {
  period: string;
  kpis: {
    ordersCount: number;
    paidCount: number;
    totalGrandPaid: number;
    totalHTPaid: number;
    vatCollected: number;
    commissionEarned: number;
    avgBasket: number;
    pendingBalanceTotal: number;
    refundedCount: number;
    expiredCount: number;
    refundRatePct: number;
    expirationRatePct: number;
    uniqueBuyers: number;
    repeatBuyers: number;
    repeatRatePct: number;
  };
  delays: { avgHoursToPayment: number; avgHoursToShipment: number; avgHoursToDelivery: number };
  topProducts: Array<{ id: string; title: string; shopName: string; revenue: number; qty: number }>;
  topVendors: Array<{ vendorId: string; name: string; shopName: string; revenue: number; commission: number }>;
  topCategories: Array<{ name: string; revenue: number; qty: number }>;
  commissionByMethod: Array<{ method: string; commission: number; grand: number; orders: number }>;
  zoneDistribution: Array<{ zone: string; orders: number; grand: number }>;
  ratingDistribution: Array<{ rating: number; count: number }>;
  dailySeries: Array<{ date: string; orders: number; grand: number; commission: number }>;
}

export interface AdminBuyerRow {
  email: string;
  name: string;
  zone: string;
  orders: number;
  paidOrders: number;
  spent: number;
  avgBasket: number;
  firstAt: string;
  lastAt: string;
  refunded: number;
  customOrders: number;
}

export interface AdminBuyersResponse {
  buyers: AdminBuyerRow[];
  totals: { count: number; totalSpent: number; repeatBuyers: number };
}

export interface AdminOrderDetail {
  order: {
    id: string;
    orderNumber: string;
    buyerName: string;
    buyerEmail: string;
    buyerPhone: string | null;
    shippingAddress: string;
    deliveryZone: string;
    createdAt: string;
    expiresAt: string | null;
    paymentStatus: string;
    paymentMode: string;
    paymentMethod: string;
    depositPercent: number;
    paidAmount: number;
    balanceDue: number;
    bankTransferRef: string | null;
    providerRef: string | null;
    quoteThreadId: string | null;
    subtotal: number;
    deliveryTotal: number;
    totalHT: number;
    vatAmount: number;
    grandTotal: number;
    commissionAmount: number;
    netVendors: number;
    discountAmount?: number;
    promoCode?: string | null;
  };
  items: Array<{
    id: string;
    productId: string;
    productTitle: string;
    variantLabel: string | null;
    categoryName: string | null;
    vendorId: string;
    vendorName: string;
    shopName: string | null;
    quantity: number;
    unitPrice: number;
    deliveryFee: number;
    carrier: string | null;
    trackingNumber: string | null;
    itemStatus: string;
    customSpecs: { dimensions?: string; technicalSpecs?: string; notes?: string } | null;
  }>;
  events: Array<{ id: string; status: string; note: string; actor: string; createdAt: string }>;
}

export interface AdminTransactionRow {
  orderId: string;
  orderNumber: string;
  createdAt: string;
  buyerName: string;
  buyerEmail: string;
  vendorNames: string[];
  vendorIds: string[];
  subtotal: number;
  deliveryTotal: number;
  vatAmount: number;
  totalHT: number;
  discountAmount: number;
  promoCode: string | null;
  grandTotal: number;
  commission: number;
  netVendors: number;
  paymentMethod: string;
  paymentMethodRaw: string;
  paymentMode: string;
  paymentStatus: string;
  providerRef: string | null;
  txStatus: string | null;
  paidAmount: number;
  balanceDue: number;
}

export interface AdminProductRow {
  id: string;
  title: string;
  status: string;
  price: number;
  stock: number;
  condition: string;
  vendorId: string;
  vendorName: string;
  shopName: string;
  categoryName: string;
  ratingAverage: number;
  reviewCount: number;
  viewCount: number;
  updatedAt: string;
}

export interface AdminVendorDetail {
  vendor: { id: string; email: string; fullName: string; status: string; emailVerified: boolean; badges: string[]; createdAt: string; customFields: Record<string, string> };
  shop: { id: string; name: string; slug: string; city: string | null; hasBankDetails?: boolean; ratingAverage: number; salesCount?: number } | null;
  kpis: {
    revenue: number;
    attributedCommission: number;
    net: number;
    paidOut: number;
    outstanding: number;
    ordersCount: number;
    refundedOrders: number;
    refundRatePct: number;
    avgRating: number;
    reviewCount: number;
    publishedProducts: number;
  };
  kycDocs: Array<{ id: string; docType: string; fileName: string; reviewStatus: string; uploadedAt: string; purgeScheduledAt: string | null }>;
  decisions: Array<{ action: string; details: string; actorEmail: string; createdAt: string }>;
}

export interface AdminPromoRow {
  code: string;
  discountType: 'percent' | 'fixed';
  discountValue: number;
  minOrderAmount: number;
  maxUses: number | null;
  usedCount: number;
  active: boolean;
  expiresAt: string | null;
  createdBy: string;
  createdAt: string;
}

export interface AdminSystemInfo {
  uptimeSec: number;
  nodeVersion: string;
  memoryMb: number;
  database: {
    path: string;
    sizeBytes: number;
    walBytes: number;
    users: number;
    vendors: number;
    products: number;
    orders: number;
    reviews: number;
    messages: number;
    payouts: number;
    outboxPending: number;
    outboxFailed: number;
  };
  uploads: { count: number; sizeBytes: number };
  sseClients: number;
  maintenance: {
    lastSweepAt: string | null;
    lastSweepExpiredOrders: number;
    lastSweepPurgedKyc: number;
    lastEmailFlushAt: string | null;
    lastEmailFlushSent: number;
    lastEmailFlushFailed: number;
    totalSweeps: number;
  };
}

export interface AdminBackup {
  fileName: string;
  sizeBytes: number;
  createdAt: string;
}

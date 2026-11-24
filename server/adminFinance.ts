import crypto from 'node:crypto';
import { db, writeAuditLog } from './db.ts';

/**
 * Admin finance & analytics engine (SPEC-ADMIN.md Phase 1).
 * All figures derive from orders/order_items/payments already stored — no extra tracking needed.
 * Grand totals are VAT-inclusive (grand = total_amount + vat_amount); commissions apply to product subtotal.
 */

export interface PeriodFilter {
  period: '7d' | '30d' | '90d' | 'all';
  from?: string;
  to?: string;
}

function periodCutoff(period: PeriodFilter['period']): number {
  const days: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };
  return days[period] ? Date.now() - days[period] * 86_400_000 : 0;
}

interface OrderRow {
  id: string;
  order_number: string;
  created_at: string;
  buyer_name: string;
  buyer_email: string;
  delivery_zone: string;
  subtotal: number;
  delivery_total: number;
  total_amount: number;
  vat_amount: number;
  commission_amount: number;
  discount_amount: number;
  promo_code: string | null;
  payment_method: string;
  payment_mode: string;
  payment_status: string;
  paid_amount: number;
  balance_due: number;
  provider_ref: string | null;
  tx_status: string | null;
}

function loadOrders(f: PeriodFilter): OrderRow[] {
  const rows = db
    .prepare(
      `SELECT o.*, p.provider_ref, p.status AS tx_status
       FROM orders o LEFT JOIN payments p ON p.order_id = o.id
       ORDER BY o.created_at DESC`
    )
    .all() as unknown as OrderRow[];
  const cut = periodCutoff(f.period);
  const from = f.from ? Date.parse(f.from) : 0;
  const to = f.to ? Date.parse(f.to) + 86_400_000 : Number.MAX_SAFE_INTEGER;
  return rows.filter((o) => {
    const t = Date.parse(o.created_at);
    return t >= Math.max(cut, from) && t <= to;
  });
}

interface VendorLine {
  vendorId: string;
  vendorName: string;
  shopName: string;
  orderId: string;
  orderSubtotalShare: number; // this vendor's products subtotal within the order
  revenue: number; // products + delivery lines
  createdAt: string;
  paymentStatus: string;
}

function loadVendorLines(f: PeriodFilter): VendorLine[] {
  const cut = periodCutoff(f.period);
  const rows = db
    .prepare(
      `SELECT oi.vendor_id, oi.order_id, oi.unit_price * oi.quantity AS line_subtotal, oi.delivery_fee,
              u.full_name AS vendor_name, s.name AS shop_name, o.created_at, o.payment_status
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN users u ON u.id = oi.vendor_id
       LEFT JOIN shops s ON s.vendor_id = oi.vendor_id
       WHERE o.created_at >= ?
       ORDER BY o.created_at DESC`
    )
    .all(new Date(cut).toISOString()) as unknown as Array<{
    vendor_id: string;
    order_id: string;
    line_subtotal: number;
    delivery_fee: number;
    vendor_name: string;
    shop_name: string | null;
    created_at: string;
    payment_status: string;
  }>;
  return rows.map((r) => ({
    vendorId: r.vendor_id,
    vendorName: r.vendor_name,
    shopName: r.shop_name || '',
    orderId: r.order_id,
    orderSubtotalShare: Number(r.line_subtotal),
    revenue: Number(r.line_subtotal) + Number(r.delivery_fee),
    createdAt: r.created_at,
    paymentStatus: r.payment_status,
  }));
}

/** Attributed commission for a vendor line: order commission × vendor's share of the order subtotal. */
function attributedCommission(order: OrderRow | undefined, vendorSubtotal: number): number {
  if (!order || order.subtotal <= 0 || order.commission_amount <= 0) return 0;
  return Math.round((order.commission_amount * vendorSubtotal) / order.subtotal);
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  jumia_card: 'Carte (JumiaPay)',
  mobile_money_orange: 'Orange Money',
  mobile_money_mtn: 'MTN MoMo',
  mobile_money_wave: 'Wave',
  jumia_wallet: 'JumiaPay Wallet',
  bank_transfer: 'Virement',
  quote: 'Devis',
};

// ============================================================
// TRANSACTIONS — exhaustive, filterable, with platform take
// ============================================================
export function getAdminTransactions(
  f: PeriodFilter & {
    status?: string;
    method?: string;
    vendorId?: string;
    q?: string;
    minAmount?: number;
    maxAmount?: number;
  }
) {
  const ordersById = new Map(loadOrders({ period: 'all' }).map((o) => [o.id, o]));
  const vendorLinesAll = loadVendorLines({ period: 'all' });
  const linesByOrder = new Map<string, VendorLine[]>();
  for (const l of vendorLinesAll) {
    const arr = linesByOrder.get(l.orderId) ?? [];
    arr.push(l);
    linesByOrder.set(l.orderId, arr);
  }

  const filtered = loadOrders(f).filter((o) => {
    if (f.status && o.payment_status !== f.status) return false;
    if (f.method && o.payment_method !== f.method) return false;
    if (f.vendorId && !(linesByOrder.get(o.id) ?? []).some((l) => l.vendorId === f.vendorId)) return false;
    if (f.q) {
      const needle = f.q.toLowerCase();
      const vendors = (linesByOrder.get(o.id) ?? []).map((l) => `${l.vendorName} ${l.shopName}`).join(' ');
      const hay = `${o.order_number} ${o.buyer_name} ${o.buyer_email} ${vendors}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    const grand = Number(o.total_amount) + Number(o.vat_amount) - Number(o.discount_amount ?? 0);
    if (f.minAmount !== undefined && grand < f.minAmount) return false;
    if (f.maxAmount !== undefined && grand > f.maxAmount) return false;
    return true;
  });

  const transactions = filtered.map((o) => {
    const lines = linesByOrder.get(o.id) ?? [];
    const grand = Number(o.total_amount) + Number(o.vat_amount) - Number(o.discount_amount ?? 0);
    const commission = Number(o.commission_amount);
    return {
      orderId: o.id,
      orderNumber: o.order_number,
      createdAt: o.created_at,
      buyerName: o.buyer_name,
      buyerEmail: o.buyer_email,
      vendorNames: [...new Set(lines.map((l) => l.shopName || l.vendorName))],
      vendorIds: [...new Set(lines.map((l) => l.vendorId))],
      subtotal: Number(o.subtotal),
      deliveryTotal: Number(o.delivery_total),
      vatAmount: Number(o.vat_amount),
      totalHT: Number(o.total_amount),
      discountAmount: Number(o.discount_amount ?? 0),
      promoCode: o.promo_code ? String(o.promo_code) : null,
      grandTotal: grand,
      commission,
      netVendors: Number(o.total_amount) - commission,
      paymentMethod: PAYMENT_METHOD_LABELS[o.payment_method] || o.payment_method,
      paymentMethodRaw: o.payment_method,
      paymentMode: o.payment_mode,
      paymentStatus: o.payment_status,
      providerRef: o.provider_ref,
      txStatus: o.tx_status,
      paidAmount: Number(o.paid_amount),
      balanceDue: Number(o.balance_due),
    };
  });

  const paid = transactions.filter((t) => t.paymentStatus === 'paid');
  const totals = {
    count: transactions.length,
    paidCount: paid.length,
    grandTotalPaid: paid.reduce((s, t) => s + t.grandTotal, 0),
    vatPaid: paid.reduce((s, t) => s + t.vatAmount, 0),
    commissionPaid: paid.reduce((s, t) => s + t.commission, 0),
    netVendorsPaid: paid.reduce((s, t) => s + t.netVendors, 0),
    refundedCount: transactions.filter((t) => t.paymentStatus === 'refunded').length,
  };
  return { transactions, totals };
}

// ============================================================
// PAYOUTS — per-vendor statements & recorded payouts
// ============================================================
export function getAdminPayouts(f: PeriodFilter) {
  const ordersById = new Map(loadOrders({ period: 'all' }).map((o) => [o.id, o]));
  const allLines = loadVendorLines({ period: 'all' }).filter((l) => l.paymentStatus === 'paid');
  const periodCut = periodCutoff(f.period);

  interface Acc {
    vendorName: string;
    shopName: string;
    revenue: number;
    commission: number;
    orders: Set<string>;
    revenuePeriod: number;
    commissionPeriod: number;
    ordersPeriod: Set<string>;
  }
  const acc = new Map<string, Acc>();
  for (const l of allLines) {
    const a =
      acc.get(l.vendorId) ??
      ({
        vendorName: l.vendorName,
        shopName: l.shopName,
        revenue: 0,
        commission: 0,
        orders: new Set<string>(),
        revenuePeriod: 0,
        commissionPeriod: 0,
        ordersPeriod: new Set<string>(),
      } as Acc);
    const commission = attributedCommission(ordersById.get(l.orderId), l.orderSubtotalShare);
    a.revenue += l.revenue;
    a.commission += commission;
    a.orders.add(l.orderId);
    if (Date.parse(l.createdAt) >= periodCut) {
      a.revenuePeriod += l.revenue;
      a.commissionPeriod += commission;
      a.ordersPeriod.add(l.orderId);
    }
    acc.set(l.vendorId, a);
  }

  const payouts = db
    .prepare(
      `SELECT vp.*, u.full_name AS vendor_name, s.name AS shop_name
       FROM vendor_payouts vp
       JOIN users u ON u.id = vp.vendor_id
       LEFT JOIN shops s ON s.vendor_id = vp.vendor_id
       ORDER BY vp.created_at DESC LIMIT 100`
    )
    .all() as unknown as Array<{
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
  }>;
  const paidOutByVendor = new Map<string, number>();
  for (const p of payouts) {
    paidOutByVendor.set(p.vendor_id, (paidOutByVendor.get(p.vendor_id) ?? 0) + Number(p.amount));
  }

  const statements = [...acc.entries()].map(([vendorId, a]) => {
    const netAll = a.revenue - a.commission;
    const alreadyPaid = paidOutByVendor.get(vendorId) ?? 0;
    return {
      vendorId,
      vendorName: a.vendorName,
      shopName: a.shopName,
      ordersCount: a.orders.size,
      revenue: a.revenue,
      commission: a.commission,
      net: netAll,
      revenuePeriod: a.revenuePeriod,
      commissionPeriod: a.commissionPeriod,
      netPeriod: a.revenuePeriod - a.commissionPeriod,
      ordersPeriodCount: a.ordersPeriod.size,
      alreadyPaid,
      outstanding: netAll - alreadyPaid,
    };
  });
  statements.sort((a, b) => b.outstanding - a.outstanding);

  const totals = {
    netToPay: statements.reduce((s, x) => s + Math.max(0, x.outstanding), 0),
    totalCommission: statements.reduce((s, x) => s + x.commission, 0),
    totalRevenue: statements.reduce((s, x) => s + x.revenue, 0),
    totalPaidOut: statements.reduce((s, x) => s + x.alreadyPaid, 0),
  };
  return { statements, payouts, totals };
}

export function recordVendorPayout(params: {
  vendorId: string;
  amount: number;
  method?: string;
  reference?: string | null;
  note?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  actorId: string;
  actorEmail: string;
}): { ok: boolean; error?: string; id?: string } {
  const vendor = db.prepare("SELECT id, full_name FROM users WHERE id = ? AND role = 'vendor'").get(params.vendorId) as
    | { id: string; full_name: string }
    | undefined;
  if (!vendor) return { ok: false, error: 'Vendeur introuvable.' };
  const amount = Math.round(Number(params.amount));
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'Montant de reversement invalide.' };

  const id = `pay-${crypto.randomUUID().slice(0, 12)}`;
  db.prepare(
    `INSERT INTO vendor_payouts (id, vendor_id, amount, method, reference, note, period_start, period_end, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    params.vendorId,
    amount,
    params.method || 'bank_transfer',
    params.reference?.trim() || null,
    params.note?.trim() || null,
    params.periodStart || null,
    params.periodEnd || null,
    params.actorEmail,
    new Date().toISOString()
  );
  writeAuditLog({
    actorId: params.actorId,
    actorEmail: params.actorEmail,
    action: 'VENDOR_PAYOUT_RECORDED',
    targetType: 'vendor_payout',
    targetId: id,
    details: `Reversement de ${amount} FCFA à ${vendor.full_name}${params.reference ? ` (réf. ${params.reference.trim()})` : ''}`,
  });
  return { ok: true, id };
}

// ============================================================
// ANALYTICS — KPIs, tops, commission splits, delays
// ============================================================
export function getAdminAnalytics(f: PeriodFilter) {
  const orders = loadOrders(f);
  const paid = orders.filter((o) => o.payment_status === 'paid');
  const grandOf = (o: OrderRow) => Number(o.total_amount) + Number(o.vat_amount) - Number(o.discount_amount ?? 0);

  const kpis = {
    ordersCount: orders.length,
    paidCount: paid.length,
    totalGrandPaid: paid.reduce((s, o) => s + grandOf(o), 0),
    totalHTPaid: paid.reduce((s, o) => s + Number(o.total_amount), 0),
    vatCollected: paid.reduce((s, o) => s + Number(o.vat_amount), 0),
    commissionEarned: paid.reduce((s, o) => s + Number(o.commission_amount), 0),
    avgBasket: paid.length ? Math.round(paid.reduce((s, o) => s + grandOf(o), 0) / paid.length) : 0,
    pendingBalanceTotal: paid.reduce((s, o) => s + Math.max(0, Number(o.balance_due)), 0),
    refundedCount: orders.filter((o) => o.payment_status === 'refunded').length,
    expiredCount: orders.filter((o) => o.payment_status === 'expired').length,
    refundRatePct: orders.length ? Math.round((orders.filter((o) => o.payment_status === 'refunded').length / orders.length) * 1000) / 10 : 0,
    expirationRatePct: orders.length ? Math.round((orders.filter((o) => o.payment_status === 'expired').length / orders.length) * 1000) / 10 : 0,
    uniqueBuyers: new Set(paid.map((o) => o.buyer_email.toLowerCase())).size,
  };
  const buyerOrderCount = new Map<string, number>();
  for (const o of paid) {
    const k = o.buyer_email.toLowerCase();
    buyerOrderCount.set(k, (buyerOrderCount.get(k) ?? 0) + 1);
  }
  const repeat = [...buyerOrderCount.values()].filter((n) => n >= 2).length;
  kpis.uniqueBuyers = buyerOrderCount.size;
  (kpis as Record<string, unknown>).repeatBuyers = repeat;
  (kpis as Record<string, unknown>).repeatRatePct = buyerOrderCount.size
    ? Math.round((repeat / buyerOrderCount.size) * 1000) / 10
    : 0;

  // Delays (hours) from order events
  const delays = { avgHoursToPayment: 0, avgHoursToShipment: 0, avgHoursToDelivery: 0 };
  {
    let sPay = 0, nPay = 0, sShip = 0, nShip = 0, sDeliv = 0, nDeliv = 0;
    for (const o of paid.slice(0, 500)) {
      const events = db
        .prepare('SELECT status, created_at FROM order_events WHERE order_id = ? ORDER BY created_at ASC')
        .all(o.id) as unknown as Array<{ status: string; created_at: string }>;
      const t0 = Date.parse(o.created_at);
      const find = (st: string[]) => {
        const ev = events.find((e) => st.includes(e.status));
        return ev ? Date.parse(ev.created_at) : null;
      };
      const tPay = find(['payee', 'acompte_paye']);
      const tShip = find(['expediee']);
      const tDeliv = find(['livree']);
      if (tPay !== null) { sPay += (tPay - t0) / 3_600_000; nPay++; }
      if (tShip !== null && tPay !== null) { sShip += (tShip - tPay) / 3_600_000; nShip++; }
      if (tDeliv !== null && tShip !== null) { sDeliv += (tDeliv - tShip) / 3_600_000; nDeliv++; }
    }
    const r1 = (v: number, n: number) => (n ? Math.round((v / n) * 10) / 10 : 0);
    delays.avgHoursToPayment = r1(sPay, nPay);
    delays.avgHoursToShipment = r1(sShip, nShip);
    delays.avgHoursToDelivery = r1(sDeliv, nDeliv);
  }

  // Top products / vendors / categories from paid order items
  const cut = periodCutoff(f.period);
  const itemRows = db
    .prepare(
      `SELECT oi.product_id, oi.product_title, oi.vendor_id, oi.unit_price * oi.quantity AS line_total, oi.quantity,
              u.full_name AS vendor_name, s.name AS shop_name, c.name AS category_name, o.created_at
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN users u ON u.id = oi.vendor_id
       LEFT JOIN shops s ON s.vendor_id = oi.vendor_id
       JOIN products p ON p.id = oi.product_id
       JOIN categories c ON c.id = p.category_id
       WHERE o.payment_status = 'paid' AND o.created_at >= ?`
    )
    .all(new Date(cut).toISOString()) as unknown as Array<{
    product_id: string;
    product_title: string;
    vendor_id: string;
    vendor_name: string;
    shop_name: string | null;
    category_name: string;
    line_total: number;
    quantity: number;
  }>;

  const topProductsMap = new Map<string, { title: string; shopName: string; revenue: number; qty: number }>();
  const topVendorsMap = new Map<string, { name: string; shopName: string; revenue: number; commission: number; orders: Set<string> }>();
  const catMap = new Map<string, { revenue: number; commission: number; qty: number }>();

  for (const r of itemRows) {
    const p = topProductsMap.get(r.product_id) ?? { title: r.product_title, shopName: r.shop_name || '', revenue: 0, qty: 0 };
    p.revenue += Number(r.line_total);
    p.qty += Number(r.quantity);
    topProductsMap.set(r.product_id, p);

    const v = topVendorsMap.get(r.vendor_id) ?? { name: r.vendor_name, shopName: r.shop_name || '', revenue: 0, commission: 0, orders: new Set<string>() };
    v.revenue += Number(r.line_total);
    topVendorsMap.set(r.vendor_id, v);

    const c = catMap.get(r.category_name) ?? { revenue: 0, commission: 0, qty: 0 };
    c.revenue += Number(r.line_total);
    c.qty += Number(r.quantity);
    catMap.set(r.category_name, c);
  }
  const topProducts = [...topProductsMap.entries()]
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8);
  const topVendors = [...topVendorsMap.entries()]
    .map(([id, v]) => ({ vendorId: id, name: v.name, shopName: v.shopName, revenue: v.revenue, commission: v.commission }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8);
  const topCategories = [...catMap.entries()]
    .map(([name, v]) => ({ name, revenue: v.revenue, qty: v.qty }))
    .sort((a, b) => b.revenue - a.revenue);

  // Commission by payment method / by category
  const methodMap = new Map<string, { commission: number; grand: number; orders: number }>();
  for (const o of paid) {
    const k = PAYMENT_METHOD_LABELS[o.payment_method] || o.payment_method;
    const m = methodMap.get(k) ?? { commission: 0, grand: 0, orders: 0 };
    m.commission += Number(o.commission_amount);
    m.grand += grandOf(o);
    m.orders += 1;
    methodMap.set(k, m);
  }
  const commissionByMethod = [...methodMap.entries()].map(([method, v]) => ({ method, ...v })).sort((a, b) => b.commission - a.commission);

  // Zone distribution
  const zoneMap = new Map<string, { orders: number; grand: number }>();
  for (const o of paid) {
    const z = zoneLabels(o.delivery_zone);
    const m = zoneMap.get(z) ?? { orders: 0, grand: 0 };
    m.orders += 1;
    m.grand += grandOf(o);
    zoneMap.set(z, m);
  }
  const zoneDistribution = [...zoneMap.entries()].map(([zone, v]) => ({ zone, ...v })).sort((a, b) => b.orders - a.orders);

  // Rating distribution
  const ratingRows = db.prepare('SELECT rating, COUNT(*) AS c FROM reviews GROUP BY rating ORDER BY rating DESC').all() as unknown as Array<{ rating: number; c: number }>;
  const ratingDistribution = ratingRows.map((r) => ({ rating: Number(r.rating), count: Number(r.c) }));

  // Daily series (up to 30 last buckets within period)
  const seriesMap = new Map<string, { orders: number; grand: number; commission: number }>();
  for (const o of orders) {
    const d = new Date(o.created_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const s = seriesMap.get(key) ?? { orders: 0, grand: 0, commission: 0 };
    s.orders += 1;
    if (o.payment_status === 'paid') {
      s.grand += grandOf(o);
      s.commission += Number(o.commission_amount);
    }
    seriesMap.set(key, s);
  }
  const dailySeries = [...seriesMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-30)
    .map(([date, v]) => ({ date, ...v }));

  return {
    period: f.period,
    kpis,
    delays,
    topProducts,
    topVendors,
    topCategories,
    commissionByMethod,
    zoneDistribution,
    ratingDistribution,
    dailySeries,
  };
}

function zoneLabels(zoneId: string): string {
  const map: Record<string, string> = {
    abidjan: 'Abidjan / Capitale',
    national: 'Intérieur du pays',
    regional: 'Afrique de l’Ouest (CÉDÉAO)',
  };
  return map[zoneId] || zoneId;
}

// ============================================================
// BUYERS — guest directory aggregated by email
// ============================================================
export function getAdminBuyers(f: { q?: string; minOrders?: number }) {
  const rows = db
    .prepare('SELECT buyer_email, buyer_name, delivery_zone, total_amount, vat_amount, discount_amount, payment_status, payment_mode, created_at FROM orders ORDER BY created_at DESC')
    .all() as unknown as Array<{
    buyer_email: string;
    buyer_name: string;
    delivery_zone: string;
    total_amount: number;
    vat_amount: number;
    discount_amount: number;
    payment_status: string;
    payment_mode: string;
    created_at: string;
  }>;

  interface BAcc {
    email: string;
    name: string;
    zone: string;
    orders: number;
    paidOrders: number;
    spent: number;
    firstAt: string;
    lastAt: string;
    refunded: number;
    customOrders: number;
  }
  const map = new Map<string, BAcc>();
  for (const r of rows) {
    const key = r.buyer_email.toLowerCase();
    const b =
      map.get(key) ??
      ({ email: r.buyer_email, name: r.buyer_name, zone: r.delivery_zone, orders: 0, paidOrders: 0, spent: 0, firstAt: r.created_at, lastAt: r.created_at, refunded: 0, customOrders: 0 } as BAcc);
    b.name = r.buyer_name || b.name;
    b.orders += 1;
    if (r.payment_status === 'paid') {
      b.paidOrders += 1;
      b.spent += Number(r.total_amount) + Number(r.vat_amount) - Number(r.discount_amount ?? 0);
    }
    if (r.payment_status === 'refunded') b.refunded += 1;
    if (r.payment_mode === 'quote') b.customOrders += 1;
    if (r.created_at < b.firstAt) b.firstAt = r.created_at;
    if (r.created_at > b.lastAt) b.lastAt = r.created_at;
    map.set(key, b);
  }

  let buyers = [...map.values()].map((b) => ({ ...b, avgBasket: b.paidOrders ? Math.round(b.spent / b.paidOrders) : 0 }));
  if (f.q) {
    const needle = f.q.toLowerCase();
    buyers = buyers.filter((b) => b.email.toLowerCase().includes(needle) || b.name.toLowerCase().includes(needle));
  }
  if (f.minOrders !== undefined && f.minOrders > 0) {
    buyers = buyers.filter((b) => b.orders >= f.minOrders!);
  }
  buyers.sort((a, b) => b.spent - a.spent || b.orders - a.orders);
  return {
    buyers,
    totals: {
      count: buyers.length,
      totalSpent: buyers.reduce((s, b) => s + b.spent, 0),
      repeatBuyers: buyers.filter((b) => b.orders >= 2).length,
    },
  };
}

// ============================================================
// ORDER DETAIL 360°
// ============================================================
export function getAdminOrderDetail(orderId: string) {
  const o = db.prepare('SELECT o.*, p.provider_ref, p.status AS tx_status, p.method AS tx_method FROM orders o LEFT JOIN payments p ON p.order_id = o.id WHERE o.id = ?').get(orderId) as
    | Record<string, unknown>
    | undefined;
  if (!o) return null;

  const items = db
    .prepare(
      `SELECT oi.*, u.full_name AS vendor_name, s.name AS shop_name, s.slug AS shop_slug, c.name AS category_name
       FROM order_items oi
       JOIN users u ON u.id = oi.vendor_id
       LEFT JOIN shops s ON s.vendor_id = oi.vendor_id
       JOIN products p ON p.id = oi.product_id
       JOIN categories c ON c.id = p.category_id
       WHERE oi.order_id = ?`
    )
    .all(orderId)
    .map((it: Record<string, unknown>) => ({
      id: String(it.id),
      productId: String(it.product_id),
      productTitle: String(it.product_title),
      variantLabel: it.variant_label ? String(it.variant_label) : null,
      categoryName: it.category_name ? String(it.category_name) : null,
      vendorId: String(it.vendor_id),
      vendorName: String(it.vendor_name),
      shopName: it.shop_name ? String(it.shop_name) : null,
      quantity: Number(it.quantity),
      unitPrice: Number(it.unit_price),
      deliveryFee: Number(it.delivery_fee),
      carrier: it.carrier ? String(it.carrier) : null,
      trackingNumber: it.tracking_number ? String(it.tracking_number) : null,
      itemStatus: String(it.item_status),
      customSpecs: it.custom_specs_json ? JSON.parse(String(it.custom_specs_json)) : null,
    }));

  const events = db
    .prepare('SELECT id, status, note, actor, created_at FROM order_events WHERE order_id = ? ORDER BY created_at ASC')
    .all(orderId)
    .map((e: Record<string, unknown>) => ({
      id: String(e.id),
      status: String(e.status),
      note: String(e.note),
      actor: String(e.actor),
      createdAt: String(e.created_at),
    }));

  const totalHT = Number(o.total_amount);
  const vat = Number(o.vat_amount ?? 0);
  const discount = Number(o.discount_amount ?? 0);
  const commission = Number(o.commission_amount ?? 0);
  return {
    order: {
      id: String(o.id),
      orderNumber: String(o.order_number),
      buyerName: String(o.buyer_name),
      buyerEmail: String(o.buyer_email),
      buyerPhone: o.buyer_phone ? String(o.buyer_phone) : null,
      shippingAddress: String(o.shipping_address),
      deliveryZone: zoneLabels(String(o.delivery_zone)),
      createdAt: String(o.created_at),
      expiresAt: o.expires_at ? String(o.expires_at) : null,
      paymentStatus: String(o.payment_status),
      paymentMode: String(o.payment_mode || 'full'),
      paymentMethod: PAYMENT_METHOD_LABELS[String(o.payment_method)] || String(o.payment_method),
      depositPercent: Number(o.deposit_percent ?? 100),
      paidAmount: Number(o.paid_amount ?? 0),
      balanceDue: Number(o.balance_due ?? 0),
      bankTransferRef: o.bank_transfer_ref ? String(o.bank_transfer_ref) : null,
      providerRef: o.provider_ref ? String(o.provider_ref) : null,
      quoteThreadId: o.quote_thread_id ? String(o.quote_thread_id) : null,
      subtotal: Number(o.subtotal),
      deliveryTotal: Number(o.delivery_total),
      totalHT,
      vatAmount: vat,
      discountAmount: discount,
      promoCode: o.promo_code ? String(o.promo_code) : null,
      grandTotal: totalHT + vat - discount,
      commissionAmount: commission,
      netVendors: totalHT - commission,
    },
    items,
    events,
  };
}

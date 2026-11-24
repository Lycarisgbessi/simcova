import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response, Router } from 'express';
import express from 'express';
import { GoogleGenAI } from '@google/genai';
import {
  db,
  DB_PATH,
  getPlatformSettings,
  getRulesMap,
  queueTransactionalEmail,
  UPLOADS_PATH,
  writeAuditLog,
} from './db.ts';
import {
  constantTimeEquals,
  decryptKycPayload,
  encryptKycPayload,
  hashPassword,
  randomToken,
  signMessageThreadToken,
  signOrderTrackingToken,
  signSessionToken,
  verifyMessageThreadToken,
  verifyOrderTrackingToken,
  verifyPassword,
  verifySessionToken,
} from './crypto.ts';
import { jumiaAfricaProvider } from './payments/jumiaAfrica.ts';
import { rateLimit } from './rateLimit.ts';
import { broadcastSseAlert, registerSseClient, sseClients } from './sse.ts';
import { expireOrderIfDue, getMaintenanceStats } from './maintenance.ts';
import {
  getAdminAnalytics,
  getAdminBuyers,
  getAdminOrderDetail,
  getAdminPayouts,
  getAdminTransactions,
  recordVendorPayout,
} from './adminFinance.ts';
import {
  calculateOrderTotals,
  canLeaveReview,
  computePaymentBreakdown,
  detectCircumvention,
  extractKeywords,
  filterAndSortProducts,
  filterAndSortShops,
  splitInclusiveVat,
  validatePasswordStrength,
  validateProductPublication,
} from '../src/shared/rulesEngine.ts';
import type {
  BankDetails,
  Category,
  CustomSpecs,
  DeliveryZoneFee,
  OrderEvent,
  OrderEventStatus,
  PaymentMethodId,
  PaymentMode,
  PlatformSettings,
  Product,
  ProductCondition,
  ProductStatus,
  ProductVariant,
  PushAlertItem,
  RuleId,
  Shop,
  UserAccount,
  UserRole,
  VendorBankCoordinate,
  VendorStatus,
} from '../src/shared/types.ts';

interface AuthReq extends Request {
  authUser?: UserAccount;
}

interface RawBodyReq extends Request {
  rawBody?: Buffer;
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * One-time verification/reset tokens must only travel via the transactional outbox email.
 * They are additionally echoed in HTTP responses ONLY outside production (demo/sandbox
 * convenience, also relied upon by the e2e suite). Set SIMCOVA_EXPOSE_TOKENS=false to
 * disable even in development.
 */
function exposeDemoTokens(): boolean {
  return !isProduction() && process.env.SIMCOVA_EXPOSE_TOKENS !== 'false';
}

function mapUserRow(row: Record<string, unknown>): UserAccount {
  return {
    id: String(row.id),
    email: String(row.email),
    fullName: String(row.full_name),
    role: row.role as UserRole,
    emailVerified: Boolean(row.email_verified),
    status: row.status as VendorStatus,
    rejectionReason: row.rejection_reason ? String(row.rejection_reason) : null,
    badges: JSON.parse(String(row.badges_json || '[]')),
    customFields: JSON.parse(String(row.custom_fields_json || '{}')),
    createdAt: String(row.created_at),
  };
}

function mapProductRow(row: Record<string, unknown>): Product {
  return {
    id: String(row.id),
    vendorId: String(row.vendor_id),
    shopId: String(row.shop_id),
    shopName: row.shop_name ? String(row.shop_name) : undefined,
    shopSlug: row.shop_slug ? String(row.shop_slug) : undefined,
    shopBadges: row.shop_badges ? JSON.parse(String(row.shop_badges)) : undefined,
    vendorStatus: row.vendor_status ? (String(row.vendor_status) as VendorStatus) : undefined,
    title: String(row.title),
    description: String(row.description),
    categoryId: String(row.category_id),
    categoryName: row.category_name ? String(row.category_name) : undefined,
    price: Number(row.price),
    condition: String(row.condition) as ProductCondition,
    status: String(row.status) as ProductStatus,
    stock: Number(row.stock),
    keywords: JSON.parse(String(row.keywords_json || '[]')),
    media: JSON.parse(String(row.media_json || '[]')),
    videoUrl: row.video_url ? String(row.video_url) : null,
    variants: JSON.parse(String(row.variants_json || '[]')),
    deliveryFee: Number(row.delivery_fee),
    deliveryZones: JSON.parse(String(row.delivery_zones_json || '[]')),
    deliveryDelay: String(row.delivery_delay),
    paymentMethods: JSON.parse(String(row.payment_methods_json || '[]')),
    ratingAverage: Number(row.rating_average ?? 0),
    reviewCount: Number(row.review_count ?? 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function extractBankDetails(row: Record<string, unknown>): BankDetails | null {
  const iban = row.bank_iban ? String(row.bank_iban).trim() : '';
  const bankName = row.bank_name ? String(row.bank_name).trim() : '';
  const accountHolder = row.bank_account_holder ? String(row.bank_account_holder).trim() : '';
  if (!iban || !bankName || !accountHolder) return null;
  return {
    bankName,
    accountHolder,
    iban,
    swiftBic: row.bank_bic ? String(row.bank_bic).trim() : undefined,
    instructions: row.bank_instructions ? String(row.bank_instructions).trim() : undefined,
  };
}

function mapShopRow(row: Record<string, unknown> | undefined, options?: { publicView?: boolean }): Shop | null {
  if (!row) return null;
  const bankDetails = extractBankDetails(row);
  const publicView = Boolean(options?.publicView);
  return {
    id: String(row.id),
    vendorId: String(row.vendor_id),
    slug: String(row.slug),
    name: String(row.name),
    description: String(row.description || ''),
    logoUrl: row.logo_url ? String(row.logo_url) : null,
    contactEmail: publicView ? '' : String(row.contact_email || ''),
    contactPhone: publicView ? null : row.contact_phone ? String(row.contact_phone) : null,
    city: row.city ? String(row.city) : null,
    badges: row.badges_json ? JSON.parse(String(row.badges_json)) : [],
    vendorStatus: (row.vendor_status ? String(row.vendor_status) : 'valide') as VendorStatus,
    defaultDeliveryFee: Number(row.default_delivery_fee ?? 2000),
    defaultDeliveryDelay: String(row.default_delivery_delay || '24 à 72h'),
    ratingAverage: row.rating_average !== undefined ? Number(Number(row.rating_average).toFixed(1)) : 0,
    reviewCount: row.review_count !== undefined ? Number(row.review_count) : 0,
    salesCount: row.sales_count !== undefined ? Number(row.sales_count) : 0,
    publishedProductsCount: row.published_products_count !== undefined ? Number(row.published_products_count) : 0,
    hasBankDetails: Boolean(bankDetails),
    bankDetails: publicView ? undefined : bankDetails,
    createdAt: String(row.created_at || ''),
  };
}

function decrementOrderStock(orderId: string, nowIso: string): void {
  const orderItems = db
    .prepare('SELECT product_id, variant_id, variant_label, quantity FROM order_items WHERE order_id = ?')
    .all(orderId) as Array<{
    product_id: string;
    variant_id: string | null;
    variant_label: string | null;
    quantity: number;
  }>;
  for (const item of orderItems) {
    const prod = db.prepare('SELECT stock, variants_json FROM products WHERE id = ?').get(item.product_id) as
      | { stock: number; variants_json: string }
      | undefined;
    if (!prod) continue;
    const variants = JSON.parse(String(prod.variants_json || '[]')) as ProductVariant[];
    let updatedVariants = variants;
    if (variants.length > 0 && (item.variant_id || item.variant_label)) {
      updatedVariants = variants.map((v) => {
        const matchById = item.variant_id && v.id === item.variant_id;
        const matchByLabel = !item.variant_id && item.variant_label && v.label === item.variant_label;
        if (matchById || matchByLabel) {
          return { ...v, stock: Math.max(0, v.stock - item.quantity) };
        }
        return v;
      });
    }

    const nextStock = Math.max(0, prod.stock - item.quantity);
    const allVariantsDepleted = updatedVariants.length > 0 && updatedVariants.every((v) => v.stock <= 0);
    const effectiveStock = allVariantsDepleted ? 0 : nextStock;
    if (effectiveStock === 0) {
      db.prepare("UPDATE products SET stock = 0, variants_json = ?, status = 'archive', updated_at = ? WHERE id = ?").run(
        JSON.stringify(updatedVariants),
        nowIso,
        item.product_id
      );
    } else {
      db.prepare('UPDATE products SET stock = ?, variants_json = ?, updated_at = ? WHERE id = ?').run(
        effectiveStock,
        JSON.stringify(updatedVariants),
        nowIso,
        item.product_id
      );
    }
  }
}

function getAuthenticatedUser(req: Request): UserAccount | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  const decoded = verifySessionToken(token);
  if (!decoded) return null;
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.userId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return mapUserRow(row);
}

function requireAuth(req: AuthReq, res: Response, next: NextFunction): void {
  const user = getAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: 'Authentification requise.' });
    return;
  }
  req.authUser = user;
  next();
}

function requireActiveVendorWrite(req: AuthReq, res: Response, next: NextFunction): void {
  const user = req.authUser;
  if (!user) {
    res.status(401).json({ error: 'Authentification requise.' });
    return;
  }
  if (user.role !== 'admin' && user.status === 'suspendu') {
    res.status(403).json({
      error: 'Votre compte vendeur est suspendu. Aucune modification n’est autorisée tant que la suspension est active.',
    });
    return;
  }
  next();
}

function requireAdmin(req: AuthReq, res: Response, next: NextFunction): void {
  const user = getAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: 'Authentification administrateur requise.' });
    return;
  }
  if (user.role !== 'admin') {
    res.status(403).json({ error: 'Accès interdit : privilèges administrateur requis (RBAC).' });
    return;
  }
  req.authUser = user;
  next();
}

function adminNeedsBootstrap(): boolean {
  if (process.env.SIMCOVA_ADMIN_PASSCODE?.trim()) return false;
  const admin = db.prepare("SELECT password_hash FROM users WHERE role = 'admin' LIMIT 1").get() as
    | { password_hash: string }
    | undefined;
  return !admin || !admin.password_hash;
}

function getBaseUrl(req: Request): string {
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
  const host = (req.headers['x-forwarded-host'] as string) || req.get('host') || 'localhost:3000';
  return process.env.APP_URL && process.env.APP_URL !== 'MY_APP_URL' ? process.env.APP_URL : `${proto}://${host}`;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * Collision-resistant order number: 8 random digits with a DB uniqueness retry loop
 * (the previous 4-digit scheme would collide on the UNIQUE constraint around ~10k orders/year).
 */
function generateUniqueOrderNumber(): string {
  const prefix = `CMD-${new Date().getFullYear()}-`;
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = `${prefix}${String(crypto.randomInt(10000000, 99999999))}`;
    const clash = db.prepare('SELECT 1 AS one FROM orders WHERE order_number = ?').get(candidate);
    if (!clash) return candidate;
  }
  // astronomically unlikely fallback
  return `${prefix}${Date.now().toString().slice(-11)}`;
}

export function createApiRouter(): Router {
  const router = express.Router();

  // Mode maintenance : non-admin API access is rejected while the flag is on
  // (bootstrap/auth stay open so admins can log in and the storefront shows the banner)
  router.use((req: AuthReq, res, next) => {
    if (req.path === '/bootstrap' || req.path.startsWith('/auth/') || req.path.startsWith('/payments/jumia/webhook')) {
      return next();
    }
    try {
      if (getPlatformSettings().maintenanceMode) {
        const user = getAuthenticatedUser(req);
        if (!user || user.role !== 'admin') {
          return res.status(503).json({
            error: 'SIMCOVA est momentanément en maintenance. Merci de réessayer dans quelques instants.',
            maintenance: true,
          });
        }
      }
    } catch {
      // Settings unavailable — fail open rather than locking everyone out
    }
    next();
  });

  // Serve safe uploaded media from data/uploads with path confinement
  router.get('/uploads/:fileName', (req, res) => {
    const safeName = path.basename(req.params.fileName);
    const resolved = path.resolve(UPLOADS_PATH, safeName);
    if (!resolved.startsWith(UPLOADS_PATH + path.sep) || !fs.existsSync(resolved)) {
      return res.status(404).json({ error: 'Fichier introuvable.' });
    }
    res.sendFile(resolved);
  });

  // OpenAPI 3.0 Spec (§5.2)
  router.get('/openapi.json', (_req, res) => {
    res.json({
      openapi: '3.0.3',
      info: {
        title: 'SIMCOVA Marketplace API',
        version: '1.0.0',
        description: 'API REST de la plateforme marketplace SIMCOVA : catalogue, achat sans compte, suivi sécurisé, paiement Jumia Africa, espaces vendeurs et administration.',
      },
      paths: {
        '/api/bootstrap': { get: { summary: 'Données publiques initiales (catégories, règles, boutiques)' } },
        '/api/products': { get: { summary: 'Catalogue public avec recherche mots-clés et filtres' } },
        '/api/orders': { post: { summary: 'Création d’une commande acheteur sans compte + session Jumia Africa' } },
        '/api/orders/track/{token}': { get: { summary: 'Suivi horodaté de commande par jeton signé' } },
        '/api/payments/jumia/webhook': { post: { summary: 'Rappel système signé (HMAC) de confirmation paiement Jumia Africa' } },
        '/api/auth/register': { post: { summary: 'Inscription vendeur selon les champs RG-04' } },
        '/api/vendor/products': { get: { summary: 'Catalogue du vendeur connecté' }, post: { summary: 'Création de fiche produit' } },
        '/api/admin/rules/{ruleId}': { put: { summary: 'Activation et paramétrage temps réel des règles RG-01..RG-10' } },
      },
    });
  });

  // Bootstrap endpoint
  router.get('/bootstrap', (_req, res) => {
    const categories = db.prepare('SELECT * FROM categories ORDER BY name ASC').all().map((c: Record<string, unknown>) => ({
      id: String(c.id),
      name: String(c.name),
      slug: String(c.slug),
      active: Boolean(c.active),
      forbidden: Boolean(c.forbidden),
      requiredBadge: c.required_badge ? String(c.required_badge) : null,
    }));

    const rules = getRulesMap();
    const settings = getPlatformSettings();

    const shops = db
      .prepare(
        `SELECT s.*, u.badges_json, u.status as vendor_status,
          COALESCE((SELECT AVG(r.rating) FROM reviews r JOIN products p ON p.id = r.product_id WHERE p.shop_id = s.id AND r.moderation_status = 'visible'), 0) as rating_average,
          COALESCE((SELECT COUNT(r.id) FROM reviews r JOIN products p ON p.id = r.product_id WHERE p.shop_id = s.id AND r.moderation_status = 'visible'), 0) as review_count,
          COALESCE((SELECT COUNT(DISTINCT oi.order_id) FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.vendor_id = s.vendor_id AND o.payment_status = 'paid'), 0) as sales_count,
          COALESCE((SELECT COUNT(*) FROM products p WHERE p.shop_id = s.id AND p.status = 'publie' AND p.stock > 0), 0) as published_products_count
         FROM shops s
         JOIN users u ON u.id = s.vendor_id
         WHERE u.status IN ('valide', 'certifie')
         ORDER BY s.created_at ASC`
      )
      .all()
      .map((s: Record<string, unknown>) => mapShopRow(s, { publicView: true })!);

    res.json({
      categories,
      rules,
      settings,
      shops,
      adminNeedsClaim: adminNeedsBootstrap(),
    });
  });

  // =========================================================================
  // AUTHENTICATION & VENDOR ACCOUNTS (EXF-101 .. EXF-107)
  // =========================================================================

  router.post('/auth/admin-bootstrap', rateLimit(10, 60_000), (req, res) => {
    if (!adminNeedsBootstrap()) {
      return res.status(403).json({ error: 'Le compte administrateur est déjà initialisé.' });
    }
    const { password } = req.body as { password?: string };
    const check = validatePasswordStrength(password || '');
    if (!check.valid) {
      return res.status(400).json({ error: check.reason });
    }
    const admin = db.prepare("SELECT * FROM users WHERE role = 'admin' LIMIT 1").get() as Record<string, unknown>;
    const hash = hashPassword(password!);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, admin.id as string);
    writeAuditLog({
      actorId: String(admin.id),
      actorEmail: String(admin.email),
      action: 'ADMIN_BOOTSTRAP',
      targetType: 'user',
      targetId: String(admin.id),
      details: 'Mot de passe administrateur initialisé lors du premier démarrage.',
    });
    const user = mapUserRow(admin);
    const shopRow = db.prepare('SELECT * FROM shops WHERE vendor_id = ?').get(user.id) as Record<string, unknown> | undefined;
    const token = signSessionToken(user.id, 'admin');
    res.json({ token, user, shop: mapShopRow(shopRow) });
  });

  router.post('/auth/login', rateLimit(20, 60_000), (req, res) => {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) {
      return res.status(400).json({ error: 'Veuillez saisir votre courriel et votre mot de passe.' });
    }
    const row = db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(email.trim()) as
      | Record<string, unknown>
      | undefined;
    if (!row) {
      return res.status(401).json({ error: 'Identifiants incorrects.' });
    }

    const role = row.role as UserRole;
    const envAdminPass = process.env.SIMCOVA_ADMIN_PASSCODE?.trim();

    let valid = false;
    if (role === 'admin' && envAdminPass) {
      // Constant-time comparison: never leak the passcode through timing or early exit.
      valid = constantTimeEquals(password, envAdminPass);
    } else if (String(row.password_hash)) {
      valid = verifyPassword(password, String(row.password_hash));
    } else if (role === 'admin') {
      return res.status(409).json({
        error: 'Le compte administrateur doit d’abord être initialisé ci-dessous.',
        needsClaim: true,
      });
    }

    if (!valid) {
      return res.status(401).json({ error: 'Identifiants incorrects.' });
    }

    const user = mapUserRow(row);
    const shopRow = db.prepare('SELECT * FROM shops WHERE vendor_id = ?').get(user.id) as Record<string, unknown> | undefined;
    const token = signSessionToken(user.id, user.role);
    res.json({ token, user, shop: mapShopRow(shopRow) });
  });

  router.get('/auth/me', requireAuth, (req: AuthReq, res) => {
    const shopRow = db.prepare('SELECT * FROM shops WHERE vendor_id = ?').get(req.authUser!.id) as Record<string, unknown> | undefined;
    res.json({ user: req.authUser, shop: mapShopRow(shopRow) });
  });

  router.post('/auth/register', rateLimit(15, 60_000), (req, res) => {
    const rules = getRulesMap();
    const rg04 = rules['RG-04'];
    const requiredFields = (rg04?.valueJson?.requiredFields as string[]) ?? ['fullName', 'email', 'password', 'shopName'];

    const body = req.body as Record<string, string | undefined>;
    for (const field of requiredFields) {
      if (!body[field] || !String(body[field]).trim()) {
        const labels: Record<string, string> = {
          fullName: 'Nom complet',
          email: 'Courriel',
          password: 'Mot de passe',
          shopName: 'Nom de la boutique',
          phone: 'Téléphone',
          city: 'Ville',
          shopDescription: 'Description de la boutique',
        };
        return res.status(400).json({ error: `Le champ obligatoire « ${labels[field] || field} » est manquant (RG-04).` });
      }
    }

    const email = String(body.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Adresse électronique invalide.' });
    }

    const passCheck = validatePasswordStrength(String(body.password || ''));
    if (!passCheck.valid) {
      return res.status(400).json({ error: passCheck.reason });
    }

    const existing = db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)').get(email);
    if (existing) {
      return res.status(409).json({ error: 'Un compte vendeur existe déjà avec cette adresse électronique.' });
    }

    const userId = `ven-${crypto.randomUUID().slice(0, 8)}`;
    const shopId = `shop-${crypto.randomUUID().slice(0, 8)}`;
    const verToken = randomToken(20);
    const verExp = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString();
    const now = new Date().toISOString();
    const shopName = String(body.shopName || '').trim();
    const baseSlug = slugify(shopName) || shopId;
    const slugCollision = db.prepare('SELECT id FROM shops WHERE slug = ?').get(baseSlug);
    const shopSlug = slugCollision ? `${baseSlug}-${userId.slice(-4)}` : baseSlug;

    const customFields: Record<string, string> = {};
    if (body.phone) customFields.phone = body.phone.trim();
    if (body.city) customFields.city = body.city.trim();

    db.prepare(`
      INSERT INTO users (id, email, full_name, password_hash, role, email_verified, verification_token, verification_expires_at, status, badges_json, custom_fields_json, created_at)
      VALUES (?, ?, ?, ?, 'vendor', 0, ?, ?, 'en_attente', '[]', ?, ?)
    `).run(
      userId,
      email,
      String(body.fullName || '').trim(),
      hashPassword(String(body.password)),
      verToken,
      verExp,
      JSON.stringify(customFields),
      now
    );

    db.prepare(`
      INSERT INTO shops (id, vendor_id, slug, name, description, contact_email, contact_phone, city, default_delivery_fee, default_delivery_delay, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 2000, '24 à 72h', ?)
    `).run(
      shopId,
      userId,
      shopSlug,
      shopName,
      String(body.shopDescription || `Boutique ${shopName} sur SIMCOVA.`).trim(),
      email,
      body.phone?.trim() || null,
      body.city?.trim() || null,
      now
    );

    const verifyUrl = `${getBaseUrl(req)}/?verify_email=${encodeURIComponent(verToken)}`;
    queueTransactionalEmail({
      toEmail: email,
      subject: 'SIMCOVA — Confirmez votre adresse électronique vendeur',
      bodyText: `Bonjour ${body.fullName}, confirmez votre adresse électronique pour activer votre espace vendeur « ${shopName} ».`,
      actionUrl: verifyUrl,
      actionLabel: 'Activer mon compte vendeur',
    });

    writeAuditLog({
      actorId: userId,
      actorEmail: email,
      action: 'VENDOR_REGISTERED',
      targetType: 'user',
      targetId: userId,
      details: `Inscription de la boutique « ${shopName} »`,
    });

    const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as Record<string, unknown>;
    const shopRow = db.prepare('SELECT * FROM shops WHERE id = ?').get(shopId) as Record<string, unknown> | undefined;
    const token = signSessionToken(userId, 'vendor');

    // Tokens only travel via the outbox email; echoed in the response for demo purposes
    // (email delivery not wired) strictly outside production.
    res.status(201).json({
      token,
      user: mapUserRow(userRow),
      shop: mapShopRow(shopRow),
      ...(exposeDemoTokens() ? { verificationToken: verToken, verificationUrl: verifyUrl } : {}),
    });
  });

  router.post('/auth/verify-email', (req, res) => {
    const { token } = req.body as { token?: string };
    if (!token) return res.status(400).json({ error: 'Jeton de confirmation manquant.' });

    const row = db
      .prepare('SELECT * FROM users WHERE verification_token = ?')
      .get(token) as Record<string, unknown> | undefined;
    if (!row) {
      return res.status(400).json({ error: 'Lien de confirmation invalide ou déjà utilisé.' });
    }
    if (row.verification_expires_at && Date.now() > Date.parse(String(row.verification_expires_at))) {
      return res.status(400).json({ error: 'Ce lien de confirmation a expiré. Demandez un nouvel envoi.' });
    }

    db.prepare('UPDATE users SET email_verified = 1, verification_token = NULL, verification_expires_at = NULL WHERE id = ?').run(
      String(row.id)
    );
    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(String(row.id)) as Record<string, unknown>;
    res.json({ verified: true, user: mapUserRow(updated) });
  });

  router.post('/auth/resend-verification', requireAuth, (req: AuthReq, res) => {
    const user = req.authUser!;
    if (user.emailVerified) {
      return res.json({ alreadyVerified: true });
    }
    const verToken = randomToken(20);
    const verExp = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString();
    db.prepare('UPDATE users SET verification_token = ?, verification_expires_at = ? WHERE id = ?').run(
      verToken,
      verExp,
      user.id
    );
    const verifyUrl = `${getBaseUrl(req)}/?verify_email=${encodeURIComponent(verToken)}`;
    queueTransactionalEmail({
      toEmail: user.email,
      subject: 'SIMCOVA — Nouveau lien de confirmation courriel',
      bodyText: 'Voici votre nouveau lien d’activation de compte vendeur SIMCOVA.',
      actionUrl: verifyUrl,
      actionLabel: 'Confirmer mon courriel',
    });
    res.json({ sent: true, ...(exposeDemoTokens() ? { verificationToken: verToken, verificationUrl: verifyUrl } : {}) });
  });

  router.post('/auth/forgot-password', rateLimit(10, 60_000), (req, res) => {
    const { email } = req.body as { email?: string };
    if (!email) return res.status(400).json({ error: 'Adresse électronique requise.' });
    const row = db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(email.trim()) as
      | Record<string, unknown>
      | undefined;
    if (row && row.role === 'vendor') {
      const resetToken = randomToken(20);
      const exp = new Date(Date.now() + 1000 * 60 * 60).toISOString();
      db.prepare('UPDATE users SET reset_token = ?, reset_expires_at = ? WHERE id = ?').run(
        resetToken,
        exp,
        String(row.id)
      );
      const resetUrl = `${getBaseUrl(req)}/?reset_password=${encodeURIComponent(resetToken)}`;
      queueTransactionalEmail({
        toEmail: String(row.email),
        subject: 'SIMCOVA — Réinitialisation de mot de passe',
        bodyText: 'Utilisez ce lien unique (valable 1 heure) pour définir un nouveau mot de passe vendeur.',
        actionUrl: resetUrl,
        actionLabel: 'Réinitialiser mon mot de passe',
      });
      return res.json({ sent: true, ...(exposeDemoTokens() ? { demoResetToken: resetToken } : {}) });
    }
    res.json({ sent: true });
  });

  router.post('/auth/reset-password', (req, res) => {
    const { token, newPassword } = req.body as { token?: string; newPassword?: string };
    if (!token || !newPassword) return res.status(400).json({ error: 'Jeton et nouveau mot de passe requis.' });
    const check = validatePasswordStrength(newPassword);
    if (!check.valid) return res.status(400).json({ error: check.reason });

    const row = db.prepare('SELECT * FROM users WHERE reset_token = ?').get(token) as Record<string, unknown> | undefined;
    if (!row || !row.reset_expires_at || Date.now() > Date.parse(String(row.reset_expires_at))) {
      return res.status(400).json({ error: 'Lien de réinitialisation invalide ou expiré.' });
    }
    db.prepare('UPDATE users SET password_hash = ?, reset_token = NULL, reset_expires_at = NULL WHERE id = ?').run(
      hashPassword(newPassword),
      String(row.id)
    );
    res.json({ reset: true });
  });

  // =========================================================================
  // PUBLIC CATALOG, SHOPS & PRODUCT DETAIL (EXF-401, EXF-402, EXF-107)
  // =========================================================================

  router.get('/products', (req, res) => {
    const q = String(req.query.q || '').trim();
    const category = String(req.query.category || '').trim();
    const shop = String(req.query.shop || '').trim();
    const sort = String(req.query.sort || 'recent');
    const certifiedOnly = req.query.certifiedOnly === 'true';
    const minPrice = Number(req.query.minPrice || 0);
    const maxPrice = Number(req.query.maxPrice || 0);
    const minStock = Number(req.query.minStock || 0);
    const condition = String(req.query.condition || '').trim() as ProductCondition | '';
    const maxDeliveryFee =
      req.query.maxDeliveryFee !== undefined && String(req.query.maxDeliveryFee).trim() !== ''
        ? Number(req.query.maxDeliveryFee)
        : undefined;
    const minRating = Number(req.query.minRating || 0);

    const rows = db
      .prepare(
        `SELECT p.*, s.name as shop_name, s.slug as shop_slug, u.badges_json as shop_badges, u.status as vendor_status,
          c.name as category_name, c.active as cat_active, c.forbidden as cat_forbidden,
          COALESCE((SELECT AVG(r.rating) FROM reviews r WHERE r.product_id = p.id AND r.moderation_status = 'visible'), 0) as rating_average,
          COALESCE((SELECT COUNT(r.id) FROM reviews r WHERE r.product_id = p.id AND r.moderation_status = 'visible'), 0) as review_count
         FROM products p
         JOIN shops s ON s.id = p.shop_id
         JOIN users u ON u.id = p.vendor_id
         JOIN categories c ON c.id = p.category_id
         WHERE p.status = 'publie'
           AND p.stock > 0
           AND u.status != 'suspendu'
           AND u.status != 'rejete'
           AND c.active = 1
           AND c.forbidden = 0`
      )
      .all() as Array<Record<string, unknown>>;

    const products = filterAndSortProducts(rows.map(mapProductRow), {
      q,
      category,
      shop,
      certifiedOnly,
      minPrice,
      maxPrice,
      minStock,
      condition,
      maxDeliveryFee,
      minRating,
      sort,
    });

    res.json({ products });
  });

  router.get('/shops', (req, res) => {
    const q = String(req.query.q || '').trim();
    const minSales = Number(req.query.minSales || 0);
    const certifiedOnly = req.query.certifiedOnly === 'true';
    const badge = String(req.query.badge || '').trim();
    const city = String(req.query.city || '').trim();
    const minRating = Number(req.query.minRating || 0);
    const sort = String(req.query.sort || 'sales_desc');

    const shopRows = db
      .prepare(
        `SELECT s.*, u.badges_json, u.status as vendor_status,
          COALESCE((SELECT AVG(r.rating) FROM reviews r JOIN products p ON p.id = r.product_id WHERE p.shop_id = s.id AND r.moderation_status = 'visible'), 0) as rating_average,
          COALESCE((SELECT COUNT(r.id) FROM reviews r JOIN products p ON p.id = r.product_id WHERE p.shop_id = s.id AND r.moderation_status = 'visible'), 0) as review_count,
          COALESCE((SELECT COUNT(DISTINCT oi.order_id) FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.vendor_id = s.vendor_id AND o.payment_status = 'paid'), 0) as sales_count,
          COALESCE((SELECT COUNT(*) FROM products p WHERE p.shop_id = s.id AND p.status = 'publie' AND p.stock > 0), 0) as published_products_count
         FROM shops s
         JOIN users u ON u.id = s.vendor_id
         WHERE u.status IN ('valide', 'certifie')`
      )
      .all() as Array<Record<string, unknown>>;

    const prodRows = db
      .prepare(
        `SELECT p.shop_id, p.title, p.keywords_json, c.name as category_name
         FROM products p
         JOIN categories c ON c.id = p.category_id
         WHERE p.status = 'publie' AND p.stock > 0 AND c.active = 1 AND c.forbidden = 0`
      )
      .all() as Array<{ shop_id: string; title: string; keywords_json: string; category_name: string }>;

    const catalogTextByShopId: Record<string, string> = {};
    for (const pr of prodRows) {
      const kws = JSON.parse(String(pr.keywords_json || '[]')).join(' ');
      catalogTextByShopId[pr.shop_id] = `${catalogTextByShopId[pr.shop_id] || ''} ${pr.title} ${pr.category_name} ${kws}`;
    }

    const mapped = shopRows.map((r) => mapShopRow(r, { publicView: true })!);
    const shops = filterAndSortShops(mapped, {
      q,
      minSales,
      certifiedOnly,
      badge,
      city,
      minRating,
      sort,
      catalogTextByShopId,
    });

    res.json({ shops });
  });

  router.get('/products/:id', (req, res) => {
    const row = db
      .prepare(
        `SELECT p.*, s.name as shop_name, s.slug as shop_slug, s.description as shop_description, s.logo_url as shop_logo_url,
          s.city as shop_city, s.bank_iban as shop_bank_iban, s.bank_name as shop_bank_name, s.bank_account_holder as shop_bank_holder,
          u.badges_json as shop_badges, u.status as vendor_status, c.name as category_name,
          COALESCE((SELECT AVG(r.rating) FROM reviews r WHERE r.product_id = p.id AND r.moderation_status = 'visible'), 0) as rating_average,
          COALESCE((SELECT COUNT(r.id) FROM reviews r WHERE r.product_id = p.id AND r.moderation_status = 'visible'), 0) as review_count,
          COALESCE((SELECT COUNT(DISTINCT oi.order_id) FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.vendor_id = p.vendor_id AND o.payment_status = 'paid'), 0) as shop_sales_count
         FROM products p
         JOIN shops s ON s.id = p.shop_id
         JOIN users u ON u.id = p.vendor_id
         JOIN categories c ON c.id = p.category_id
         WHERE p.id = ? AND p.status = 'publie' AND u.status != 'suspendu' AND u.status != 'rejete' AND c.active = 1 AND c.forbidden = 0`
      )
      .get(req.params.id) as Record<string, unknown> | undefined;

    if (!row) {
      return res.status(404).json({ error: 'Produit introuvable ou indisponible.' });
    }

    // Anonymous product view counter (admin statistics — no personal tracking)
    db.prepare('UPDATE products SET view_count = view_count + 1 WHERE id = ?').run(req.params.id);

    const reviews = db
      .prepare(
        `SELECT * FROM reviews WHERE product_id = ? AND moderation_status = 'visible' ORDER BY created_at DESC`
      )
      .all(req.params.id)
      .map((r: Record<string, unknown>) => ({
        id: String(r.id),
        productId: String(r.product_id),
        orderId: String(r.order_id),
        buyerName: String(r.buyer_name),
        rating: Number(r.rating),
        comment: String(r.comment),
        vendorReply: r.vendor_reply ? String(r.vendor_reply) : null,
        vendorRepliedAt: r.vendor_replied_at ? String(r.vendor_replied_at) : null,
        reportCount: Number(r.report_count),
        moderationStatus: String(r.moderation_status),
        createdAt: String(r.created_at),
      }));

    res.json({
      product: mapProductRow(row),
      shop: {
        id: String(row.shop_id),
        name: String(row.shop_name),
        slug: String(row.shop_slug),
        description: String(row.shop_description || ''),
        logoUrl: row.shop_logo_url ? String(row.shop_logo_url) : null,
        city: row.shop_city ? String(row.shop_city) : null,
        contactEmail: '',
        contactPhone: null,
        badges: JSON.parse(String(row.shop_badges || '[]')),
        vendorStatus: String(row.vendor_status),
        salesCount: Number(row.shop_sales_count ?? 0),
        hasBankDetails: Boolean(row.shop_bank_iban && row.shop_bank_name && row.shop_bank_holder),
      },
      reviews,
    });
  });

  router.get('/shops/:slug', (req, res) => {
    const shopRow = db
      .prepare(
        `SELECT s.*, u.badges_json, u.status as vendor_status,
          COALESCE((SELECT AVG(r.rating) FROM reviews r JOIN products p ON p.id = r.product_id WHERE p.shop_id = s.id AND r.moderation_status = 'visible'), 0) as rating_average,
          COALESCE((SELECT COUNT(r.id) FROM reviews r JOIN products p ON p.id = r.product_id WHERE p.shop_id = s.id AND r.moderation_status = 'visible'), 0) as review_count,
          COALESCE((SELECT COUNT(DISTINCT oi.order_id) FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.vendor_id = s.vendor_id AND o.payment_status = 'paid'), 0) as sales_count,
          COALESCE((SELECT COUNT(*) FROM products p WHERE p.shop_id = s.id AND p.status = 'publie' AND p.stock > 0), 0) as published_products_count
         FROM shops s JOIN users u ON u.id = s.vendor_id
         WHERE s.slug = ? AND u.status != 'suspendu' AND u.status != 'rejete'`
      )
      .get(req.params.slug) as Record<string, unknown> | undefined;

    if (!shopRow) {
      return res.status(404).json({ error: 'Boutique introuvable ou suspendue.' });
    }

    const products = db
      .prepare(
        `SELECT p.*, s.name as shop_name, s.slug as shop_slug, u.badges_json as shop_badges, u.status as vendor_status, c.name as category_name,
          COALESCE((SELECT AVG(r.rating) FROM reviews r WHERE r.product_id = p.id AND r.moderation_status = 'visible'), 0) as rating_average,
          COALESCE((SELECT COUNT(r.id) FROM reviews r WHERE r.product_id = p.id AND r.moderation_status = 'visible'), 0) as review_count
         FROM products p
         JOIN shops s ON s.id = p.shop_id
         JOIN users u ON u.id = p.vendor_id
         JOIN categories c ON c.id = p.category_id
         WHERE p.shop_id = ? AND p.status = 'publie' AND p.stock > 0 AND c.active = 1 AND c.forbidden = 0
         ORDER BY p.created_at DESC`
      )
      .all(String(shopRow.id))
      .map((r) => mapProductRow(r as Record<string, unknown>));

    const reviews = db
      .prepare(
        `SELECT r.*, p.title as product_title
         FROM reviews r JOIN products p ON p.id = r.product_id
         WHERE p.shop_id = ? AND r.moderation_status = 'visible'
         ORDER BY r.created_at DESC LIMIT 20`
      )
      .all(String(shopRow.id))
      .map((r: Record<string, unknown>) => ({
        id: String(r.id),
        productId: String(r.product_id),
        productTitle: String(r.product_title),
        orderId: String(r.order_id),
        buyerName: String(r.buyer_name),
        rating: Number(r.rating),
        comment: String(r.comment),
        vendorReply: r.vendor_reply ? String(r.vendor_reply) : null,
        vendorRepliedAt: r.vendor_replied_at ? String(r.vendor_replied_at) : null,
        reportCount: Number(r.report_count),
        moderationStatus: String(r.moderation_status),
        createdAt: String(r.created_at),
      }));

    res.json({
      shop: mapShopRow(shopRow, { publicView: true }),
      products,
      reviews,
    });
  });

  // =========================================================================
  // GUEST ORDERS, JUMIA AFRICA PAYMENT & SECURE TRACKING (EXF-404..510)
  // =========================================================================

  router.post('/orders', rateLimit(20, 60_000), async (req, res) => {
    try {
      const { buyerName, buyerEmail, buyerPhone, shippingAddress, deliveryZone, paymentMethod, paymentMode, bankTransferRef, promoCode, items } =
        req.body as {
          buyerName?: string;
          buyerEmail?: string;
          buyerPhone?: string;
          shippingAddress?: string;
          deliveryZone?: string;
          paymentMethod?: PaymentMethodId;
          paymentMode?: PaymentMode;
          bankTransferRef?: string;
          promoCode?: string;
          items?: Array<{
            productId: string;
            variantId?: string | null;
            quantity: number;
            isCustom?: boolean;
            customSpecs?: CustomSpecs | null;
          }>;
        };

      if (!buyerName?.trim() || !buyerEmail?.trim() || !shippingAddress?.trim()) {
        return res.status(400).json({
          error: 'Veuillez renseigner votre nom, adresse électronique et adresse de livraison.',
        });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail.trim())) {
        return res.status(400).json({ error: 'Adresse électronique invalide.' });
      }
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Votre panier est vide.' });
      }

      // Enforce mandatory on-platform communication inside custom specifications & notes
      for (const item of items) {
        const specText = [item.customSpecs?.dimensions, item.customSpecs?.technicalSpecs, item.customSpecs?.notes]
          .filter(Boolean)
          .join(' ');
        const check = detectCircumvention(specText);
        if (check.blocked) {
          return res.status(400).json({
            error: `Communication hors plateforme interdite dans les spécifications (${check.reasons.join(', ')}). Utilisez uniquement la messagerie sécurisée SIMCOVA.`,
          });
        }
      }

      const mode: PaymentMode =
        paymentMode && ['full', 'deposit', 'quote', 'bank_transfer'].includes(paymentMode) ? paymentMode : 'full';

      const rules = getRulesMap();
      const settings = getPlatformSettings();
      const allSupportedMethods: PaymentMethodId[] = [
        'jumia_card',
        'mobile_money_orange',
        'mobile_money_mtn',
        'mobile_money_wave',
        'jumia_wallet',
      ];
      const allowedMethods = rules['RG-08']?.enabled
        ? ((rules['RG-08']?.valueJson?.methods as PaymentMethodId[]) ?? ['jumia_card', 'mobile_money_orange'])
        : allSupportedMethods;
      const defaultFlatFee = Number((rules['RG-09']?.valueJson?.defaultFlatFee as number) ?? 2000);
      const zoneDefaults = (rules['RG-09']?.valueJson?.zones as DeliveryZoneFee[] | undefined) ?? [];
      const expirationHours = Number((rules['RG-10']?.valueJson?.expirationHours as number) ?? 48);

      const productRows = db
        .prepare(
          `SELECT p.*, u.status as vendor_status, c.active as cat_active, c.forbidden as cat_forbidden
           FROM products p
           JOIN users u ON u.id = p.vendor_id
           JOIN categories c ON c.id = p.category_id
           WHERE p.status = 'publie' AND u.status != 'suspendu' AND u.status != 'rejete' AND c.active = 1 AND c.forbidden = 0`
        )
        .all() as Array<Record<string, unknown>>;
      const productsById = new Map<string, Product>();
      for (const r of productRows) {
        const p = mapProductRow(r);
        productsById.set(p.id, p);
      }

      const zoneId = deliveryZone || 'abidjan';
      const resolvedPaymentMethod = paymentMethod || allowedMethods[0];
      const calc = calculateOrderTotals({
        lines: items,
        productsById,
        deliveryZoneId: zoneId,
        defaultDeliveryFee: defaultFlatFee,
        zoneDefaults,
        allowedPaymentMethods: allowedMethods,
        requestedPaymentMethod: resolvedPaymentMethod,
        paymentMode: mode,
        commissionRatePercent: settings.commissionRatePercent,
        vatRatePercent: settings.vatRatePercent,
      });
      // Buyer pays the VAT-inclusive grand total (equals totalAmount when VAT is 0).
      let payableAmount = calc.grandTotal;

      // Optional promo code: validated server-side, discount capped at TTC before discount
      let appliedPromo: { code: string; discount: number } | null = null;
      if (promoCode?.trim()) {
        const normalized = promoCode.trim().toUpperCase();
        const promoRow = db.prepare('SELECT * FROM promo_codes WHERE code = ?').get(normalized) as
          | Record<string, unknown>
          | undefined;
        if (!promoRow || !Number(promoRow.active)) {
          return res.status(400).json({ error: 'Code promotionnel inconnu ou désactivé.' });
        }
        if (promoRow.expires_at && Date.now() > Date.parse(String(promoRow.expires_at))) {
          return res.status(400).json({ error: 'Ce code promotionnel a expiré.' });
        }
        if (Number(promoRow.min_order_amount) > calc.grandTotalBeforeDiscount) {
          return res.status(400).json({
            error: `Ce code s’applique à partir de ${Number(promoRow.min_order_amount)} FCFA d’achat.`,
          });
        }
        if (promoRow.max_uses !== null && Number(promoRow.used_count) >= Number(promoRow.max_uses)) {
          return res.status(400).json({ error: 'Ce code promotionnel a atteint sa limite d’utilisation.' });
        }
        const discount =
          String(promoRow.discount_type) === 'percent'
            ? Math.round((calc.grandTotalBeforeDiscount * Math.min(100, Number(promoRow.discount_value))) / 100)
            : Math.min(Number(promoRow.discount_value), calc.grandTotalBeforeDiscount);
        appliedPromo = { code: normalized, discount };
        db.prepare('UPDATE promo_codes SET used_count = used_count + 1 WHERE code = ?').run(normalized);
        calc.discountAmount = discount;
        calc.grandTotal = calc.grandTotalBeforeDiscount - discount;
        payableAmount = calc.grandTotal;
      }

      const uniqueShopIds = [...new Set(calc.resolvedLines.map((l) => l.shopId))];
      const vendorBankDetails: VendorBankCoordinate[] = [];
      let allShopsHaveBank = uniqueShopIds.length > 0;
      let primaryShopRow: Record<string, unknown> | undefined;

      for (const sId of uniqueShopIds) {
        const sRow = db.prepare('SELECT * FROM shops WHERE id = ?').get(sId) as Record<string, unknown> | undefined;
        if (!primaryShopRow && sRow) primaryShopRow = sRow;
        const bank = sRow ? extractBankDetails(sRow) : null;
        if (!bank || !sRow) {
          allShopsHaveBank = false;
        } else {
          vendorBankDetails.push({
            shopId: String(sRow.id),
            shopName: String(sRow.name),
            bankDetails: bank,
          });
        }
      }

      const breakdown = computePaymentBreakdown({
        totalAmount: payableAmount,
        paymentMode: mode,
        depositPercent: settings.defaultDepositPercent,
        hasCustomOffer: calc.hasCustomOffer,
        bankTransferThreshold: settings.bankTransferThreshold,
        sellerHasBankDetails: allShopsHaveBank,
      });
      if (!breakdown.valid) {
        return res.status(400).json({ error: breakdown.reason });
      }

      const orderId = `ord-${crypto.randomUUID().slice(0, 8)}`;
      const orderNumber = generateUniqueOrderNumber();
      const now = new Date().toISOString();
      const expiresAt = mode === 'quote' ? null : new Date(Date.now() + expirationHours * 3600_000).toISOString();

      // Create a mandatory on-platform messaging thread automatically for custom quotes and high-value bank transfers
      let quoteThreadId: string | null = null;
      let quoteThreadToken: string | null = null;
      let quoteThreadUrl: string | null = null;
      if ((mode === 'quote' || mode === 'bank_transfer') && primaryShopRow) {
        quoteThreadId = `thr-${crypto.randomUUID().slice(0, 8)}`;
        const firstLine = calc.resolvedLines[0];
        const specsSummary = calc.resolvedLines
          .filter((l) => l.customSpecs)
          .map(
            (l) =>
              `• ${l.productTitle} (x${l.quantity})${l.customSpecs?.dimensions ? ` — Dimensions: ${l.customSpecs.dimensions}` : ''}${l.customSpecs?.technicalSpecs ? ` — Spécificités: ${l.customSpecs.technicalSpecs}` : ''}${l.customSpecs?.notes ? ` — Notes: ${l.customSpecs.notes}` : ''}`
          )
          .join('\n');
        const openingBody =
          mode === 'quote'
            ? `Demande de devis sur mesure (${orderNumber}) — Montant indicatif ${calc.totalAmount} ${settings.currency}.\n${specsSummary || 'Détails personnalisés joints à la commande.'}`
            : `Commande par virement bancaire (${orderNumber}) — Montant total ${calc.totalAmount} ${settings.currency}.${bankTransferRef?.trim() ? ` Réf. acheteur : ${bankTransferRef.trim()}.` : ''} Merci de confirmer la réception des fonds et le planning d’expédition ici même.`;

        db.prepare(`
          INSERT INTO messages (id, thread_id, product_id, shop_id, vendor_id, buyer_name, buyer_email, thread_token_version, sender_role, body, read_by_vendor, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'buyer', ?, 0, ?)
        `).run(
          `msg-${crypto.randomUUID().slice(0, 8)}`,
          quoteThreadId,
          firstLine.productId,
          String(primaryShopRow.id),
          String(primaryShopRow.vendor_id),
          buyerName.trim(),
          buyerEmail.trim().toLowerCase(),
          openingBody,
          now
        );
        quoteThreadToken = signMessageThreadToken(quoteThreadId, 1);
        quoteThreadUrl = `${getBaseUrl(req)}/?fil=${encodeURIComponent(quoteThreadToken)}`;
      }

      const storedPaymentMethod =
        mode === 'quote' ? 'quote' : mode === 'bank_transfer' ? 'bank_transfer' : resolvedPaymentMethod;

      db.prepare(`
        INSERT INTO orders (
          id, order_number, buyer_name, buyer_email, buyer_phone, shipping_address, delivery_zone,
          subtotal, delivery_total, total_amount, vat_amount, commission_amount, promo_code, discount_amount, payment_method, payment_status, payment_mode,
          deposit_percent, paid_amount, balance_due, has_custom_offer, bank_transfer_ref, quote_thread_id,
          tracking_token_version, expires_at, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, 0, ?, ?, ?, ?, 1, ?, ?)
      `).run(
        orderId,
        orderNumber,
        buyerName.trim(),
        buyerEmail.trim().toLowerCase(),
        buyerPhone?.trim() || null,
        shippingAddress.trim(),
        zoneId,
        calc.subtotal,
        calc.deliveryTotal,
        calc.totalAmount,
        calc.vatAmount,
        calc.commissionAmount,
        appliedPromo?.code || null,
        appliedPromo?.discount || 0,
        storedPaymentMethod,
        mode,
        breakdown.depositPercentApplied,
        payableAmount,
        calc.hasCustomOffer ? 1 : 0,
        bankTransferRef?.trim() || null,
        quoteThreadId,
        expiresAt,
        now
      );

      const initialItemStatus: OrderEventStatus =
        mode === 'quote' ? 'devis_demande' : mode === 'bank_transfer' ? 'en_attente_virement' : 'en_attente_paiement';

      const insertItem = db.prepare(`
        INSERT INTO order_items (id, order_id, product_id, variant_id, vendor_id, product_title, variant_label, quantity, unit_price, delivery_fee, item_status, custom_specs_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const line of calc.resolvedLines) {
        insertItem.run(
          `oi-${crypto.randomUUID().slice(0, 8)}`,
          orderId,
          line.productId,
          line.variantId,
          line.vendorId,
          line.productTitle,
          line.variantLabel,
          line.quantity,
          line.unitPrice,
          line.deliveryFee,
          initialItemStatus,
          line.customSpecs ? JSON.stringify(line.customSpecs) : null
        );
      }

      db.prepare('INSERT INTO order_events (id, order_id, status, note, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        `ev-${crypto.randomUUID().slice(0, 8)}`,
        orderId,
        'creee',
        'Commande enregistrée sans compte acheteur.',
        buyerName.trim(),
        now
      );

      const trackingToken = signOrderTrackingToken(orderId, 1);
      const trackingUrl = `${getBaseUrl(req)}/?suivi=${encodeURIComponent(trackingToken)}`;

      if (mode === 'quote') {
        db.prepare('INSERT INTO order_events (id, order_id, status, note, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
          `ev-${crypto.randomUUID().slice(0, 8)}`,
          orderId,
          'devis_demande',
          'Demande de devis sur mesure transmise au vendeur via la messagerie sécurisée SIMCOVA.',
          buyerName.trim(),
          now
        );

        if (primaryShopRow) {
          queueTransactionalEmail({
            toEmail: String(primaryShopRow.contact_email),
            subject: `SIMCOVA — Nouvelle demande de devis sur mesure (${orderNumber})`,
            bodyText: `${buyerName.trim()} a soumis une offre personnalisée (${calc.totalAmount} ${settings.currency}). Répondez exclusivement depuis votre espace vendeur SIMCOVA.`,
            actionUrl: null,
            actionLabel: null,
          });
        }
        queueTransactionalEmail({
          toEmail: buyerEmail.trim().toLowerCase(),
          subject: `SIMCOVA — Demande de devis ${orderNumber} transmise`,
          bodyText: `Votre demande sur mesure a été ouverte. Échangez obligatoirement avec le vendeur sur notre messagerie sécurisée pour finaliser le tarif et la livraison.`,
          actionUrl: quoteThreadUrl || trackingUrl,
          actionLabel: 'Ouvrir mon fil de discussion SIMCOVA',
        });

        return res.status(201).json({
          order: {
            id: orderId,
            orderNumber,
            buyerName: buyerName.trim(),
            buyerEmail: buyerEmail.trim().toLowerCase(),
            subtotal: calc.subtotal,
            deliveryTotal: calc.deliveryTotal,
            totalAmount: calc.totalAmount,
            vatAmount: calc.vatAmount,
            grandTotal: calc.grandTotal,
            commissionAmount: calc.commissionAmount,
            discountAmount: calc.discountAmount,
            promoCode: appliedPromo?.code || null,
            paymentMethod: 'quote',
            paymentStatus: 'pending',
            paymentMode: 'quote',
            depositPercent: 0,
            paidAmount: 0,
            balanceDue: payableAmount,
            hasCustomOffer: true,
            quoteThreadToken,
            expiresAt: null,
            createdAt: now,
          },
          trackingToken,
          trackingUrl,
          quoteThreadToken,
          quoteThreadUrl,
          paymentSession: null,
        });
      }

      if (mode === 'bank_transfer') {
        db.prepare('INSERT INTO order_events (id, order_id, status, note, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
          `ev-${crypto.randomUUID().slice(0, 8)}`,
          orderId,
          'en_attente_virement',
          `Coordonnées bancaires du vendeur communiquées pour un virement de ${calc.totalAmount} ${settings.currency}. En attente de validation du virement.`,
          'SIMCOVA Paiement Bancaire',
          now
        );

        const bankSummary = vendorBankDetails
          .map((v) => `${v.shopName} — ${v.bankDetails.bankName} / IBAN: ${v.bankDetails.iban} (Titulaire: ${v.bankDetails.accountHolder})`)
          .join('\n');

        queueTransactionalEmail({
          toEmail: buyerEmail.trim().toLowerCase(),
          subject: `SIMCOVA — Coordonnées bancaires pour votre commande ${orderNumber}`,
          bodyText: `Effectuez le virement de ${calc.totalAmount} ${settings.currency} avec la référence ${orderNumber} :\n${bankSummary}\nFinalisez ensuite la coordination sur votre fil sécurisé SIMCOVA.`,
          actionUrl: trackingUrl,
          actionLabel: 'Voir ma commande et les coordonnées bancaires',
        });

        return res.status(201).json({
          order: {
            id: orderId,
            orderNumber,
            buyerName: buyerName.trim(),
            buyerEmail: buyerEmail.trim().toLowerCase(),
            subtotal: calc.subtotal,
            deliveryTotal: calc.deliveryTotal,
            totalAmount: calc.totalAmount,
            vatAmount: calc.vatAmount,
            grandTotal: calc.grandTotal,
            commissionAmount: calc.commissionAmount,
            discountAmount: calc.discountAmount,
            promoCode: appliedPromo?.code || null,
            paymentMethod: 'bank_transfer',
            paymentStatus: 'pending',
            paymentMode: 'bank_transfer',
            depositPercent: 0,
            paidAmount: 0,
            balanceDue: payableAmount,
            hasCustomOffer: calc.hasCustomOffer,
            bankTransferRef: bankTransferRef?.trim() || null,
            quoteThreadToken,
            vendorBankDetails,
            expiresAt,
            createdAt: now,
          },
          trackingToken,
          trackingUrl,
          quoteThreadToken,
          quoteThreadUrl,
          vendorBankDetails,
          paymentSession: null,
        });
      }

      const eventNote =
        mode === 'deposit'
          ? `Session Jumia Africa ouverte pour l’acompte (${breakdown.depositPercentApplied}% = ${breakdown.upfrontAmount} ${settings.currency}). Solde à la livraison : ${breakdown.balanceDue} ${settings.currency}.`
          : `Session de paiement Jumia Africa ouverte (${breakdown.upfrontAmount} ${settings.currency}).`;

      db.prepare('INSERT INTO order_events (id, order_id, status, note, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        `ev-${crypto.randomUUID().slice(0, 8)}`,
        orderId,
        'en_attente_paiement',
        eventNote,
        'Jumia Africa API',
        now
      );

      const session = await jumiaAfricaProvider.initiateSession({
        orderId,
        orderNumber,
        amount: breakdown.upfrontAmount,
        currency: settings.currency,
        method: resolvedPaymentMethod,
        buyerEmail: buyerEmail.trim().toLowerCase(),
        buyerName: buyerName.trim(),
        returnUrl: trackingUrl,
      });

      db.prepare(`
        INSERT INTO payments (id, order_id, provider, provider_ref, method, amount, status, webhook_events_json, created_at, updated_at)
        VALUES (?, ?, 'jumia_africa', ?, ?, ?, 'pending', '[]', ?, ?)
      `).run(
        `pay-${crypto.randomUUID().slice(0, 8)}`,
        orderId,
        session.providerRef,
        resolvedPaymentMethod,
        breakdown.upfrontAmount,
        now,
        now
      );

      res.status(201).json({
        order: {
          id: orderId,
          orderNumber,
          buyerName: buyerName.trim(),
          buyerEmail: buyerEmail.trim().toLowerCase(),
          subtotal: calc.subtotal,
          deliveryTotal: calc.deliveryTotal,
          totalAmount: calc.totalAmount,
          vatAmount: calc.vatAmount,
          grandTotal: calc.grandTotal,
          commissionAmount: calc.commissionAmount,
          discountAmount: calc.discountAmount,
          promoCode: appliedPromo?.code || null,
          paymentMethod: resolvedPaymentMethod,
          paymentStatus: 'pending',
          paymentMode: mode,
          depositPercent: breakdown.depositPercentApplied,
          paidAmount: 0,
          balanceDue: payableAmount,
          hasCustomOffer: calc.hasCustomOffer,
          expiresAt,
          createdAt: now,
        },
        trackingToken,
        trackingUrl,
        paymentSession: session,
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Erreur lors de la création de commande.' });
    }
  });

  function applyJumiaWebhookOutcome(params: {
    providerRef: string;
    status: 'paid' | 'failed' | 'cancelled' | 'refunded';
    amount: number;
    rawEvent: Record<string, unknown>;
    baseUrl: string;
  }): { ok: boolean; error?: string; orderNumber?: string; trackingToken?: string } {
    const payRow = db.prepare('SELECT * FROM payments WHERE provider_ref = ?').get(params.providerRef) as
      | Record<string, unknown>
      | undefined;
    if (!payRow) return { ok: false, error: 'Transaction introuvable.' };

    const orderRow = db.prepare('SELECT * FROM orders WHERE id = ?').get(String(payRow.order_id)) as
      | Record<string, unknown>
      | undefined;
    if (!orderRow) return { ok: false, error: 'Commande introuvable.' };

    // EXF-504: Verify exact server-side expected payment session amount (covers full or deposit)
    if (Number(payRow.amount) !== Number(params.amount)) {
      return { ok: false, error: 'Discordance de montant détectée côté serveur.' };
    }

    // Buyer-side payable base includes VAT when configured (0 by default keeps HT semantics).
    const payableBase = Number(orderRow.total_amount) + Number(orderRow.vat_amount ?? 0);

    const trackingToken = signOrderTrackingToken(String(orderRow.id), Number(orderRow.tracking_token_version));
    const trackingUrl = `${params.baseUrl}/?suivi=${encodeURIComponent(trackingToken)}`;

    // Guard against terminal order states (RG-10 expiration, refund, or idempotent paid webhook replay)
    if (orderRow.payment_status === 'expired') {
      return { ok: false, error: 'Cette commande a expiré (RG-10) et ne peut plus être payée.' };
    }
    if (orderRow.payment_status === 'refunded') {
      return { ok: false, error: 'Cette commande a déjà été remboursée.' };
    }
    if (orderRow.payment_status === 'paid' && params.status === 'paid') {
      return { ok: true, orderNumber: String(orderRow.order_number), trackingToken };
    }

    const now = new Date().toISOString();
    const eventsHistory = JSON.parse(String(payRow.webhook_events_json || '[]')) as unknown[];
    eventsHistory.push({ ...params.rawEvent, receivedAt: now });

    const newPaymentStatus =
      params.status === 'paid'
        ? 'paid'
        : params.status === 'refunded'
          ? 'refunded'
          : 'failed';

    db.prepare('UPDATE payments SET status = ?, webhook_events_json = ?, updated_at = ? WHERE id = ?').run(
      newPaymentStatus,
      JSON.stringify(eventsHistory),
      now,
      String(payRow.id)
    );

    if (params.status === 'paid') {
      const paidAmount = Number(payRow.amount);
      const balanceDue = Math.max(0, payableBase - paidAmount);
      const isDeposit = String(orderRow.payment_mode || 'full') === 'deposit' && balanceDue > 0;
      const itemStatus: OrderEventStatus = isDeposit ? 'acompte_paye' : 'payee';
      const eventStatus: OrderEventStatus = isDeposit ? 'acompte_paye' : 'payee';
      const eventNote = isDeposit
        ? `Acompte confirmé via Jumia Africa (${paidAmount} FCFA, Réf. ${params.providerRef}). Solde restant à payer à la livraison : ${balanceDue} FCFA.`
        : `Paiement intégral confirmé via Jumia Africa (Réf. ${params.providerRef}).`;

      db.prepare('UPDATE orders SET payment_status = ?, paid_amount = ?, balance_due = ? WHERE id = ?').run(
        'paid',
        paidAmount,
        balanceDue,
        String(orderRow.id)
      );
      db.prepare('UPDATE order_items SET item_status = ? WHERE order_id = ?').run(itemStatus, String(orderRow.id));
      db.prepare('INSERT INTO order_events (id, order_id, status, note, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        `ev-${crypto.randomUUID().slice(0, 8)}`,
        String(orderRow.id),
        eventStatus,
        eventNote,
        'Jumia Africa Webhook',
        now
      );

      decrementOrderStock(String(orderRow.id), now);

      queueTransactionalEmail({
        toEmail: String(orderRow.buyer_email),
        subject: `SIMCOVA — Confirmation ${isDeposit ? 'd’acompte' : 'de commande'} ${String(orderRow.order_number)}`,
        bodyText: isDeposit
          ? `Merci ${String(orderRow.buyer_name)} ! Votre acompte de ${paidAmount} FCFA a été confirmé. Le solde de ${balanceDue} FCFA sera réglé à la livraison.`
          : `Merci ${String(orderRow.buyer_name)} ! Votre paiement de ${orderRow.total_amount} FCFA a été confirmé. Conservez votre lien personnel ci-dessous pour suivre votre commande à tout moment.`,
        actionUrl: trackingUrl,
        actionLabel: 'Suivre ma commande',
      });
    } else if (params.status === 'failed' || params.status === 'cancelled') {
      // EXF-505: Payment declined or abandoned — keep order recoverable with retry link until RG-10 expiration
      db.prepare("UPDATE orders SET payment_status = 'pending' WHERE id = ?").run(String(orderRow.id));
      db.prepare('INSERT INTO order_events (id, order_id, status, note, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        `ev-${crypto.randomUUID().slice(0, 8)}`,
        String(orderRow.id),
        'en_attente_paiement',
        params.status === 'cancelled'
          ? 'Paiement interrompu par l’acheteur. Lien de reprise envoyé.'
          : 'Paiement refusé par l’opérateur. Vous pouvez réessayer depuis votre lien de suivi.',
        'Jumia Africa Webhook',
        now
      );
      queueTransactionalEmail({
        toEmail: String(orderRow.buyer_email),
        subject: `SIMCOVA — Finalisez le paiement de votre commande ${String(orderRow.order_number)}`,
        bodyText: `Votre paiement n’a pas abouti. Cliquez sur le lien ci-dessous pour reprendre votre règlement avant expiration.`,
        actionUrl: trackingUrl,
        actionLabel: 'Reprendre le paiement',
      });
    }

    return { ok: true, orderNumber: String(orderRow.order_number), trackingToken };
  }

  // Signed webhook endpoint from Jumia Africa PSP (EXF-503 / EXF-504)
  router.post('/payments/jumia/webhook', (req: RawBodyReq, res) => {
    const signature = req.headers['x-jumia-signature'] as string | undefined;
    // HMAC must be verified against the exact raw bytes received — re-serializing a parsed
    // body is fragile (key order/unicode escaping). server.ts captures req.rawBody for us.
    const rawBody = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body);
    const verified = jumiaAfricaProvider.verifyWebhook(rawBody, signature);
    if (!verified) {
      return res.status(401).json({ error: 'Signature webhook Jumia Africa invalide.' });
    }
    const result = applyJumiaWebhookOutcome({
      providerRef: verified.providerRef,
      status: verified.status,
      amount: verified.amount,
      rawEvent: verified.rawEvent,
      baseUrl: getBaseUrl(req),
    });
    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }
    res.json({ received: true, orderNumber: result.orderNumber });
  });

  // Sandbox gateway execution helper (generates a real HMAC-signed webhook event in sandbox mode)
  router.post('/payments/jumia/sandbox-complete', (req, res) => {
    const { providerRef, outcome } = req.body as {
      providerRef?: string;
      outcome?: 'paid' | 'failed' | 'cancelled';
    };
    if (!providerRef || !outcome) {
      return res.status(400).json({ error: 'Référence et issue requises.' });
    }
    const payRow = db.prepare('SELECT * FROM payments WHERE provider_ref = ?').get(providerRef) as
      | Record<string, unknown>
      | undefined;
    if (!payRow) {
      return res.status(404).json({ error: 'Session de paiement Jumia Africa introuvable.' });
    }

    const payload = {
      providerRef,
      status: outcome,
      amount: Number(payRow.amount),
      environment: 'sandbox',
    };
    const sig = jumiaAfricaProvider.signSandboxWebhook(payload);
    const verified = jumiaAfricaProvider.verifyWebhook(JSON.stringify(payload), sig);
    if (!verified) {
      return res.status(500).json({ error: 'Échec de vérification interne du webhook sandbox.' });
    }

    const result = applyJumiaWebhookOutcome({
      providerRef: verified.providerRef,
      status: verified.status,
      amount: verified.amount,
      rawEvent: verified.rawEvent,
      baseUrl: getBaseUrl(req),
    });
    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }
    res.json({
      processed: true,
      outcome,
      orderNumber: result.orderNumber,
      trackingToken: result.trackingToken,
    });
  });

  // Guest Order Tracking Page API (EXF-405, EXF-406, EXF-408)
  router.get('/orders/track/:token', (req, res) => {
    const decoded = verifyOrderTrackingToken(req.params.token);
    if (!decoded) {
      return res.status(401).json({ error: 'Lien de suivi invalide ou expiré.' });
    }
    const orderRow = db.prepare('SELECT * FROM orders WHERE id = ?').get(decoded.orderId) as
      | Record<string, unknown>
      | undefined;
    if (!orderRow || Number(orderRow.tracking_token_version) !== decoded.version) {
      return res.status(401).json({ error: 'Ce lien de suivi a été révoqué ou remplacé.' });
    }

    // RG-10 automatic expiration check (shared with the periodic maintenance sweep)
    expireOrderIfDue(orderRow);

    const items = db
      .prepare(
        `SELECT oi.*, p.media_json, s.id as shop_id, s.name as shop_name, s.slug as shop_slug,
          (SELECT id FROM reviews r WHERE r.order_id = oi.order_id AND r.product_id = oi.product_id LIMIT 1) as existing_review_id
         FROM order_items oi
         JOIN products p ON p.id = oi.product_id
         JOIN shops s ON s.id = p.shop_id
         WHERE oi.order_id = ?`
      )
      .all(decoded.orderId)
      .map((it: Record<string, unknown>) => ({
        id: String(it.id),
        orderId: String(it.order_id),
        productId: String(it.product_id),
        vendorId: String(it.vendor_id),
        productTitle: String(it.product_title),
        variantLabel: it.variant_label ? String(it.variant_label) : null,
        quantity: Number(it.quantity),
        unitPrice: Number(it.unit_price),
        deliveryFee: Number(it.delivery_fee),
        carrier: it.carrier ? String(it.carrier) : null,
        trackingNumber: it.tracking_number ? String(it.tracking_number) : null,
        itemStatus: String(it.item_status),
        shopId: String(it.shop_id),
        shopName: String(it.shop_name),
        shopSlug: String(it.shop_slug),
        alreadyReviewed: Boolean(it.existing_review_id),
        media: JSON.parse(String(it.media_json || '[]')),
        customSpecs: it.custom_specs_json ? JSON.parse(String(it.custom_specs_json)) : null,
      }));

    const events = db
      .prepare('SELECT * FROM order_events WHERE order_id = ? ORDER BY created_at ASC')
      .all(decoded.orderId)
      .map((ev: Record<string, unknown>) => ({
        id: String(ev.id),
        orderId: String(ev.order_id),
        status: String(ev.status) as OrderEventStatus,
        note: String(ev.note),
        actor: String(ev.actor),
        createdAt: String(ev.created_at),
      }));

    const payment = db.prepare('SELECT provider_ref, method, status, amount FROM payments WHERE order_id = ?').get(decoded.orderId);
    const settings = getPlatformSettings();
    const orderMode = String(orderRow.payment_mode || 'full') as PaymentMode;

    const vendorBankDetails: VendorBankCoordinate[] = [];
    if (orderMode === 'bank_transfer' || Number(orderRow.total_amount) >= settings.bankTransferThreshold) {
      const seenShops = new Set<string>();
      for (const it of items) {
        if (seenShops.has(it.shopId)) continue;
        seenShops.add(it.shopId);
        const sRow = db.prepare('SELECT * FROM shops WHERE id = ?').get(it.shopId) as Record<string, unknown> | undefined;
        const bank = sRow ? extractBankDetails(sRow) : null;
        if (bank && sRow) {
          vendorBankDetails.push({
            shopId: String(sRow.id),
            shopName: String(sRow.name),
            bankDetails: bank,
          });
        }
      }
    }

    const quoteThreadToken = orderRow.quote_thread_id
      ? signMessageThreadToken(String(orderRow.quote_thread_id), 1)
      : null;

    res.json({
      order: {
        id: String(orderRow.id),
        orderNumber: String(orderRow.order_number),
        buyerName: String(orderRow.buyer_name),
        buyerEmail: String(orderRow.buyer_email),
        buyerPhone: orderRow.buyer_phone ? String(orderRow.buyer_phone) : null,
        shippingAddress: String(orderRow.shipping_address),
        deliveryZone: String(orderRow.delivery_zone),
        subtotal: Number(orderRow.subtotal),
        deliveryTotal: Number(orderRow.delivery_total),
        totalAmount: Number(orderRow.total_amount),
        vatAmount: Number(orderRow.vat_amount ?? 0),
        grandTotal: Number(orderRow.total_amount) + Number(orderRow.vat_amount ?? 0),
        commissionAmount: Number(orderRow.commission_amount ?? 0),
        paymentMethod: String(orderRow.payment_method),
        paymentStatus: String(orderRow.payment_status),
        paymentMode: orderMode,
        depositPercent: Number(orderRow.deposit_percent ?? 100),
        paidAmount: Number(orderRow.paid_amount ?? 0),
        balanceDue: Number(orderRow.balance_due ?? 0),
        hasCustomOffer: Boolean(orderRow.has_custom_offer),
        bankTransferRef: orderRow.bank_transfer_ref ? String(orderRow.bank_transfer_ref) : null,
        quoteThreadToken,
        vendorBankDetails,
        expiresAt: orderRow.expires_at ? String(orderRow.expires_at) : null,
        createdAt: String(orderRow.created_at),
      },
      items,
      events,
      payment,
      canReviewProducts: canLeaveReview(events, false).allowed,
    });
  });

  // Buyer initiates payment on a quote order (either full, deposit, or bank_transfer if above threshold)
  router.post('/orders/track/:token/pay-quote', async (req, res) => {
    const decoded = verifyOrderTrackingToken(req.params.token);
    if (!decoded) return res.status(401).json({ error: 'Lien de suivi invalide ou expiré.' });
    const orderRow = db.prepare('SELECT * FROM orders WHERE id = ?').get(decoded.orderId) as Record<string, unknown> | undefined;
    if (!orderRow || Number(orderRow.tracking_token_version) !== decoded.version) {
      return res.status(401).json({ error: 'Jeton révoqué.' });
    }
    if (orderRow.payment_status !== 'pending' || String(orderRow.payment_mode) !== 'quote') {
      return res.status(400).json({ error: 'Cette commande n’est pas un devis en attente de règlement.' });
    }

    const { targetMode, paymentMethod, bankTransferRef } = req.body as {
      targetMode?: 'full' | 'deposit' | 'bank_transfer';
      paymentMethod?: PaymentMethodId;
      bankTransferRef?: string;
    };
    const nextMode = targetMode || 'full';
    const settings = getPlatformSettings();
    // Payable amount is VAT-inclusive (equals HT total when VAT is disabled).
    const totalAmount = Number(orderRow.total_amount) + Number(orderRow.vat_amount ?? 0);

    const shopRows = db
      .prepare('SELECT DISTINCT s.* FROM order_items oi JOIN products p ON p.id = oi.product_id JOIN shops s ON s.id = p.shop_id WHERE oi.order_id = ?')
      .all(decoded.orderId) as Array<Record<string, unknown>>;
    const allHaveBank = shopRows.length > 0 && shopRows.every((s) => Boolean(extractBankDetails(s)));

    const breakdown = computePaymentBreakdown({
      totalAmount,
      paymentMode: nextMode,
      depositPercent: settings.defaultDepositPercent,
      hasCustomOffer: Boolean(orderRow.has_custom_offer),
      bankTransferThreshold: settings.bankTransferThreshold,
      sellerHasBankDetails: allHaveBank,
    });
    if (!breakdown.valid) {
      return res.status(400).json({ error: breakdown.reason });
    }

    const now = new Date().toISOString();
    if (nextMode === 'bank_transfer') {
      db.prepare("UPDATE orders SET payment_mode = 'bank_transfer', payment_method = 'bank_transfer', bank_transfer_ref = ? WHERE id = ?").run(
        bankTransferRef?.trim() || null,
        decoded.orderId
      );
      db.prepare("UPDATE order_items SET item_status = 'en_attente_virement' WHERE order_id = ?").run(decoded.orderId);
      db.prepare('INSERT INTO order_events (id, order_id, status, note, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        `ev-${crypto.randomUUID().slice(0, 8)}`,
        decoded.orderId,
        'en_attente_virement',
        `Devis validé pour règlement par virement bancaire (${totalAmount} ${settings.currency}).`,
        String(orderRow.buyer_name),
        now
      );
      return res.json({ updated: true, paymentSession: null });
    }

    const method = paymentMethod || 'mobile_money_orange';
    const trackingUrl = `${getBaseUrl(req)}/?suivi=${encodeURIComponent(req.params.token)}`;
    const session = await jumiaAfricaProvider.initiateSession({
      orderId: decoded.orderId,
      orderNumber: String(orderRow.order_number),
      amount: breakdown.upfrontAmount,
      currency: settings.currency,
      method,
      buyerEmail: String(orderRow.buyer_email),
      buyerName: String(orderRow.buyer_name),
      returnUrl: trackingUrl,
    });

    db.prepare('UPDATE orders SET payment_mode = ?, payment_method = ?, deposit_percent = ? WHERE id = ?').run(
      nextMode,
      method,
      breakdown.depositPercentApplied,
      decoded.orderId
    );
    db.prepare("UPDATE order_items SET item_status = 'en_attente_paiement' WHERE order_id = ?").run(decoded.orderId);
    db.prepare(`
      INSERT INTO payments (id, order_id, provider, provider_ref, method, amount, status, webhook_events_json, created_at, updated_at)
      VALUES (?, ?, 'jumia_africa', ?, ?, ?, 'pending', '[]', ?, ?)
    `).run(`pay-${crypto.randomUUID().slice(0, 8)}`, decoded.orderId, session.providerRef, method, breakdown.upfrontAmount, now, now);

    db.prepare('INSERT INTO order_events (id, order_id, status, note, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      `ev-${crypto.randomUUID().slice(0, 8)}`,
      decoded.orderId,
      'en_attente_paiement',
      `Session Jumia Africa ouverte suite au devis (${breakdown.upfrontAmount} ${settings.currency}).`,
      String(orderRow.buyer_name),
      now
    );

    res.json({ updated: true, paymentSession: session });
  });

  // EXF-408: Regenerate / rotate tracking token on demand
  router.post('/orders/track/:token/regenerate', (req, res) => {
    const decoded = verifyOrderTrackingToken(req.params.token);
    if (!decoded) return res.status(401).json({ error: 'Jeton de suivi invalide.' });
    const orderRow = db.prepare('SELECT * FROM orders WHERE id = ?').get(decoded.orderId) as
      | Record<string, unknown>
      | undefined;
    if (!orderRow || Number(orderRow.tracking_token_version) !== decoded.version) {
      return res.status(401).json({ error: 'Jeton révoqué.' });
    }
    const nextVersion = Number(orderRow.tracking_token_version) + 1;
    db.prepare('UPDATE orders SET tracking_token_version = ? WHERE id = ?').run(nextVersion, String(orderRow.id));
    const newToken = signOrderTrackingToken(String(orderRow.id), nextVersion);
    const trackingUrl = `${getBaseUrl(req)}/?suivi=${encodeURIComponent(newToken)}`;

    queueTransactionalEmail({
      toEmail: String(orderRow.buyer_email),
      subject: `SIMCOVA — Nouveau lien de suivi pour ${String(orderRow.order_number)}`,
      bodyText: 'Conformément à votre demande, l’ancien lien a été révoqué. Voici votre nouveau lien sécurisé.',
      actionUrl: trackingUrl,
      actionLabel: 'Ouvrir mon nouveau lien de suivi',
    });

    res.json({ newToken, trackingUrl });
  });

  // EXF-409: Recover orders by email without exposing sensitive order info in HTTP response
  router.post('/orders/recover', rateLimit(10, 60_000), (req, res) => {
    const { email } = req.body as { email?: string };
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({ error: 'Veuillez saisir une adresse électronique valide.' });
    }
    const normalized = email.trim().toLowerCase();
    const orders = db
      .prepare('SELECT id, order_number, tracking_token_version, created_at FROM orders WHERE LOWER(buyer_email) = ? ORDER BY created_at DESC LIMIT 10')
      .all(normalized) as Array<{ id: string; order_number: string; tracking_token_version: number; created_at: string }>;

    if (orders.length > 0) {
      const linksList = orders
        .map((o) => {
          const tok = signOrderTrackingToken(o.id, o.tracking_token_version);
          return `${o.order_number} : ${getBaseUrl(req)}/?suivi=${encodeURIComponent(tok)}`;
        })
        .join('\n');
      const firstTok = signOrderTrackingToken(orders[0].id, orders[0].tracking_token_version);
      queueTransactionalEmail({
        toEmail: normalized,
        subject: 'SIMCOVA — Récupération de vos liens de suivi de commande',
        bodyText: `Voici vos liens de suivi sécurisés :\n${linksList}`,
        actionUrl: `${getBaseUrl(req)}/?suivi=${encodeURIComponent(firstTok)}`,
        actionLabel: 'Voir ma dernière commande',
      });
    }

    res.json({
      sent: true,
      message: 'Si des commandes sont associées à cette adresse électronique, leurs liens de suivi viennent d’être envoyés.',
    });
  });

  // =========================================================================
  // MESSAGING (GUEST <-> VENDOR) & VERIFIED REVIEWS (EXF-601..606)
  // =========================================================================

  router.post('/messages', rateLimit(15, 60_000), (req, res) => {
    const { productId, shopId, buyerName, buyerEmail, body } = req.body as {
      productId?: string;
      shopId?: string;
      buyerName?: string;
      buyerEmail?: string;
      body?: string;
    };
    if (!buyerName?.trim() || !buyerEmail?.trim() || !body?.trim() || !shopId) {
      return res.status(400).json({ error: 'Nom, courriel, boutique et message sont obligatoires.' });
    }
    const circumvention = detectCircumvention(body);
    if (circumvention.blocked) {
      return res.status(400).json({
        error: `Message bloqué (${circumvention.reasons.join(', ')}). Pour votre sécurité, tous les échanges doivent rester exclusivement sur la plateforme SIMCOVA.`,
      });
    }
    const shop = db.prepare('SELECT * FROM shops WHERE id = ?').get(shopId) as Record<string, unknown> | undefined;
    if (!shop) return res.status(404).json({ error: 'Boutique introuvable.' });

    const threadId = `thr-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO messages (id, thread_id, product_id, shop_id, vendor_id, buyer_name, buyer_email, thread_token_version, sender_role, body, read_by_vendor, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'buyer', ?, 0, ?)
    `).run(
      `msg-${crypto.randomUUID().slice(0, 8)}`,
      threadId,
      productId || null,
      shopId,
      String(shop.vendor_id),
      buyerName.trim(),
      buyerEmail.trim().toLowerCase(),
      body.trim(),
      now
    );

    const threadToken = signMessageThreadToken(threadId, 1);
    const threadUrl = `${getBaseUrl(req)}/?fil=${encodeURIComponent(threadToken)}`;

    queueTransactionalEmail({
      toEmail: String(shop.contact_email),
      subject: `SIMCOVA — Nouveau message client de ${buyerName.trim()}`,
      bodyText: body.trim(),
      actionUrl: null,
      actionLabel: null,
    });

    res.status(201).json({
      sent: true,
      threadId,
      threadToken,
      threadUrl,
    });
  });

  router.get('/messages/thread/:token', (req, res) => {
    const decoded = verifyMessageThreadToken(req.params.token);
    if (!decoded) return res.status(401).json({ error: 'Lien de conversation invalide ou expiré.' });

    const blocked = db.prepare('SELECT * FROM blocked_threads WHERE thread_id = ?').get(decoded.threadId);
    const msgs = db
      .prepare(
        `SELECT m.*, s.name as shop_name, p.title as product_title
         FROM messages m
         JOIN shops s ON s.id = m.shop_id
         LEFT JOIN products p ON p.id = m.product_id
         WHERE m.thread_id = ? AND m.hidden_by_moderation = 0
         ORDER BY m.created_at ASC`
      )
      .all(decoded.threadId)
      .map((m: Record<string, unknown>) => ({
        id: String(m.id),
        threadId: String(m.thread_id),
        productId: m.product_id ? String(m.product_id) : null,
        productTitle: m.product_title ? String(m.product_title) : null,
        shopId: String(m.shop_id),
        shopName: String(m.shop_name),
        vendorId: String(m.vendor_id),
        buyerName: String(m.buyer_name),
        buyerEmail: String(m.buyer_email),
        senderRole: String(m.sender_role),
        body: String(m.body),
        createdAt: String(m.created_at),
      }));

    if (msgs.length === 0) return res.status(404).json({ error: 'Fil de discussion introuvable.' });
    res.json({ threadId: decoded.threadId, blocked: Boolean(blocked), messages: msgs });
  });

  router.post('/messages/thread/:token/reply', rateLimit(20, 60_000), (req, res) => {
    const decoded = verifyMessageThreadToken(req.params.token);
    if (!decoded) return res.status(401).json({ error: 'Lien de conversation invalide.' });
    const blocked = db.prepare('SELECT * FROM blocked_threads WHERE thread_id = ?').get(decoded.threadId);
    if (blocked) return res.status(403).json({ error: 'Ce fil de discussion a été bloqué par la modération.' });

    const { body } = req.body as { body?: string };
    if (!body?.trim()) return res.status(400).json({ error: 'Le message ne peut pas être vide.' });
    const circumvention = detectCircumvention(body);
    if (circumvention.blocked) {
      return res.status(400).json({
        error: `Message bloqué (${circumvention.reasons.join(', ')}). Toute communication doit rester obligatoirement sur la plateforme SIMCOVA.`,
      });
    }

    const first = db.prepare('SELECT * FROM messages WHERE thread_id = ? LIMIT 1').get(decoded.threadId) as
      | Record<string, unknown>
      | undefined;
    if (!first) return res.status(404).json({ error: 'Fil introuvable.' });

    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO messages (id, thread_id, product_id, shop_id, vendor_id, buyer_name, buyer_email, thread_token_version, sender_role, body, read_by_vendor, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'buyer', ?, 0, ?)
    `).run(
      `msg-${crypto.randomUUID().slice(0, 8)}`,
      decoded.threadId,
      first.product_id ? String(first.product_id) : null,
      String(first.shop_id),
      String(first.vendor_id),
      String(first.buyer_name),
      String(first.buyer_email),
      Number(first.thread_token_version),
      body.trim(),
      now
    );

    res.status(201).json({ sent: true });
  });

  // EXF-603: Review submission strictly verified against delivered order via tracking token
  router.post('/reviews', (req, res) => {
    const { trackingToken, productId, rating, comment } = req.body as {
      trackingToken?: string;
      productId?: string;
      rating?: number;
      comment?: string;
    };
    if (!trackingToken || !productId || !rating || !comment?.trim()) {
      return res.status(400).json({ error: 'Jeton de suivi, produit, note et commentaire requis.' });
    }
    const decoded = verifyOrderTrackingToken(trackingToken);
    if (!decoded) return res.status(401).json({ error: 'Lien de suivi invalide.' });

    const orderRow = db.prepare('SELECT * FROM orders WHERE id = ?').get(decoded.orderId) as
      | Record<string, unknown>
      | undefined;
    if (!orderRow || Number(orderRow.tracking_token_version) !== decoded.version) {
      return res.status(401).json({ error: 'Lien de suivi révoqué.' });
    }

    const item = db
      .prepare('SELECT * FROM order_items WHERE order_id = ? AND product_id = ?')
      .get(decoded.orderId, productId);
    if (!item) {
      return res.status(403).json({ error: 'Ce produit ne figure pas dans cette commande.' });
    }

    const events = db.prepare('SELECT * FROM order_events WHERE order_id = ?').all(decoded.orderId) as unknown as OrderEvent[];
    const existing = db.prepare('SELECT id FROM reviews WHERE order_id = ? AND product_id = ?').get(decoded.orderId, productId);
    const check = canLeaveReview(events, Boolean(existing));
    if (!check.allowed) {
      return res.status(403).json({ error: check.reason });
    }

    const safeRating = Math.min(5, Math.max(1, Math.round(Number(rating))));
    const revId = `rev-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO reviews (id, product_id, order_id, buyer_name, rating, comment, report_count, moderation_status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, 'visible', ?)
    `).run(revId, productId, decoded.orderId, String(orderRow.buyer_name), safeRating, comment.trim(), now);

    res.status(201).json({ id: revId, created: true });
  });

  // =========================================================================
  // VENDOR WORKSPACE (ADMIN-VENDOR & THIRD-PARTY VENDORS, EXF-301..311)
  // =========================================================================

  router.post('/uploads', requireAuth, (req: AuthReq, res) => {
    const { dataUrl, fileName } = req.body as { dataUrl?: string; fileName?: string };
    if (!dataUrl || typeof dataUrl !== 'string') {
      return res.status(400).json({ error: 'Fichier média requis.' });
    }
    const match = /^data:(image\/(?:png|jpeg|webp|gif)|video\/(?:mp4|webm));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!match) {
      return res.status(400).json({ error: 'Format média non supporté (PNG, JPEG, WebP, MP4, WebM uniquement).' });
    }
    const mime = match[1];
    const buf = Buffer.from(match[2], 'base64');
    if (buf.length > 6 * 1024 * 1024) {
      return res.status(400).json({ error: 'Le fichier dépasse la limite de 6 Mo.' });
    }
    const ext = mime.split('/')[1].replace('jpeg', 'jpg');
    const safeBase = slugify(path.basename(fileName || 'media', path.extname(fileName || ''))) || 'media';
    const outName = `${safeBase}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}.${ext}`;
    const resolved = path.resolve(UPLOADS_PATH, outName);
    if (!resolved.startsWith(UPLOADS_PATH + path.sep)) {
      return res.status(400).json({ error: 'Chemin invalide.' });
    }
    fs.writeFileSync(resolved, buf);
    res.status(201).json({ url: `/api/uploads/${outName}`, mime });
  });

  router.get('/vendor/dashboard', requireAuth, (req: AuthReq, res) => {
    const vendorId = req.authUser!.id;
    const shopRow = db.prepare('SELECT * FROM shops WHERE vendor_id = ?').get(vendorId) as Record<string, unknown> | undefined;
    const shop = mapShopRow(shopRow);
    const products = db
      .prepare(
        `SELECT p.*, c.name as category_name,
          COALESCE((SELECT AVG(r.rating) FROM reviews r WHERE r.product_id = p.id AND r.moderation_status = 'visible'), 0) as rating_average,
          COALESCE((SELECT COUNT(r.id) FROM reviews r WHERE r.product_id = p.id AND r.moderation_status = 'visible'), 0) as review_count
         FROM products p JOIN categories c ON c.id = p.category_id
         WHERE p.vendor_id = ? ORDER BY p.updated_at DESC`
      )
      .all(vendorId)
      .map((r) => mapProductRow(r as Record<string, unknown>));

    const orderItems = (
      db
        .prepare(
          `SELECT oi.*, o.order_number, o.buyer_name, o.buyer_email, o.shipping_address, o.delivery_zone, o.payment_status,
            o.payment_mode, o.deposit_percent, o.paid_amount, o.balance_due, o.total_amount, o.has_custom_offer, o.bank_transfer_ref, o.quote_thread_id,
            o.created_at as order_created_at
           FROM order_items oi
           JOIN orders o ON o.id = oi.order_id
           WHERE oi.vendor_id = ?
           ORDER BY o.created_at DESC`
        )
        .all(vendorId) as Array<Record<string, unknown>>
    ).map((o): Record<string, unknown> => ({
      ...o,
      customSpecs: o.custom_specs_json ? JSON.parse(String(o.custom_specs_json)) : null,
      quoteThreadToken: o.quote_thread_id ? signMessageThreadToken(String(o.quote_thread_id), 1) : null,
    }));

    const revenueTotal = orderItems
      .filter((o) => o.payment_status === 'paid')
      .reduce((acc, o) => acc + Number(o.unit_price) * Number(o.quantity) + Number(o.delivery_fee), 0);

    // Marketplace commission withheld on this vendor's paid orders (order-level amounts,
    // attributed to every vendor of the order since guest carts are single-vendor in practice).
    const paidOrderIds = [...new Set(orderItems.filter((o) => o.payment_status === 'paid').map((o) => String(o.order_id)))];
    let commissionTotal = 0;
    for (const oid of paidOrderIds) {
      const ord = db.prepare('SELECT commission_amount FROM orders WHERE id = ?').get(oid) as
        | { commission_amount: number }
        | undefined;
      commissionTotal += Number(ord?.commission_amount ?? 0);
    }

    const pendingOrdersCount = orderItems.filter(
      (o) =>
        (o.payment_status === 'paid' || o.payment_mode === 'quote' || o.payment_mode === 'bank_transfer') &&
        !['livree', 'annulee', 'remboursee', 'expiree'].includes(String(o.item_status))
    ).length;

    const kycDocs = db
      .prepare('SELECT id, vendor_id, doc_type, file_name, mime_type, review_status, rejection_reason, uploaded_at, reviewed_at, purge_scheduled_at FROM kyc_documents WHERE vendor_id = ? ORDER BY uploaded_at DESC')
      .all(vendorId)
      .map((d: Record<string, unknown>) => ({
        id: String(d.id),
        vendorId: String(d.vendor_id),
        docType: String(d.doc_type),
        fileName: String(d.file_name),
        mimeType: String(d.mime_type),
        reviewStatus: String(d.review_status),
        rejectionReason: d.rejection_reason ? String(d.rejection_reason) : null,
        uploadedAt: String(d.uploaded_at),
        reviewedAt: d.reviewed_at ? String(d.reviewed_at) : null,
        purgeScheduledAt: d.purge_scheduled_at ? String(d.purge_scheduled_at) : null,
      }));

    const reviews = db
      .prepare(
        `SELECT r.*, p.title as product_title
         FROM reviews r JOIN products p ON p.id = r.product_id
         WHERE p.vendor_id = ?
         ORDER BY r.created_at DESC LIMIT 25`
      )
      .all(vendorId)
      .map((r: Record<string, unknown>) => ({
        id: String(r.id),
        productId: String(r.product_id),
        productTitle: String(r.product_title),
        orderId: String(r.order_id),
        buyerName: String(r.buyer_name),
        rating: Number(r.rating),
        comment: String(r.comment),
        vendorReply: r.vendor_reply ? String(r.vendor_reply) : null,
        vendorRepliedAt: r.vendor_replied_at ? String(r.vendor_replied_at) : null,
        reportCount: Number(r.report_count),
        moderationStatus: String(r.moderation_status),
        createdAt: String(r.created_at),
      }));

    const messages = db
      .prepare(
        `SELECT m.*, p.title as product_title
         FROM messages m LEFT JOIN products p ON p.id = m.product_id
         WHERE m.vendor_id = ? AND m.hidden_by_moderation = 0
         ORDER BY m.created_at ASC`
      )
      .all(vendorId)
      .map((m: Record<string, unknown>) => ({
        id: String(m.id),
        threadId: String(m.thread_id),
        productId: m.product_id ? String(m.product_id) : null,
        productTitle: m.product_title ? String(m.product_title) : null,
        shopId: String(m.shop_id),
        vendorId: String(m.vendor_id),
        buyerName: String(m.buyer_name),
        buyerEmail: String(m.buyer_email),
        senderRole: String(m.sender_role),
        body: String(m.body),
        readByVendor: Boolean(m.read_by_vendor),
        reported: Boolean(m.reported),
        reportCount: Number(m.report_count),
        createdAt: String(m.created_at),
      }));

    const avgRating =
      reviews.filter((r) => r.moderationStatus === 'visible').length > 0
        ? Number(
            (
              reviews.filter((r) => r.moderationStatus === 'visible').reduce((a, r) => a + r.rating, 0) /
              reviews.filter((r) => r.moderationStatus === 'visible').length
            ).toFixed(1)
          )
        : 0;

    res.json({
      user: req.authUser,
      shop,
      kpis: {
        revenueTotal,
        commissionTotal,
        netRevenue: revenueTotal - commissionTotal,
        pendingOrdersCount: pendingOrdersCount,
        publishedProductsCount: products.filter((p) => p.status === 'publie').length,
        totalProductsCount: products.length,
        avgRating,
        reviewCount: reviews.length,
      },
      products,
      orderItems,
      kycDocs,
      reviews,
      messages,
    });
  });

  router.post('/vendor/keywords/suggest', requireAuth, async (req, res) => {
    const { title, description, categoryName } = req.body as {
      title?: string;
      description?: string;
      categoryName?: string;
    };
    const fallback = extractKeywords(title || '', description || '', categoryName || '');

    const geminiKey = process.env.GEMINI_API_KEY?.trim();
    if (geminiKey && geminiKey !== 'MY_GEMINI_API_KEY' && title && description) {
      try {
        const ai = new GoogleGenAI({ apiKey: geminiKey });
        const result = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: `Extrais exactement 8 mots-clés de recherche e-commerce en français (en minuscules, sans ponctuation, séparés par des virgules) pour ce produit :\nTitre: ${title}\nCatégorie: ${categoryName || ''}\nDescription: ${description}`,
        });
        const text = result.text || '';
        const parsed = text
          .split(/[,\n]/)
          .map((s) => s.trim().toLowerCase())
          .filter((s) => s.length >= 2)
          .slice(0, 10);
        if (parsed.length >= 3) {
          return res.json({ keywords: parsed, source: 'gemini' });
        }
      } catch {
        // Fallback silently to deterministic French keyword extractor
      }
    }
    res.json({ keywords: fallback, source: 'rules' });
  });

  router.post('/vendor/products', requireAuth, requireActiveVendorWrite, (req: AuthReq, res) => {
    const user = req.authUser!;
    const shop = db.prepare('SELECT * FROM shops WHERE vendor_id = ?').get(user.id) as { id: string } | undefined;
    if (!shop) return res.status(400).json({ error: 'Aucune boutique associée à ce compte.' });

    const body = req.body as Partial<Product>;
    if (!body.title?.trim() || !body.description?.trim() || !body.categoryId || Number(body.price) <= 0) {
      return res.status(400).json({ error: 'Titre, description, catégorie et prix positif sont requis.' });
    }

    const catRow = db.prepare('SELECT * FROM categories WHERE id = ?').get(body.categoryId) as
      | Record<string, unknown>
      | undefined;
    const category: Category | undefined = catRow
      ? {
          id: String(catRow.id),
          name: String(catRow.name),
          slug: String(catRow.slug),
          active: Boolean(catRow.active),
          forbidden: Boolean(catRow.forbidden),
          requiredBadge: catRow.required_badge ? String(catRow.required_badge) : null,
        }
      : undefined;

    const targetStatus: ProductStatus = body.status || 'brouillon';
    const stock = Math.max(0, Math.floor(Number(body.stock ?? 10)));
    const publishedCount = (
      db
        .prepare("SELECT COUNT(*) as c FROM products WHERE vendor_id = ? AND status = 'publie'")
        .get(user.id) as { c: number }
    ).c;

    const check = validateProductPublication({
      vendor: user,
      category,
      rules: getRulesMap(),
      publishedCountExcludingCurrent: publishedCount,
      targetStatus,
      stock,
    });
    if (!check.allowed) {
      return res.status(403).json({ error: check.reason });
    }

    const keywords =
      Array.isArray(body.keywords) && body.keywords.length > 0
        ? body.keywords
        : extractKeywords(body.title, body.description, category?.name || '');

    const id = `prod-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO products (
        id, vendor_id, shop_id, title, description, category_id, price, condition, status,
        stock, keywords_json, media_json, video_url, variants_json, delivery_fee, delivery_zones_json,
        delivery_delay, payment_methods_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      user.id,
      shop.id,
      body.title.trim(),
      body.description.trim(),
      body.categoryId,
      Math.round(Number(body.price)),
      body.condition || 'Neuf',
      targetStatus,
      stock,
      JSON.stringify(keywords),
      JSON.stringify(body.media || []),
      body.videoUrl || null,
      JSON.stringify(body.variants || []),
      Math.max(0, Math.round(Number(body.deliveryFee ?? 2000))),
      JSON.stringify(body.deliveryZones || []),
      body.deliveryDelay || '24 à 72h',
      JSON.stringify(body.paymentMethods || ['jumia_card', 'mobile_money_orange', 'mobile_money_mtn']),
      now,
      now
    );

    const created = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as Record<string, unknown>;
    res.status(201).json({ product: mapProductRow(created) });
  });

  router.put('/vendor/products/:id', requireAuth, requireActiveVendorWrite, (req: AuthReq, res) => {
    const user = req.authUser!;
    const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id) as
      | Record<string, unknown>
      | undefined;
    if (!existing) return res.status(404).json({ error: 'Produit introuvable.' });

    // Strict RBAC ownership check (Tableau 2)
    if (existing.vendor_id !== user.id) {
      return res.status(403).json({ error: 'Accès interdit : vous ne pouvez modifier que vos propres produits.' });
    }

    const body = req.body as Partial<Product>;
    const catId = body.categoryId || String(existing.category_id);
    const catRow = db.prepare('SELECT * FROM categories WHERE id = ?').get(catId) as Record<string, unknown> | undefined;
    const category: Category | undefined = catRow
      ? {
          id: String(catRow.id),
          name: String(catRow.name),
          slug: String(catRow.slug),
          active: Boolean(catRow.active),
          forbidden: Boolean(catRow.forbidden),
          requiredBadge: catRow.required_badge ? String(catRow.required_badge) : null,
        }
      : undefined;

    const targetStatus: ProductStatus = body.status || (existing.status as ProductStatus);
    const stock = body.stock !== undefined ? Math.max(0, Math.floor(Number(body.stock))) : Number(existing.stock);
    const publishedCount = (
      db
        .prepare("SELECT COUNT(*) as c FROM products WHERE vendor_id = ? AND status = 'publie' AND id != ?")
        .get(user.id, req.params.id) as { c: number }
    ).c;

    const check = validateProductPublication({
      vendor: user,
      category,
      rules: getRulesMap(),
      publishedCountExcludingCurrent: publishedCount,
      targetStatus,
      stock,
    });
    if (!check.allowed) {
      return res.status(403).json({ error: check.reason });
    }

    const title = body.title?.trim() || String(existing.title);
    const description = body.description?.trim() || String(existing.description);
    const keywords =
      body.keywords !== undefined
        ? body.keywords
        : JSON.parse(String(existing.keywords_json || '[]'));

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE products SET
        title = ?, description = ?, category_id = ?, price = ?, condition = ?, status = ?,
        stock = ?, keywords_json = ?, media_json = ?, video_url = ?, variants_json = ?,
        delivery_fee = ?, delivery_zones_json = ?, delivery_delay = ?, payment_methods_json = ?, updated_at = ?
      WHERE id = ? AND vendor_id = ?
    `).run(
      title,
      description,
      catId,
      body.price !== undefined ? Math.round(Number(body.price)) : Number(existing.price),
      body.condition || String(existing.condition),
      targetStatus,
      stock,
      JSON.stringify(keywords),
      JSON.stringify(body.media ?? JSON.parse(String(existing.media_json || '[]'))),
      body.videoUrl !== undefined ? body.videoUrl : existing.video_url ? String(existing.video_url) : null,
      JSON.stringify(body.variants ?? JSON.parse(String(existing.variants_json || '[]'))),
      body.deliveryFee !== undefined ? Math.max(0, Math.round(Number(body.deliveryFee))) : Number(existing.delivery_fee),
      JSON.stringify(body.deliveryZones ?? JSON.parse(String(existing.delivery_zones_json || '[]'))),
      body.deliveryDelay || String(existing.delivery_delay),
      JSON.stringify(body.paymentMethods ?? JSON.parse(String(existing.payment_methods_json || '[]'))),
      now,
      req.params.id,
      user.id
    );

    const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id) as Record<string, unknown>;
    res.json({ product: mapProductRow(updated) });
  });

  router.post('/vendor/products/:id/duplicate', requireAuth, requireActiveVendorWrite, (req: AuthReq, res) => {
    const user = req.authUser!;
    const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id) as
      | Record<string, unknown>
      | undefined;
    if (!existing) return res.status(404).json({ error: 'Produit introuvable.' });
    if (existing.vendor_id !== user.id) return res.status(403).json({ error: 'Accès refusé.' });

    const id = `prod-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO products (
        id, vendor_id, shop_id, title, description, category_id, price, condition, status,
        stock, keywords_json, media_json, video_url, variants_json, delivery_fee, delivery_zones_json,
        delivery_delay, payment_methods_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'brouillon', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      user.id,
      String(existing.shop_id),
      `${String(existing.title)} (Copie)`,
      String(existing.description),
      String(existing.category_id),
      Number(existing.price),
      String(existing.condition),
      Number(existing.stock),
      String(existing.keywords_json),
      String(existing.media_json),
      existing.video_url ? String(existing.video_url) : null,
      String(existing.variants_json),
      Number(existing.delivery_fee),
      String(existing.delivery_zones_json),
      String(existing.delivery_delay),
      String(existing.payment_methods_json),
      now,
      now
    );

    const created = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as Record<string, unknown>;
    res.status(201).json({ product: mapProductRow(created) });
  });

  router.delete('/vendor/products/:id', requireAuth, requireActiveVendorWrite, (req: AuthReq, res) => {
    const user = req.authUser!;
    const existing = db.prepare('SELECT vendor_id FROM products WHERE id = ?').get(req.params.id) as
      | { vendor_id: string }
      | undefined;
    if (!existing) return res.status(404).json({ error: 'Produit introuvable.' });
    if (existing.vendor_id !== user.id && user.role !== 'admin') {
      return res.status(403).json({ error: 'Accès interdit.' });
    }
    // Check if referenced in orders; if so archive instead of hard delete
    const inOrders = db.prepare('SELECT id FROM order_items WHERE product_id = ? LIMIT 1').get(req.params.id);
    if (inOrders) {
      db.prepare("UPDATE products SET status = 'archive', updated_at = ? WHERE id = ?").run(
        new Date().toISOString(),
        req.params.id
      );
      return res.json({ archived: true });
    }
    db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
    res.json({ deleted: true });
  });

  router.put('/vendor/shop', requireAuth, requireActiveVendorWrite, (req: AuthReq, res) => {
    const { name, description, logoUrl, city, contactPhone, contactEmail, defaultDeliveryFee, defaultDeliveryDelay, bankDetails } =
      req.body as {
        name?: string;
        description?: string;
        logoUrl?: string | null;
        city?: string;
        contactPhone?: string;
        contactEmail?: string;
        defaultDeliveryFee?: number;
        defaultDeliveryDelay?: string;
        bankDetails?: Partial<BankDetails> | null;
      };
    db.prepare(`
      UPDATE shops SET
        name = COALESCE(?, name),
        description = COALESCE(?, description),
        logo_url = CASE WHEN ? = 1 THEN ? ELSE logo_url END,
        city = COALESCE(?, city),
        contact_phone = COALESCE(?, contact_phone),
        contact_email = COALESCE(?, contact_email),
        default_delivery_fee = COALESCE(?, default_delivery_fee),
        default_delivery_delay = COALESCE(?, default_delivery_delay),
        bank_name = CASE WHEN ? = 1 THEN ? ELSE bank_name END,
        bank_account_holder = CASE WHEN ? = 1 THEN ? ELSE bank_account_holder END,
        bank_iban = CASE WHEN ? = 1 THEN ? ELSE bank_iban END,
        bank_bic = CASE WHEN ? = 1 THEN ? ELSE bank_bic END,
        bank_instructions = CASE WHEN ? = 1 THEN ? ELSE bank_instructions END
      WHERE vendor_id = ?
    `).run(
      name ? String(name).trim() : null,
      description !== undefined ? String(description).trim() : null,
      logoUrl !== undefined ? 1 : 0,
      logoUrl ? String(logoUrl).trim() : null,
      city !== undefined ? String(city).trim() : null,
      contactPhone !== undefined ? String(contactPhone).trim() : null,
      contactEmail ? String(contactEmail).trim() : null,
      defaultDeliveryFee !== undefined && Number.isFinite(Number(defaultDeliveryFee)) ? Number(defaultDeliveryFee) : null,
      defaultDeliveryDelay ? String(defaultDeliveryDelay).trim() : null,
      bankDetails !== undefined ? 1 : 0,
      bankDetails?.bankName?.trim() || null,
      bankDetails !== undefined ? 1 : 0,
      bankDetails?.accountHolder?.trim() || null,
      bankDetails !== undefined ? 1 : 0,
      bankDetails?.iban?.trim() || null,
      bankDetails !== undefined ? 1 : 0,
      bankDetails?.swiftBic?.trim() || null,
      bankDetails !== undefined ? 1 : 0,
      bankDetails?.instructions?.trim() || null,
      req.authUser!.id
    );
    const shopRow = db.prepare('SELECT * FROM shops WHERE vendor_id = ?').get(req.authUser!.id) as Record<string, unknown> | undefined;
    res.json({ shop: mapShopRow(shopRow) });
  });

  // EXF-104: Encrypted KYC Document upload
  router.post('/vendor/kyc', requireAuth, requireActiveVendorWrite, (req: AuthReq, res) => {
    const { docType, fileName, contentBase64, mimeType } = req.body as {
      docType?: string;
      fileName?: string;
      contentBase64?: string;
      mimeType?: string;
    };
    if (!docType || !fileName || !contentBase64) {
      return res.status(400).json({ error: 'Type de pièce, nom de fichier et contenu requis.' });
    }
    const rawClean = contentBase64.includes(',') ? contentBase64.split(',')[1] : contentBase64;
    const buffer = Buffer.from(rawClean, 'base64');
    if (buffer.length > 5 * 1024 * 1024) {
      return res.status(400).json({ error: 'La pièce justificative ne doit pas dépasser 5 Mo.' });
    }

    const encrypted = encryptKycPayload(buffer);
    const id = `kyc-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const retentionDays = getPlatformSettings().kycRetentionDays;
    const purgeAt = new Date(Date.now() + retentionDays * 86400_000).toISOString();

    db.prepare(`
      INSERT INTO kyc_documents (id, vendor_id, doc_type, file_name, mime_type, encrypted_payload, iv_hex, auth_tag_hex, review_status, uploaded_at, purge_scheduled_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'en_attente', ?, ?)
    `).run(
      id,
      req.authUser!.id,
      docType,
      path.basename(fileName),
      mimeType || 'application/octet-stream',
      encrypted.encryptedBase64,
      encrypted.ivHex,
      encrypted.authTagHex,
      now,
      purgeAt
    );

    writeAuditLog({
      actorId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      action: 'KYC_UPLOADED',
      targetType: 'kyc_document',
      targetId: id,
      details: `Dépôt chiffré AES-256-GCM : ${docType}`,
    });

    res.status(201).json({ id, uploadedAt: now });
  });

  // EXF-309 / EXF-407: Vendor updates order fulfillment state + notifies buyer with tracking link
  router.post('/vendor/orders/:orderId/status', requireAuth, requireActiveVendorWrite, (req: AuthReq, res) => {
    const user = req.authUser!;
    const { status, carrier, trackingNumber, note } = req.body as {
      status?: OrderEventStatus;
      carrier?: string;
      trackingNumber?: string;
      note?: string;
    };
    const allowedTransitions: OrderEventStatus[] = [
      'en_preparation',
      'expediee',
      'livraison_commencee',
      'livree',
      'annulee',
    ];
    if (!status || !allowedTransitions.includes(status)) {
      return res.status(400).json({ error: 'Statut de livraison invalide.' });
    }

    const vendorItem = db
      .prepare('SELECT * FROM order_items WHERE order_id = ? AND vendor_id = ? LIMIT 1')
      .get(req.params.orderId, user.id) as Record<string, unknown> | undefined;
    if (!vendorItem) {
      return res.status(403).json({ error: 'Cette commande ne contient aucun de vos articles.' });
    }

    const orderRow = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.orderId) as
      | Record<string, unknown>
      | undefined;
    if (!orderRow) return res.status(404).json({ error: 'Commande introuvable.' });
    if (orderRow.payment_status === 'expired' || orderRow.payment_status === 'refunded') {
      return res.status(400).json({ error: 'Impossible de modifier le statut d’une commande expirée ou remboursée.' });
    }
    if (status !== 'annulee' && orderRow.payment_status !== 'paid') {
      return res.status(400).json({ error: 'Le règlement (Jumia Africa ou virement bancaire) doit être confirmé avant de préparer ou expédier la commande.' });
    }

    db.prepare(`
      UPDATE order_items SET
        item_status = ?,
        carrier = COALESCE(?, carrier),
        tracking_number = COALESCE(?, tracking_number)
      WHERE order_id = ? AND vendor_id = ?
    `).run(status, carrier || null, trackingNumber || null, req.params.orderId, user.id);

    const statusLabels: Record<string, string> = {
      en_preparation: 'En préparation chez le vendeur',
      expediee: `Expédiée${carrier ? ` via ${carrier}` : ''}${trackingNumber ? ` (Suivi : ${trackingNumber})` : ''}`,
      livraison_commencee: 'Livraison commencée — livreur en cours de tournée',
      livree: 'Commande livrée avec succès',
      annulee: 'Commande annulée par le vendeur',
    };

    const now = new Date().toISOString();
    const eventNote = note?.trim() || statusLabels[status] || status;
    db.prepare('INSERT INTO order_events (id, order_id, status, note, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      `ev-${crypto.randomUUID().slice(0, 8)}`,
      req.params.orderId,
      status,
      eventNote,
      user.fullName,
      now
    );

    const trackingToken = signOrderTrackingToken(String(orderRow.id), Number(orderRow.tracking_token_version));
    const trackingUrl = `${getBaseUrl(req)}/?suivi=${encodeURIComponent(trackingToken)}`;

    queueTransactionalEmail({
      toEmail: String(orderRow.buyer_email),
      subject: `SIMCOVA — Mise à jour de votre commande ${String(orderRow.order_number)}`,
      bodyText: `${statusLabels[status]}.\n${eventNote}`,
      actionUrl: trackingUrl,
      actionLabel: 'Suivre ma commande en direct',
    });

    res.json({ updated: true, status, eventNote });
  });

  // Vendor confirms receipt of high-value bank transfer
  router.post('/vendor/orders/:orderId/confirm-bank-transfer', requireAuth, requireActiveVendorWrite, (req: AuthReq, res) => {
    const user = req.authUser!;
    const { bankReference } = req.body as { bankReference?: string };
    const vendorItem = db
      .prepare('SELECT * FROM order_items WHERE order_id = ? AND vendor_id = ? LIMIT 1')
      .get(req.params.orderId, user.id) as Record<string, unknown> | undefined;
    if (!vendorItem) {
      return res.status(403).json({ error: 'Cette commande ne contient aucun de vos articles.' });
    }
    const orderRow = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.orderId) as Record<string, unknown> | undefined;
    if (!orderRow) return res.status(404).json({ error: 'Commande introuvable.' });
    if (String(orderRow.payment_mode) !== 'bank_transfer' || orderRow.payment_status !== 'pending') {
      return res.status(400).json({ error: 'Cette commande n’est pas en attente de confirmation de virement bancaire.' });
    }

    const now = new Date().toISOString();
    // VAT-inclusive settled amount (equals HT total when VAT is disabled)
    const total = Number(orderRow.total_amount) + Number(orderRow.vat_amount ?? 0);
    const refLabel = bankReference?.trim() || (orderRow.bank_transfer_ref ? String(orderRow.bank_transfer_ref) : 'Confirmé par le concessionnaire');

    db.prepare("UPDATE orders SET payment_status = 'paid', paid_amount = ?, balance_due = 0, bank_transfer_ref = ? WHERE id = ?").run(
      total,
      refLabel,
      req.params.orderId
    );
    db.prepare("UPDATE order_items SET item_status = 'payee' WHERE order_id = ?").run(req.params.orderId);
    db.prepare('INSERT INTO order_events (id, order_id, status, note, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      `ev-${crypto.randomUUID().slice(0, 8)}`,
      req.params.orderId,
      'payee',
      `Virement bancaire confirmé par ${user.fullName} (Réf. ${refLabel}).`,
      user.fullName,
      now
    );

    decrementOrderStock(req.params.orderId, now);

    const trackingToken = signOrderTrackingToken(String(orderRow.id), Number(orderRow.tracking_token_version));
    const trackingUrl = `${getBaseUrl(req)}/?suivi=${encodeURIComponent(trackingToken)}`;
    queueTransactionalEmail({
      toEmail: String(orderRow.buyer_email),
      subject: `SIMCOVA — Virement confirmé pour la commande ${String(orderRow.order_number)}`,
      bodyText: `Le concessionnaire a confirmé la réception de votre virement de ${total} FCFA (${refLabel}). Votre commande passe en préparation.`,
      actionUrl: trackingUrl,
      actionLabel: 'Suivre ma commande',
    });

    res.json({ confirmed: true, paidAmount: total });
  });

  // Vendor confirms collection of remaining balance upon delivery for deposit orders
  router.post('/vendor/orders/:orderId/confirm-balance', requireAuth, requireActiveVendorWrite, (req: AuthReq, res) => {
    const user = req.authUser!;
    const vendorItem = db
      .prepare('SELECT * FROM order_items WHERE order_id = ? AND vendor_id = ? LIMIT 1')
      .get(req.params.orderId, user.id) as Record<string, unknown> | undefined;
    if (!vendorItem) {
      return res.status(403).json({ error: 'Cette commande ne contient aucun de vos articles.' });
    }
    const orderRow = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.orderId) as Record<string, unknown> | undefined;
    if (!orderRow) return res.status(404).json({ error: 'Commande introuvable.' });
    if (orderRow.payment_status !== 'paid' || Number(orderRow.balance_due) <= 0) {
      return res.status(400).json({ error: 'Aucun solde restant à encaisser sur cette commande.' });
    }

    const now = new Date().toISOString();
    // VAT-inclusive total (equals HT total when VAT is disabled)
    const total = Number(orderRow.total_amount) + Number(orderRow.vat_amount ?? 0);
    const collected = Number(orderRow.balance_due);
    db.prepare('UPDATE orders SET paid_amount = ?, balance_due = 0 WHERE id = ?').run(total, req.params.orderId);
    db.prepare('INSERT INTO order_events (id, order_id, status, note, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      `ev-${crypto.randomUUID().slice(0, 8)}`,
      req.params.orderId,
      'payee',
      `Solde restant à la livraison (${collected} FCFA) encaissé et soldé.`,
      user.fullName,
      now
    );

    const trackingToken = signOrderTrackingToken(String(orderRow.id), Number(orderRow.tracking_token_version));
    const trackingUrl = `${getBaseUrl(req)}/?suivi=${encodeURIComponent(trackingToken)}`;
    queueTransactionalEmail({
      toEmail: String(orderRow.buyer_email),
      subject: `SIMCOVA — Solde réglé pour la commande ${String(orderRow.order_number)}`,
      bodyText: `Votre solde de ${collected} FCFA a été confirmé comme encaissé à la livraison.`,
      actionUrl: trackingUrl,
      actionLabel: 'Voir le reçu et le suivi',
    });

    res.json({ settled: true, paidAmount: total, balanceDue: 0 });
  });

  // Vendor proposes/confirms final pricing on a custom quote order
  router.post('/vendor/orders/:orderId/quote-offer', requireAuth, requireActiveVendorWrite, (req: AuthReq, res) => {
    const user = req.authUser!;
    const { proposedTotal, note } = req.body as { proposedTotal?: number; note?: string };
    const cleanTotal = Math.round(Number(proposedTotal || 0));
    if (!Number.isFinite(cleanTotal) || cleanTotal <= 0) {
      return res.status(400).json({ error: 'Veuillez indiquer un montant de devis valide.' });
    }
    const vendorItem = db
      .prepare('SELECT * FROM order_items WHERE order_id = ? AND vendor_id = ? LIMIT 1')
      .get(req.params.orderId, user.id) as Record<string, unknown> | undefined;
    if (!vendorItem) {
      return res.status(403).json({ error: 'Cette commande ne contient aucun de vos articles.' });
    }
    const orderRow = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.orderId) as Record<string, unknown> | undefined;
    if (!orderRow) return res.status(404).json({ error: 'Commande introuvable.' });
    if (String(orderRow.payment_mode) !== 'quote' || orderRow.payment_status !== 'pending') {
      return res.status(400).json({ error: 'Cette commande n’est plus en phase de devis.' });
    }

    const now = new Date().toISOString();
    const settings = getPlatformSettings();
    const deliveryTotal = Number(orderRow.delivery_total || 0);
    // The vendor proposes an all-inclusive (TTC) amount: split VAT out and recompute the marketplace commission.
    const { vatAmount, netTotal } = splitInclusiveVat(cleanTotal, settings.vatRatePercent);
    const subtotal = Math.max(0, netTotal - deliveryTotal);
    const commissionAmount = Math.round((subtotal * Math.min(50, Math.max(0, settings.commissionRatePercent))) / 100);
    db.prepare('UPDATE orders SET subtotal = ?, total_amount = ?, vat_amount = ?, commission_amount = ?, balance_due = ? WHERE id = ?').run(
      subtotal,
      netTotal,
      vatAmount,
      commissionAmount,
      cleanTotal,
      req.params.orderId
    );
    db.prepare("UPDATE order_items SET item_status = 'devis_propose' WHERE order_id = ?").run(req.params.orderId);
    db.prepare('INSERT INTO order_events (id, order_id, status, note, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      `ev-${crypto.randomUUID().slice(0, 8)}`,
      req.params.orderId,
      'devis_propose',
      `Proposition commerciale envoyée : ${cleanTotal} FCFA.${note?.trim() ? ` ${note.trim()}` : ''}`,
      user.fullName,
      now
    );

    const trackingToken = signOrderTrackingToken(String(orderRow.id), Number(orderRow.tracking_token_version));
    const trackingUrl = `${getBaseUrl(req)}/?suivi=${encodeURIComponent(trackingToken)}`;
    queueTransactionalEmail({
      toEmail: String(orderRow.buyer_email),
      subject: `SIMCOVA — Devis chiffré disponible pour ${String(orderRow.order_number)}`,
      bodyText: `Le concessionnaire a établi une offre à ${cleanTotal} FCFA. Consultez votre lien de suivi pour valider le règlement (intégral, acompte ou virement bancaire).`,
      actionUrl: trackingUrl,
      actionLabel: 'Consulter et régler mon devis',
    });

    res.json({ proposed: true, totalAmount: cleanTotal });
  });

  // EXF-506: Vendor-initiated order cancellation & refund via Jumia Africa
  router.post('/vendor/orders/:orderId/refund', requireAuth, requireActiveVendorWrite, async (req: AuthReq, res) => {
    const user = req.authUser!;
    const { reason } = req.body as { reason?: string };

    const vendorItem = db
      .prepare('SELECT * FROM order_items WHERE order_id = ? AND vendor_id = ? LIMIT 1')
      .get(req.params.orderId, user.id) as Record<string, unknown> | undefined;
    if (!vendorItem) {
      return res.status(403).json({ error: 'Cette commande ne contient aucun de vos articles.' });
    }

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.orderId) as Record<string, unknown> | undefined;
    if (!order) return res.status(404).json({ error: 'Commande introuvable.' });
    if (order.payment_status !== 'paid') {
      return res.status(400).json({ error: 'Seule une commande déjà payée peut faire l’objet d’un remboursement.' });
    }
    if (String(vendorItem.item_status) === 'livree') {
      return res.status(400).json({ error: 'Cette commande a déjà été livrée. Contactez l’administrateur pour tout litige.' });
    }

    const pay = db.prepare('SELECT * FROM payments WHERE order_id = ?').get(req.params.orderId) as
      | Record<string, unknown>
      | undefined;

    const cleanReason = reason?.trim() || 'Annulation et remboursement initiés par le vendeur';
    if (pay) {
      const refund = await jumiaAfricaProvider.processRefund(String(pay.provider_ref), Number(pay.amount), cleanReason);
      if (!refund.success) {
        return res.status(502).json({ error: refund.reason || 'Le prestataire de paiement a refusé le remboursement.' });
      }
      db.prepare("UPDATE payments SET status = 'refunded', updated_at = ? WHERE id = ?").run(
        new Date().toISOString(),
        String(pay.id)
      );
    }

    const now = new Date().toISOString();
    db.prepare("UPDATE orders SET payment_status = 'refunded' WHERE id = ?").run(req.params.orderId);
    db.prepare("UPDATE order_items SET item_status = 'remboursee' WHERE order_id = ?").run(req.params.orderId);
    db.prepare('INSERT INTO order_events (id, order_id, status, note, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      `ev-${crypto.randomUUID().slice(0, 8)}`,
      req.params.orderId,
      'remboursee',
      `Remboursement initié par le vendeur (${cleanReason}).`,
      user.fullName,
      now
    );

    const trackingToken = signOrderTrackingToken(String(order.id), Number(order.tracking_token_version));
    const trackingUrl = `${getBaseUrl(req)}/?suivi=${encodeURIComponent(trackingToken)}`;
    queueTransactionalEmail({
      toEmail: String(order.buyer_email),
      subject: `SIMCOVA — Remboursement de votre commande ${String(order.order_number)}`,
      bodyText: `Votre commande ${String(order.order_number)} a été annulée et remboursée via Jumia Africa.\nMotif : ${cleanReason}`,
      actionUrl: trackingUrl,
      actionLabel: 'Consulter le statut de remboursement',
    });

    writeAuditLog({
      actorId: user.id,
      actorEmail: user.email,
      action: 'VENDOR_ORDER_REFUNDED',
      targetType: 'order',
      targetId: req.params.orderId,
      details: cleanReason,
    });

    res.json({ refunded: true });
  });

  router.post('/vendor/messages/:threadId/reply', requireAuth, requireActiveVendorWrite, (req: AuthReq, res) => {
    const user = req.authUser!;
    const { body } = req.body as { body?: string };
    if (!body?.trim()) return res.status(400).json({ error: 'Le message est vide.' });
    const circumvention = detectCircumvention(body);
    if (circumvention.blocked) {
      return res.status(400).json({
        error: `Message bloqué (${circumvention.reasons.join(', ')}). Toute négociation avec l’acheteur doit rester sur la plateforme SIMCOVA.`,
      });
    }

    const first = db
      .prepare('SELECT * FROM messages WHERE thread_id = ? AND vendor_id = ? LIMIT 1')
      .get(req.params.threadId, user.id) as Record<string, unknown> | undefined;
    if (!first) return res.status(403).json({ error: 'Fil introuvable ou non autorisé.' });

    const now = new Date().toISOString();
    db.prepare('UPDATE messages SET read_by_vendor = 1 WHERE thread_id = ?').run(req.params.threadId);
    db.prepare(`
      INSERT INTO messages (id, thread_id, product_id, shop_id, vendor_id, buyer_name, buyer_email, thread_token_version, sender_role, body, read_by_vendor, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'vendor', ?, 1, ?)
    `).run(
      `msg-${crypto.randomUUID().slice(0, 8)}`,
      req.params.threadId,
      first.product_id ? String(first.product_id) : null,
      String(first.shop_id),
      user.id,
      String(first.buyer_name),
      String(first.buyer_email),
      Number(first.thread_token_version),
      body.trim(),
      now
    );

    const threadToken = signMessageThreadToken(req.params.threadId, Number(first.thread_token_version));
    const threadUrl = `${getBaseUrl(req)}/?fil=${encodeURIComponent(threadToken)}`;

    queueTransactionalEmail({
      toEmail: String(first.buyer_email),
      subject: 'SIMCOVA — Réponse du vendeur à votre question',
      bodyText: body.trim(),
      actionUrl: threadUrl,
      actionLabel: 'Répondre sans créer de compte',
    });

    res.status(201).json({ sent: true, threadUrl });
  });

  router.post('/vendor/messages/:threadId/report', requireAuth, (req: AuthReq, res) => {
    const user = req.authUser!;
    const first = db
      .prepare('SELECT * FROM messages WHERE thread_id = ? AND vendor_id = ? LIMIT 1')
      .get(req.params.threadId, user.id) as Record<string, unknown> | undefined;
    if (!first) return res.status(403).json({ error: 'Accès interdit.' });

    db.prepare('UPDATE messages SET reported = 1, report_count = report_count + 1 WHERE thread_id = ?').run(
      req.params.threadId
    );
    const rules = getRulesMap();
    const threshold = Number((rules['RG-07']?.valueJson?.threshold as number) ?? 3);
    const updatedRow = db
      .prepare('SELECT MAX(report_count) as rc FROM messages WHERE thread_id = ?')
      .get(req.params.threadId) as { rc: number } | undefined;
    const autoHidden = Boolean(rules['RG-07']?.enabled && (updatedRow?.rc ?? 0) >= threshold);
    if (autoHidden) {
      db.prepare('UPDATE messages SET hidden_by_moderation = 1 WHERE thread_id = ?').run(req.params.threadId);
    }
    res.json({ reported: true, autoHidden });
  });

  // EXF-604: Vendor public reply (1 reply max per review)
  router.post('/vendor/reviews/:id/reply', requireAuth, requireActiveVendorWrite, (req: AuthReq, res) => {
    const user = req.authUser!;
    const { reply } = req.body as { reply?: string };
    if (!reply?.trim()) return res.status(400).json({ error: 'Réponse requise.' });

    const rev = db
      .prepare('SELECT r.*, p.vendor_id FROM reviews r JOIN products p ON p.id = r.product_id WHERE r.id = ?')
      .get(req.params.id) as Record<string, unknown> | undefined;
    if (!rev) return res.status(404).json({ error: 'Avis introuvable.' });
    if (rev.vendor_id !== user.id) return res.status(403).json({ error: 'Accès interdit.' });
    if (rev.vendor_reply) {
      return res.status(400).json({ error: 'Vous avez déjà publié une réponse sous cet avis (EXF-604).' });
    }

    db.prepare('UPDATE reviews SET vendor_reply = ?, vendor_replied_at = ? WHERE id = ?').run(
      reply.trim(),
      new Date().toISOString(),
      req.params.id
    );
    res.json({ replied: true });
  });

  // EXF-606: Vendor flags abusive review for admin moderation (cannot delete directly)
  router.post('/vendor/reviews/:id/report', requireAuth, (req: AuthReq, res) => {
    const rev = db
      .prepare('SELECT r.*, p.vendor_id FROM reviews r JOIN products p ON p.id = r.product_id WHERE r.id = ?')
      .get(req.params.id) as Record<string, unknown> | undefined;
    if (!rev) return res.status(404).json({ error: 'Avis introuvable.' });
    if (rev.vendor_id !== req.authUser!.id) return res.status(403).json({ error: 'Accès interdit.' });

    const nextCount = Number(rev.report_count) + 1;
    const rules = getRulesMap();
    const threshold = Number((rules['RG-07']?.valueJson?.threshold as number) ?? 3);
    const nextStatus = rules['RG-07']?.enabled && nextCount >= threshold ? 'retire' : 'signale';

    db.prepare('UPDATE reviews SET report_count = ?, moderation_status = ? WHERE id = ?').run(
      nextCount,
      nextStatus,
      req.params.id
    );
    res.json({ reported: true, moderationStatus: nextStatus });
  });

  // =========================================================================
  // SUPER ADMIN CONSOLE (EXF-201 .. EXF-210 & CHAPTER 7 RULES)
  // =========================================================================

  router.get('/admin/overview', requireAdmin, (req, res) => {
    const period = String(req.query.period || 'all');
    const daysMap: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };
    const cutoffMs = daysMap[period] ? Date.now() - daysMap[period] * 86_400_000 : 0;

    const allOrders = db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all() as Array<Record<string, unknown>>;
    const orders = cutoffMs > 0
      ? allOrders.filter((o) => Date.parse(String(o.created_at)) >= cutoffMs)
      : allOrders;

    const totalSales = orders
      .filter((o) => o.payment_status === 'paid')
      .reduce((sum, o) => sum + Number(o.total_amount), 0);
    const vatCollected = orders
      .filter((o) => o.payment_status === 'paid')
      .reduce((sum, o) => sum + Number(o.vat_amount ?? 0), 0);
    const commissionEarned = orders
      .filter((o) => o.payment_status === 'paid')
      .reduce((sum, o) => sum + Number(o.commission_amount ?? 0), 0);

    const statusCounts: Record<string, number> = {
      pending: orders.filter((o) => o.payment_status === 'pending').length,
      paid: orders.filter((o) => o.payment_status === 'paid').length,
      failed: orders.filter((o) => o.payment_status === 'failed').length,
      refunded: orders.filter((o) => o.payment_status === 'refunded').length,
      expired: orders.filter((o) => o.payment_status === 'expired').length,
    };

    // Evolution buckets over selected window (EXF-201)
    const bucketsMap = new Map<string, { label: string; sales: number; orders: number }>();
    for (const o of orders) {
      const dt = new Date(String(o.created_at));
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      const label = dt.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
      const prev = bucketsMap.get(key) ?? { label, sales: 0, orders: 0 };
      prev.orders += 1;
      if (o.payment_status === 'paid') prev.sales += Number(o.total_amount);
      bucketsMap.set(key, prev);
    }
    const evolution = Array.from(bucketsMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-8)
      .map(([, val]) => val);

    const publishedProducts = (db.prepare("SELECT COUNT(*) as c FROM products WHERE status = 'publie'").get() as { c: number }).c;
    const activeVendors = (db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'vendor' AND status IN ('valide', 'certifie')").get() as { c: number }).c;
    const pendingVendors = (db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'vendor' AND status = 'en_attente'").get() as { c: number }).c;
    const pendingModeration = (db.prepare("SELECT COUNT(*) as c FROM reviews WHERE moderation_status = 'signale'").get() as { c: number }).c;
    const reportedThreads = (db.prepare('SELECT COUNT(DISTINCT thread_id) as c FROM messages WHERE reported = 1 AND hidden_by_moderation = 0').get() as { c: number }).c;

    res.json({
      period,
      kpis: {
        totalSales,
        vatCollected,
        commissionEarned,
        totalOrders: orders.length,
        statusCounts,
        publishedProducts,
        activeVendors,
        pendingVendors,
        pendingModeration: pendingModeration + reportedThreads,
        evolution,
      },
    });
  });

  router.get('/admin/vendors', requireAdmin, (_req, res) => {
    const vendors = db
      .prepare(
        `SELECT u.*, s.id as shop_id, s.name as shop_name, s.slug as shop_slug, s.city as shop_city,
          (SELECT COUNT(*) FROM products p WHERE p.vendor_id = u.id AND p.status = 'publie') as published_count
         FROM users u LEFT JOIN shops s ON s.vendor_id = u.id
         WHERE u.role = 'vendor'
         ORDER BY CASE u.status WHEN 'en_attente' THEN 0 WHEN 'valide' THEN 1 WHEN 'certifie' THEN 2 ELSE 3 END, u.created_at DESC`
      )
      .all()
      .map((r: Record<string, unknown>) => ({
        ...mapUserRow(r),
        shopId: r.shop_id ? String(r.shop_id) : null,
        shopName: r.shop_name ? String(r.shop_name) : null,
        shopSlug: r.shop_slug ? String(r.shop_slug) : null,
        shopCity: r.shop_city ? String(r.shop_city) : null,
        publishedCount: Number(r.published_count || 0),
        kycDocs: db
          .prepare('SELECT id, vendor_id, doc_type, file_name, mime_type, review_status, rejection_reason, uploaded_at, reviewed_at, purge_scheduled_at FROM kyc_documents WHERE vendor_id = ? ORDER BY uploaded_at DESC')
          .all(String(r.id))
          .map((d: Record<string, unknown>) => ({
            id: String(d.id),
            vendorId: String(d.vendor_id),
            docType: String(d.doc_type),
            fileName: String(d.file_name),
            mimeType: String(d.mime_type),
            reviewStatus: String(d.review_status),
            rejectionReason: d.rejection_reason ? String(d.rejection_reason) : null,
            uploadedAt: String(d.uploaded_at),
            reviewedAt: d.reviewed_at ? String(d.reviewed_at) : null,
            purgeScheduledAt: d.purge_scheduled_at ? String(d.purge_scheduled_at) : null,
          })),
      }));

    res.json({ vendors });
  });

  // EXF-203 / EXF-104: Restricted in-place decryption viewer for Admin only (no auto-download)
  router.get('/admin/kyc/:docId/view', requireAdmin, (req: AuthReq, res) => {
    const doc = db.prepare('SELECT * FROM kyc_documents WHERE id = ?').get(req.params.docId) as
      | Record<string, unknown>
      | undefined;
    if (!doc) return res.status(404).json({ error: 'Pièce justificative introuvable ou purgée.' });

    const decrypted = decryptKycPayload(
      String(doc.encrypted_payload),
      String(doc.iv_hex),
      String(doc.auth_tag_hex)
    );
    if (!decrypted) {
      return res.status(500).json({
        error: 'Déchiffrement impossible (clé de session modifiée depuis le dépôt de test).',
      });
    }

    writeAuditLog({
      actorId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      action: 'KYC_VIEWED',
      targetType: 'kyc_document',
      targetId: String(doc.id),
      details: `Consultation restreinte de ${String(doc.doc_type)} (${String(doc.file_name)})`,
    });

    const mime = String(doc.mime_type);
    const isText = mime.startsWith('text/');
    res.json({
      id: String(doc.id),
      docType: String(doc.doc_type),
      fileName: String(doc.file_name),
      mimeType: mime,
      textPreview: isText ? decrypted.toString('utf8') : null,
      dataUrl: !isText ? `data:${mime};base64,${decrypted.toString('base64')}` : null,
    });
  });

  // EXNF-05: Purge sensitive KYC content after review
  router.post('/admin/kyc/:docId/purge', requireAdmin, (req: AuthReq, res) => {
    const doc = db.prepare('SELECT id, doc_type FROM kyc_documents WHERE id = ?').get(req.params.docId) as
      | { id: string; doc_type: string }
      | undefined;
    if (!doc) return res.status(404).json({ error: 'Pièce introuvable.' });
    db.prepare('DELETE FROM kyc_documents WHERE id = ?').run(doc.id);
    writeAuditLog({
      actorId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      action: 'KYC_PURGED',
      targetType: 'kyc_document',
      targetId: doc.id,
      details: `Purge sécurisée après examen (${doc.doc_type})`,
    });
    res.json({ purged: true });
  });

  // EXF-105 / EXF-106 / EXF-203: Validate, reject with reason, certify, or suspend vendor
  router.post('/admin/vendors/:id/decision', requireAdmin, (req: AuthReq, res) => {
    const { status, reason, badges } = req.body as {
      status?: VendorStatus;
      reason?: string;
      badges?: string[];
    };
    const allowed: VendorStatus[] = ['en_attente', 'valide', 'rejete', 'certifie', 'suspendu'];
    if (!status || !allowed.includes(status)) {
      return res.status(400).json({ error: 'Décision invalide.' });
    }

    const vendor = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'vendor'").get(req.params.id) as
      | Record<string, unknown>
      | undefined;
    if (!vendor) return res.status(404).json({ error: 'Vendeur introuvable.' });

    const currentBadges = new Set<string>(JSON.parse(String(vendor.badges_json || '[]')));
    if (status === 'certifie') {
      currentBadges.add('Vendeur certifié');
    } else {
      currentBadges.delete('Vendeur certifié');
    }
    if (Array.isArray(badges)) {
      currentBadges.clear();
      badges.forEach((b) => currentBadges.add(b));
      if (status === 'certifie') currentBadges.add('Vendeur certifié');
    }

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE users SET status = ?, rejection_reason = ?, badges_json = ? WHERE id = ?
    `).run(status, reason?.trim() || null, JSON.stringify([...currentBadges]), req.params.id);

    if (status === 'valide' || status === 'certifie') {
      db.prepare("UPDATE kyc_documents SET review_status = 'approuve', reviewed_at = ? WHERE vendor_id = ? AND review_status = 'en_attente'").run(
        now,
        req.params.id
      );
    } else if (status === 'rejete') {
      db.prepare("UPDATE kyc_documents SET review_status = 'rejete', rejection_reason = ?, reviewed_at = ? WHERE vendor_id = ? AND review_status = 'en_attente'").run(
        reason?.trim() || 'Pièce non conforme',
        now,
        req.params.id
      );
    }

    const labels: Record<VendorStatus, string> = {
      en_attente: 'Mis en attente de vérification',
      valide: 'Compte validé',
      rejete: 'Candidature rejetée',
      certifie: 'Compte certifié (badge Vendeur certifié attribué)',
      suspendu: 'Compte suspendu (boutique et produits masqués)',
    };

    queueTransactionalEmail({
      toEmail: String(vendor.email),
      subject: `SIMCOVA — Statut de votre compte vendeur : ${labels[status]}`,
      bodyText: `Décision de l’administration : ${labels[status]}.${reason ? `\nMotif : ${reason}` : ''}`,
      actionUrl: null,
      actionLabel: null,
    });

    writeAuditLog({
      actorId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      action: `VENDOR_${status.toUpperCase()}`,
      targetType: 'user',
      targetId: req.params.id,
      details: `${labels[status]}${reason ? ` — ${reason}` : ''}`,
    });

    res.json({ updated: true, status, badges: [...currentBadges] });
  });

  // Chapter 7 Rules RG-01 .. RG-10
  router.get('/admin/rules', requireAdmin, (_req, res) => {
    res.json({ rules: Object.values(getRulesMap()) });
  });

  router.put('/admin/rules/:ruleId', requireAdmin, (req: AuthReq, res) => {
    const ruleId = req.params.ruleId as RuleId;
    const existing = db.prepare('SELECT * FROM platform_rules WHERE rule_id = ?').get(ruleId) as
      | Record<string, unknown>
      | undefined;
    if (!existing) return res.status(404).json({ error: 'Règle introuvable.' });

    const { enabled, valueJson } = req.body as { enabled?: boolean; valueJson?: Record<string, unknown> };
    const nextEnabled = enabled !== undefined ? (enabled ? 1 : 0) : Number(existing.enabled);
    const nextValue = valueJson !== undefined ? JSON.stringify(valueJson) : String(existing.value_json);
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE platform_rules SET enabled = ?, value_json = ?, updated_by = ?, updated_at = ? WHERE rule_id = ?
    `).run(nextEnabled, nextValue, req.authUser!.email, now, ruleId);

    writeAuditLog({
      actorId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      action: 'RULE_UPDATED',
      targetType: 'platform_rule',
      targetId: ruleId,
      details: `${String(existing.title)} -> ${nextEnabled ? 'Active' : 'Désactivée'}`,
    });

    // Notify existing vendors when a rule affecting them changes (Chapter 7)
    const vendors = db.prepare("SELECT email FROM users WHERE role = 'vendor' AND status != 'suspendu'").all() as Array<{
      email: string;
    }>;
    for (const v of vendors) {
      queueTransactionalEmail({
        toEmail: v.email,
        subject: `SIMCOVA — Évolution de règle plateforme (${ruleId})`,
        bodyText: `La règle « ${String(existing.title)} » est désormais ${nextEnabled ? 'activée' : 'désactivée'}. Consultez votre espace vendeur pour vérifier la conformité de vos fiches.`,
      });
    }

    res.json({ rules: Object.values(getRulesMap()) });
  });

  // EXF-206: Categories CRUD
  router.post('/admin/categories', requireAdmin, (req: AuthReq, res) => {
    const { name, requiredBadge } = req.body as { name?: string; requiredBadge?: string | null };
    if (!name?.trim()) return res.status(400).json({ error: 'Nom de catégorie requis.' });
    const slug = slugify(name);
    const id = `cat-${slug}-${crypto.randomBytes(2).toString('hex')}`;
    db.prepare('INSERT INTO categories (id, name, slug, active, forbidden, required_badge) VALUES (?, ?, ?, 1, 0, ?)').run(
      id,
      name.trim(),
      `${slug}-${id.slice(-4)}`,
      requiredBadge || null
    );
    writeAuditLog({
      actorId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      action: 'CATEGORY_CREATED',
      targetType: 'category',
      targetId: id,
      details: `Catégorie « ${name.trim()} »`,
    });
    res.status(201).json({ id });
  });

  router.put('/admin/categories/:id', requireAdmin, (req: AuthReq, res) => {
    const { name, active, forbidden, requiredBadge } = req.body as {
      name?: string;
      active?: boolean;
      forbidden?: boolean;
      requiredBadge?: string | null;
    };
    const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id) as
      | Record<string, unknown>
      | undefined;
    if (!existing) return res.status(404).json({ error: 'Catégorie introuvable.' });

    const nextBadge =
      requiredBadge !== undefined
        ? requiredBadge && requiredBadge.trim()
          ? requiredBadge.trim()
          : null
        : existing.required_badge
          ? String(existing.required_badge)
          : null;

    db.prepare(`
      UPDATE categories SET
        name = COALESCE(?, name),
        active = COALESCE(?, active),
        forbidden = COALESCE(?, forbidden),
        required_badge = ?
      WHERE id = ?
    `).run(
      name ? name.trim() : null,
      active !== undefined ? (active ? 1 : 0) : null,
      forbidden !== undefined ? (forbidden ? 1 : 0) : null,
      nextBadge,
      req.params.id
    );
    writeAuditLog({
      actorId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      action: 'CATEGORY_UPDATED',
      targetType: 'category',
      targetId: req.params.id,
      details: `Mise à jour catégorie « ${name ? name.trim() : String(existing.name)} »`,
    });
    res.json({ updated: true });
  });

  // EXF-207: Moderation (Reviews & Reported Message Threads)
  router.get('/admin/moderation', requireAdmin, (_req, res) => {
    const reviews = db
      .prepare(
        `SELECT r.*, p.title as product_title
         FROM reviews r JOIN products p ON p.id = r.product_id
         ORDER BY CASE r.moderation_status WHEN 'signale' THEN 0 ELSE 1 END, r.created_at DESC`
      )
      .all()
      .map((r: Record<string, unknown>) => ({
        id: String(r.id),
        productId: String(r.product_id),
        productTitle: String(r.product_title),
        orderId: String(r.order_id),
        buyerName: String(r.buyer_name),
        rating: Number(r.rating),
        comment: String(r.comment),
        vendorReply: r.vendor_reply ? String(r.vendor_reply) : null,
        reportCount: Number(r.report_count),
        moderationStatus: String(r.moderation_status),
        createdAt: String(r.created_at),
      }));

    const threads = db
      .prepare(
        `SELECT m.thread_id, m.buyer_name, m.buyer_email, s.name as shop_name, m.body, m.reported, m.report_count, m.hidden_by_moderation, m.created_at,
          EXISTS(SELECT 1 FROM blocked_threads bt WHERE bt.thread_id = m.thread_id) as is_blocked
         FROM messages m
         JOIN shops s ON s.id = m.shop_id
         WHERE m.id IN (SELECT MAX(id) FROM messages GROUP BY thread_id)
         ORDER BY m.reported DESC, m.created_at DESC`
      )
      .all()
      .map((t: Record<string, unknown>) => ({
        threadId: String(t.thread_id),
        buyerName: String(t.buyer_name),
        buyerEmail: String(t.buyer_email),
        shopName: String(t.shop_name),
        lastMessage: String(t.body),
        reported: Boolean(t.reported),
        reportCount: Number(t.report_count),
        hiddenByModeration: Boolean(t.hidden_by_moderation),
        isBlocked: Boolean(t.is_blocked),
        createdAt: String(t.created_at),
      }));

    res.json({ reviews, threads });
  });

  router.post('/admin/moderation/reviews/:id', requireAdmin, (req: AuthReq, res) => {
    const { status } = req.body as { status?: 'visible' | 'retire' };
    if (!status || !['visible', 'retire'].includes(status)) {
      return res.status(400).json({ error: 'Statut invalide.' });
    }
    db.prepare('UPDATE reviews SET moderation_status = ? WHERE id = ?').run(status, req.params.id);
    writeAuditLog({
      actorId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      action: `REVIEW_${status.toUpperCase()}`,
      targetType: 'review',
      targetId: req.params.id,
      details: `Avis passé en statut ${status}`,
    });
    res.json({ updated: true });
  });

  router.post('/admin/moderation/threads/:threadId/block', requireAdmin, (req: AuthReq, res) => {
    const { block, reason } = req.body as { block?: boolean; reason?: string };
    if (block) {
      db.prepare('INSERT OR REPLACE INTO blocked_threads (thread_id, blocked_by, reason, created_at) VALUES (?, ?, ?, ?)').run(
        req.params.threadId,
        req.authUser!.email,
        reason || 'Comportement abusif signalé',
        new Date().toISOString()
      );
      db.prepare('UPDATE messages SET hidden_by_moderation = 1 WHERE thread_id = ?').run(req.params.threadId);
    } else {
      db.prepare('DELETE FROM blocked_threads WHERE thread_id = ?').run(req.params.threadId);
      db.prepare('UPDATE messages SET hidden_by_moderation = 0, reported = 0 WHERE thread_id = ?').run(req.params.threadId);
    }
    writeAuditLog({
      actorId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      action: block ? 'THREAD_BLOCKED' : 'THREAD_UNBLOCKED',
      targetType: 'thread',
      targetId: req.params.threadId,
      details: reason || 'Action de modération messagerie',
    });
    res.json({ updated: true });
  });

  // EXF-208 / EXF-608 / EXF-610: Admin Push Alerts Broadcast + History
  router.get('/admin/push-alerts', requireAdmin, (_req, res) => {
    const alerts = db.prepare('SELECT * FROM push_alerts ORDER BY created_at DESC LIMIT 30').all().map((a: Record<string, unknown>) => ({
      id: String(a.id),
      title: String(a.title),
      body: String(a.body),
      deepLink: String(a.deep_link),
      alertType: String(a.alert_type),
      sentCount: Number(a.sent_count),
      createdBy: String(a.created_by),
      createdAt: String(a.created_at),
    }));
    const subscriberCount = (db.prepare('SELECT COUNT(*) as c FROM push_subscriptions').get() as { c: number }).c;
    res.json({ alerts, subscriberCount, liveConnections: sseClients.size });
  });

  router.post('/admin/push-alerts', requireAdmin, (req: AuthReq, res) => {
    const { title, body, deepLink, alertType } = req.body as {
      title?: string;
      body?: string;
      deepLink?: string;
      alertType?: 'nouveautes' | 'promotions' | 'annonces';
    };
    if (!title?.trim() || !body?.trim()) {
      return res.status(400).json({ error: 'Titre et message de l’alerte requis.' });
    }
    const type = alertType || 'nouveautes';
    const subs = db.prepare('SELECT preferences_json FROM push_subscriptions').all() as Array<{
      preferences_json: string;
    }>;
    const eligibleSubs = subs.filter((s) => {
      const prefs = JSON.parse(s.preferences_json || '{}');
      return prefs[type] !== false;
    }).length;

    const sentCount = Math.max(eligibleSubs, sseClients.size);
    const alert: PushAlertItem = {
      id: `push-${crypto.randomUUID().slice(0, 8)}`,
      title: title.trim(),
      body: body.trim(),
      deepLink: deepLink?.trim() || '/',
      alertType: type,
      sentCount,
      createdBy: req.authUser!.email,
      createdAt: new Date().toISOString(),
    };

    db.prepare(`
      INSERT INTO push_alerts (id, title, body, deep_link, alert_type, sent_count, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(alert.id, alert.title, alert.body, alert.deepLink, alert.alertType, alert.sentCount, alert.createdBy, alert.createdAt);

    broadcastSseAlert(alert);

    writeAuditLog({
      actorId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      action: 'PUSH_ALERT_SENT',
      targetType: 'push_alert',
      targetId: alert.id,
      details: `${alert.title} (${alert.sentCount} appareil(s))`,
    });

    res.status(201).json({ alert });
  });

  // EXF-506 / EXF-507: Orders, Transactions & Refunds (+ search & filters)
  router.get('/admin/orders', requireAdmin, (req, res) => {
    const q = req.query.q ? String(req.query.q).toLowerCase().trim() : '';
    const status = req.query.status ? String(req.query.status) : '';
    const mode = req.query.mode ? String(req.query.mode) : '';
    const from = req.query.from ? Date.parse(String(req.query.from)) : 0;
    const to = req.query.to ? Date.parse(String(req.query.to)) + 86_400_000 : Number.MAX_SAFE_INTEGER;

    const rows = db
      .prepare(
        `SELECT o.*, p.provider_ref, p.status as tx_status, p.method as tx_method
         FROM orders o LEFT JOIN payments p ON p.order_id = o.id
         ORDER BY o.created_at DESC`
      )
      .all() as Array<Record<string, unknown>>;

    const orders = rows
      .filter((o) => {
        const t = Date.parse(String(o.created_at));
        if (t < from || t > to) return false;
        if (status && String(o.payment_status) !== status) return false;
        if (mode && String(o.payment_mode || 'full') !== mode) return false;
        if (q) {
          const hay = `${o.order_number} ${o.buyer_name} ${o.buyer_email} ${o.buyer_phone || ''}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .map((o) => ({
        ...o,
        vat_amount: Number(o.vat_amount ?? 0),
        commission_amount: Number(o.commission_amount ?? 0),
        grand_total: Number(o.total_amount) + Number(o.vat_amount ?? 0),
        net_vendors: Number(o.total_amount) - Number(o.commission_amount ?? 0),
      }));
    res.json({ orders });
  });

  router.post('/admin/orders/:id/refund', requireAdmin, async (req: AuthReq, res) => {
    const { reason } = req.body as { reason?: string };
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined;
    if (!order) return res.status(404).json({ error: 'Commande introuvable.' });
    const pay = db.prepare('SELECT * FROM payments WHERE order_id = ?').get(req.params.id) as
      | Record<string, unknown>
      | undefined;

    if (pay) {
      const refund = await jumiaAfricaProvider.processRefund(String(pay.provider_ref), Number(pay.amount), reason || 'Remboursement administrateur');
      if (!refund.success) {
        return res.status(502).json({ error: refund.reason || 'Le prestataire de paiement a refusé le remboursement.' });
      }
      db.prepare("UPDATE payments SET status = 'refunded', updated_at = ? WHERE id = ?").run(
        new Date().toISOString(),
        String(pay.id)
      );
    }

    const now = new Date().toISOString();
    db.prepare("UPDATE orders SET payment_status = 'refunded' WHERE id = ?").run(req.params.id);
    db.prepare("UPDATE order_items SET item_status = 'remboursee' WHERE order_id = ?").run(req.params.id);
    db.prepare('INSERT INTO order_events (id, order_id, status, note, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      `ev-${crypto.randomUUID().slice(0, 8)}`,
      req.params.id,
      'remboursee',
      `Remboursement effectué (${reason || 'Décision support SIMCOVA'}).`,
      req.authUser!.email,
      now
    );

    writeAuditLog({
      actorId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      action: 'ORDER_REFUNDED',
      targetType: 'order',
      targetId: req.params.id,
      details: reason || 'Remboursement initié via Jumia Africa',
    });

    res.json({ refunded: true });
  });

  // EXF-209: CSV Exports (+ période arbitraire + export comptable)
  router.get('/admin/export/:type', requireAdmin, (req, res) => {
    const type = req.params.type;
    const escapeCsv = (val: unknown) => `"${String(val ?? '').replace(/"/g, '""')}"`;
    const from = req.query.from ? String(req.query.from) : '';
    const to = req.query.to ? String(req.query.to) : '';
    const dateFilter = (col: string) => {
      const conds: string[] = [];
      const params: unknown[] = [];
      if (from) {
        conds.push(`${col} >= ?`);
        params.push(from);
      }
      if (to) {
        conds.push(`${col} <= ?`);
        params.push(`${to}T23:59:59.999Z`);
      }
      return { conds, params };
    };

    let csv = '';
    if (type === 'orders') {
      const { conds, params } = dateFilter('created_at');
      const rows = db
        .prepare(
          `SELECT order_number, buyer_name, buyer_email, delivery_zone, total_amount, vat_amount, commission_amount, payment_method, payment_status, created_at FROM orders ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''} ORDER BY created_at DESC`
        )
        .all(...(params as [])) as Array<Record<string, unknown>>;
      csv = 'Numero,Acheteur,Courriel,Zone,Total_HT,TVA,TTC,Commission,Mode_Paiement,Statut,Date\n';
      csv += rows
        .map((r) => {
          const ht = Number(r.total_amount);
          const vat = Number(r.vat_amount ?? 0);
          return [r.order_number, r.buyer_name, r.buyer_email, r.delivery_zone, ht, vat, ht + vat, r.commission_amount ?? 0, r.payment_method, r.payment_status, r.created_at]
            .map(escapeCsv)
            .join(',');
        })
        .join('\n');
    } else if (type === 'vendors') {
      const rows = db.prepare("SELECT u.full_name, u.email, u.status, s.name as shop_name, s.city, u.created_at FROM users u LEFT JOIN shops s ON s.vendor_id = u.id WHERE u.role = 'vendor'").all() as Array<Record<string, unknown>>;
      csv = 'Nom,Courriel,Statut,Boutique,Ville,Date_Inscription\n';
      csv += rows.map((r) => [r.full_name, r.email, r.status, r.shop_name, r.city, r.created_at].map(escapeCsv).join(',')).join('\n');
    } else if (type === 'transactions') {
      const { conds, params } = dateFilter('p.created_at');
      const rows = db
        .prepare(
          `SELECT p.provider_ref, o.order_number, p.provider, p.method, p.amount, p.status, p.created_at FROM payments p JOIN orders o ON o.id = p.order_id ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''} ORDER BY p.created_at DESC`
        )
        .all(...(params as [])) as Array<Record<string, unknown>>;
      csv = 'Reference_PSP,Commande,Prestataire,Methode,Montant_FCFA,Statut,Date\n';
      csv += rows.map((r) => [r.provider_ref, r.order_number, r.provider, r.method, r.amount, r.status, r.created_at].map(escapeCsv).join(',')).join('\n');
    } else if (type === 'accounting') {
      // Accounting export: one line per order with the full platform take (period filter supported)
      const { conds, params } = dateFilter('created_at');
      const rows = db
        .prepare(
          `SELECT order_number, created_at, buyer_email, payment_method, payment_status, subtotal, delivery_total, total_amount, vat_amount, commission_amount, paid_amount FROM orders ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''} ORDER BY created_at ASC`
        )
        .all(...(params as [])) as Array<Record<string, unknown>>;
      csv = 'Date,Commande,Acheteur,Moyen,Statut,Sous_total_Produits,Livraison,Total_HT,TVA,TTC,Commission_Plateforme,Net_Vendeurs,Encaisse\n';
      let sumHT = 0, sumVat = 0, sumGrand = 0, sumCom = 0, sumNet = 0;
      for (const r of rows) {
        const ht = Number(r.total_amount);
        const vat = Number(r.vat_amount ?? 0);
        const com = Number(r.commission_amount ?? 0);
        const grand = ht + vat;
        sumHT += ht; sumVat += vat; sumGrand += grand; sumCom += com; sumNet += ht - com;
        csv += [r.created_at, r.order_number, r.buyer_email, r.payment_method, r.payment_status, r.subtotal, r.delivery_total, ht, vat, grand, com, ht - com, r.paid_amount]
          .map(escapeCsv)
          .join(',') + '\n';
      }
      csv += ['TOTAL', '', '', '', '', '', '', sumHT, sumVat, sumGrand, sumCom, sumNet, ''].map(escapeCsv).join(',') + '\n';
    } else if (type === 'buyers') {
      const buyers = getAdminBuyers({}).buyers;
      csv = 'Courriel,Nom,Zone,Commandes,Payees,Depense_TTC,Panier_Moyen,Premiere_Commande,Derniere_Commande,Remboursements,Devis\n';
      csv += buyers
        .map((b) => [b.email, b.name, b.zone, b.orders, b.paidOrders, b.spent, b.avgBasket, b.firstAt, b.lastAt, b.refunded, b.customOrders].map(escapeCsv).join(','))
        .join('\n');
    } else if (type === 'audit') {
      const rows = db.prepare('SELECT created_at, actor_email, action, target_type, target_id, details FROM audit_logs ORDER BY created_at DESC').all() as Array<Record<string, unknown>>;
      csv = 'Date,Acteur,Action,Cible,Identifiant,Details\n';
      csv += rows.map((r) => [r.created_at, r.actor_email, r.action, r.target_type, r.target_id, r.details].map(escapeCsv).join(',')).join('\n');
    } else {
      return res.status(400).json({ error: 'Type d’export inconnu.' });
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="simcova-${type}.csv"`);
    res.send(`\uFEFF${csv}`);
  });

  // EXF-210: Platform Settings
  router.put('/admin/settings', requireAdmin, (req: AuthReq, res) => {
    const s = req.body as Partial<PlatformSettings>;
    db.prepare(`
      UPDATE platform_settings SET
        currency = COALESCE(?, currency),
        default_delivery_policy = COALESCE(?, default_delivery_policy),
        legal_mentions = COALESCE(?, legal_mentions),
        cgv_text = COALESCE(?, cgv_text),
        support_email = COALESCE(?, support_email),
        support_phone = COALESCE(?, support_phone),
        kyc_retention_days = COALESCE(?, kyc_retention_days),
        review_processing_delay_label = COALESCE(?, review_processing_delay_label),
        default_deposit_percent = COALESCE(?, default_deposit_percent),
        bank_transfer_threshold = COALESCE(?, bank_transfer_threshold),
        commission_rate_percent = COALESCE(?, commission_rate_percent),
        vat_rate_percent = COALESCE(?, vat_rate_percent),
        maintenance_mode = COALESCE(?, maintenance_mode)
      WHERE id = 1
    `).run(
      s.currency || null,
      s.defaultDeliveryPolicy || null,
      s.legalMentions || null,
      s.cgvText || null,
      s.supportEmail || null,
      s.supportPhone || null,
      s.kycRetentionDays ?? null,
      s.reviewProcessingDelayLabel || null,
      s.defaultDepositPercent !== undefined ? Math.min(90, Math.max(10, Math.round(Number(s.defaultDepositPercent)))) : null,
      s.bankTransferThreshold !== undefined ? Math.max(0, Math.round(Number(s.bankTransferThreshold))) : null,
      s.commissionRatePercent !== undefined ? Math.min(50, Math.max(0, Math.round(Number(s.commissionRatePercent)))) : null,
      s.vatRatePercent !== undefined ? Math.min(50, Math.max(0, Math.round(Number(s.vatRatePercent)))) : null,
      s.maintenanceMode !== undefined ? (s.maintenanceMode ? 1 : 0) : null
    );
    writeAuditLog({
      actorId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      action: 'SETTINGS_UPDATED',
      targetType: 'platform_settings',
      targetId: '1',
      details: 'Mise à jour des paramètres généraux, seuils d’acompte / virement et mentions légales',
    });
    res.json({ settings: getPlatformSettings() });
  });

  // =========================================================================
  // ADMIN FINANCE, ANALYTICS & DIRECTORY (SPEC-ADMIN.md Phase 1)
  // =========================================================================

  const parsePeriod = (value: unknown): '7d' | '30d' | '90d' | 'all' =>
    value === '7d' || value === '30d' || value === '90d' ? value : 'all';

  // Exhaustive, filterable transaction ledger with the platform take (HT/TVA/TTC/commission/net)
  router.get('/admin/transactions', requireAdmin, (req, res) => {
    const result = getAdminTransactions({
      period: parsePeriod(req.query.period),
      from: req.query.from ? String(req.query.from) : undefined,
      to: req.query.to ? String(req.query.to) : undefined,
      status: req.query.status ? String(req.query.status) : undefined,
      method: req.query.method ? String(req.query.method) : undefined,
      vendorId: req.query.vendorId ? String(req.query.vendorId) : undefined,
      q: req.query.q ? String(req.query.q).trim() : undefined,
      minAmount: req.query.minAmount ? Number(req.query.minAmount) : undefined,
      maxAmount: req.query.maxAmount ? Number(req.query.maxAmount) : undefined,
    });
    res.json(result);
  });

  // Vendor payout statements (net = revenue - attributed commission) & recorded payouts
  router.get('/admin/payouts', requireAdmin, (req, res) => {
    res.json(getAdminPayouts({ period: parsePeriod(req.query.period) }));
  });

  router.post('/admin/payouts', requireAdmin, (req: AuthReq, res) => {
    const { vendorId, amount, method, reference, note, periodStart, periodEnd } = req.body as {
      vendorId?: string;
      amount?: number;
      method?: string;
      reference?: string;
      note?: string;
      periodStart?: string;
      periodEnd?: string;
    };
    if (!vendorId) return res.status(400).json({ error: 'Vendeur requis.' });
    const result = recordVendorPayout({
      vendorId,
      amount: Number(amount || 0),
      method,
      reference,
      note,
      periodStart,
      periodEnd,
      actorId: req.authUser!.id,
      actorEmail: req.authUser!.email,
    });
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.status(201).json({ recorded: true, id: result.id });
  });

  // Aggregated KPIs, tops, commission splits, delays & distributions
  router.get('/admin/analytics', requireAdmin, (req, res) => {
    res.json(getAdminAnalytics({ period: parsePeriod(req.query.period) }));
  });

  // Guest buyer directory aggregated by email
  router.get('/admin/buyers', requireAdmin, (req, res) => {
    res.json(
      getAdminBuyers({
        q: req.query.q ? String(req.query.q).trim() : undefined,
        minOrders: req.query.minOrders ? Number(req.query.minOrders) : undefined,
      })
    );
  });

  // Order 360° detail (timeline, items with custom specs, full money breakdown)
  router.get('/admin/orders/:id', requireAdmin, (req, res) => {
    const detail = getAdminOrderDetail(req.params.id);
    if (!detail) return res.status(404).json({ error: 'Commande introuvable.' });
    res.json(detail);
  });

  // =========================================================================
  // ADMIN CATALOG, VENDOR 360°, PROMOS, SYSTEM & CAMPAIGNS (SPEC-ADMIN Phase 2/3)
  // =========================================================================

  // Global product list (all vendors) with filters + admin archive action
  router.get('/admin/products', requireAdmin, (req, res) => {
    const status = req.query.status ? String(req.query.status) : '';
    const vendorId = req.query.vendorId ? String(req.query.vendorId) : '';
    const q = req.query.q ? String(req.query.q).toLowerCase().trim() : '';

    const rows = db
      .prepare(
        `SELECT p.*, u.full_name AS vendor_name, s.name AS shop_name, s.slug AS shop_slug, c.name AS category_name,
          COALESCE((SELECT AVG(r.rating) FROM reviews r WHERE r.product_id = p.id AND r.moderation_status = 'visible'), 0) as rating_average,
          COALESCE((SELECT COUNT(r.id) FROM reviews r WHERE r.product_id = p.id AND r.moderation_status = 'visible'), 0) as review_count
         FROM products p
         JOIN users u ON u.id = p.vendor_id
         LEFT JOIN shops s ON s.vendor_id = p.vendor_id
         JOIN categories c ON c.id = p.category_id
         ORDER BY p.updated_at DESC`
      )
      .all() as Array<Record<string, unknown>>;

    const products = rows
      .filter((p) => {
        if (status && String(p.status) !== status) return false;
        if (vendorId && String(p.vendor_id) !== vendorId) return false;
        if (q) {
          const hay = `${p.title} ${p.description} ${u_name(p)} ${p.shop_name || ''} ${p.category_name || ''}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
        function u_name(row: Record<string, unknown>) {
          return String(row.vendor_name || '');
        }
      })
      .map((p) => ({
        id: String(p.id),
        title: String(p.title),
        status: String(p.status),
        price: Number(p.price),
        stock: Number(p.stock),
        condition: String(p.condition),
        vendorId: String(p.vendor_id),
        vendorName: String(p.vendor_name || ''),
        shopName: p.shop_name ? String(p.shop_name) : '',
        categoryName: p.category_name ? String(p.category_name) : '',
        ratingAverage: Number(Number(p.rating_average ?? 0).toFixed(1)),
        reviewCount: Number(p.review_count ?? 0),
        viewCount: Number(p.view_count ?? 0),
        updatedAt: String(p.updated_at),
      }));
    res.json({ products, totals: { count: products.length, published: products.filter((p) => p.status === 'publie').length } });
  });

  router.post('/admin/products/:id/archive', requireAdmin, (req: AuthReq, res) => {
    const existing = db.prepare('SELECT id, title, vendor_id FROM products WHERE id = ?').get(req.params.id) as
      | { id: string; title: string; vendor_id: string }
      | undefined;
    if (!existing) return res.status(404).json({ error: 'Produit introuvable.' });
    db.prepare("UPDATE products SET status = 'archive', updated_at = ? WHERE id = ?").run(
      new Date().toISOString(),
      req.params.id
    );
    writeAuditLog({
      actorId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      action: 'PRODUCT_ARCHIVED_BY_ADMIN',
      targetType: 'product',
      targetId: req.params.id,
      details: `Fiche « ${existing.title} » dépubliée par l’administration`,
    });
    res.json({ archived: true });
  });

  // Vendor 360°: profile, shop, KPIs, KYC, decision history & recent orders
  router.get('/admin/vendors/:id/detail', requireAdmin, (req, res) => {
    const vendorRow = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'vendor'").get(req.params.id) as
      | Record<string, unknown>
      | undefined;
    if (!vendorRow) return res.status(404).json({ error: 'Vendeur introuvable.' });
    const shopRow = db.prepare('SELECT * FROM shops WHERE vendor_id = ?').get(req.params.id) as Record<string, unknown> | undefined;

    const items = db
      .prepare('SELECT * FROM order_items WHERE vendor_id = ?')
      .all(req.params.id) as Array<Record<string, unknown>>;
    const paidItems = items.filter(() => true);
    void paidItems;
    const orderIds = [...new Set(items.map((i) => String(i.order_id)))];
    const ordersById = new Map<string, Record<string, unknown>>();
    for (const oid of orderIds) {
      const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(oid) as Record<string, unknown> | undefined;
      if (o) ordersById.set(oid, o);
    }
    const paidOrderIds = new Set(
      [...ordersById.values()].filter((o) => String(o.payment_status) === 'paid').map((o) => String(o.id))
    );
    let revenue = 0;
    let attributedCommission = 0;
    for (const it of items) {
      if (!paidOrderIds.has(String(it.order_id))) continue;
      revenue += Number(it.unit_price) * Number(it.quantity) + Number(it.delivery_fee);
      const o = ordersById.get(String(it.order_id))!;
      const orderSubtotal = Number(o.subtotal);
      if (orderSubtotal > 0 && Number(o.commission_amount) > 0) {
        attributedCommission += Math.round((Number(o.commission_amount) * (Number(it.unit_price) * Number(it.quantity))) / orderSubtotal);
      }
    }
    const refundedOrders = [...ordersById.values()].filter((o) => String(o.payment_status) === 'refunded').length;

    const kycDocs = db
      .prepare('SELECT id, doc_type, file_name, review_status, uploaded_at, purge_scheduled_at FROM kyc_documents WHERE vendor_id = ? ORDER BY uploaded_at DESC')
      .all(req.params.id)
      .map((d: Record<string, unknown>) => ({
        id: String(d.id),
        docType: String(d.doc_type),
        fileName: String(d.file_name),
        reviewStatus: String(d.review_status),
        uploadedAt: String(d.uploaded_at),
        purgeScheduledAt: d.purge_scheduled_at ? String(d.purge_scheduled_at) : null,
      }));

    const decisions = db
      .prepare("SELECT action, details, actor_email, created_at FROM audit_logs WHERE target_type = 'user' AND target_id = ? ORDER BY created_at DESC LIMIT 15")
      .all(req.params.id)
      .map((a: Record<string, unknown>) => ({
        action: String(a.action),
        details: String(a.details),
        actorEmail: String(a.actor_email),
        createdAt: String(a.created_at),
      }));

    const payoutsTotal = (db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM vendor_payouts WHERE vendor_id = ?').get(req.params.id) as { total: number }).total;

    const reviews = db.prepare("SELECT rating FROM reviews r JOIN products p ON p.id = r.product_id WHERE p.vendor_id = ? AND r.moderation_status = 'visible'").all(req.params.id) as Array<{ rating: number }>;
    const avgRating = reviews.length ? Number((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)) : 0;

    res.json({
      vendor: mapUserRow(vendorRow),
      shop: mapShopRow(shopRow),
      kpis: {
        revenue,
        attributedCommission,
        net: revenue - attributedCommission,
        paidOut: Number(payoutsTotal),
        outstanding: revenue - attributedCommission - Number(payoutsTotal),
        ordersCount: paidOrderIds.size,
        refundedOrders,
        refundRatePct: orderIds.length ? Math.round((refundedOrders / orderIds.length) * 1000) / 10 : 0,
        avgRating,
        reviewCount: reviews.length,
        publishedProducts: (db.prepare("SELECT COUNT(*) AS c FROM products WHERE vendor_id = ? AND status = 'publie'").get(req.params.id) as { c: number }).c,
      },
      kycDocs,
      decisions,
    });
  });

  // Promo codes CRUD
  router.get('/admin/promos', requireAdmin, (_req, res) => {
    const promos = db
      .prepare('SELECT * FROM promo_codes ORDER BY created_at DESC')
      .all()
      .map((p: Record<string, unknown>) => ({
        code: String(p.code),
        discountType: String(p.discount_type),
        discountValue: Number(p.discount_value),
        minOrderAmount: Number(p.min_order_amount),
        maxUses: p.max_uses === null ? null : Number(p.max_uses),
        usedCount: Number(p.used_count),
        active: Boolean(p.active),
        expiresAt: p.expires_at ? String(p.expires_at) : null,
        createdBy: String(p.created_by),
        createdAt: String(p.created_at),
      }));
    res.json({ promos });
  });

  router.post('/admin/promos', requireAdmin, (req: AuthReq, res) => {
    const { code, discountType, discountValue, minOrderAmount, maxUses, expiresAt } = req.body as {
      code?: string;
      discountType?: 'percent' | 'fixed';
      discountValue?: number;
      minOrderAmount?: number;
      maxUses?: number | null;
      expiresAt?: string | null;
    };
    const normalized = code?.trim().toUpperCase();
    if (!normalized || normalized.length < 3) {
      return res.status(400).json({ error: 'Code requis (3 caractères minimum).' });
    }
    if (discountType !== 'percent' && discountType !== 'fixed') {
      return res.status(400).json({ error: 'Type de remise invalide (percent ou fixed).' });
    }
    const value = Math.round(Number(discountValue));
    if (!Number.isFinite(value) || value <= 0 || (discountType === 'percent' && value > 100)) {
      return res.status(400).json({ error: 'Valeur de remise invalide.' });
    }
    if (db.prepare('SELECT code FROM promo_codes WHERE code = ?').get(normalized)) {
      return res.status(409).json({ error: 'Ce code existe déjà.' });
    }
    db.prepare(
      `INSERT INTO promo_codes (code, discount_type, discount_value, min_order_amount, max_uses, used_count, active, expires_at, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?, ?)`
    ).run(
      normalized,
      discountType,
      value,
      Math.max(0, Math.round(Number(minOrderAmount || 0))),
      maxUses ? Math.round(Number(maxUses)) : null,
      expiresAt?.trim() || null,
      req.authUser!.email,
      new Date().toISOString()
    );
    writeAuditLog({
      actorId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      action: 'PROMO_CREATED',
      targetType: 'promo_code',
      targetId: normalized,
      details: `${discountType === 'percent' ? value + '%' : value + ' FCFA'}${expiresAt ? ` jusqu'au ${expiresAt}` : ''}`,
    });
    res.status(201).json({ created: true, code: normalized });
  });

  router.put('/admin/promos/:code', requireAdmin, (req: AuthReq, res) => {
    const code = req.params.code.toUpperCase();
    const existing = db.prepare('SELECT code FROM promo_codes WHERE code = ?').get(code);
    if (!existing) return res.status(404).json({ error: 'Code introuvable.' });
    const { active } = req.body as { active?: boolean };
    db.prepare('UPDATE promo_codes SET active = ? WHERE code = ?').run(active === false ? 0 : 1, code);
    writeAuditLog({
      actorId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      action: active === false ? 'PROMO_DISABLED' : 'PROMO_ENABLED',
      targetType: 'promo_code',
      targetId: code,
      details: active === false ? 'Code désactivé' : 'Code activé',
    });
    res.json({ updated: true });
  });

  router.delete('/admin/promos/:code', requireAdmin, (req: AuthReq, res) => {
    const code = req.params.code.toUpperCase();
    const existing = db.prepare('SELECT code FROM promo_codes WHERE code = ?').get(code);
    if (!existing) return res.status(404).json({ error: 'Code introuvable.' });
    db.prepare('DELETE FROM promo_codes WHERE code = ?').run(code);
    writeAuditLog({
      actorId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      action: 'PROMO_DELETED',
      targetType: 'promo_code',
      targetId: code,
      details: 'Code supprimé',
    });
    res.json({ deleted: true });
  });

  // Public promo validation (rate limited, no auth)
  router.post('/promo/validate', rateLimit(30, 60_000), (req, res) => {
    const { code, amount } = req.body as { code?: string; amount?: number };
    const normalized = code?.trim().toUpperCase();
    if (!normalized) return res.status(400).json({ error: 'Code requis.' });
    const grandBefore = Math.max(0, Math.round(Number(amount || 0)));
    const row = db.prepare('SELECT * FROM promo_codes WHERE code = ?').get(normalized) as Record<string, unknown> | undefined;
    if (!row || !Number(row.active)) return res.status(404).json({ error: 'Code promotionnel inconnu ou désactivé.' });
    if (row.expires_at && Date.now() > Date.parse(String(row.expires_at))) {
      return res.status(400).json({ error: 'Ce code promotionnel a expiré.' });
    }
    if (Number(row.min_order_amount) > grandBefore) {
      return res.status(400).json({ error: `Ce code s’applique à partir de ${Number(row.min_order_amount)} FCFA d’achat.` });
    }
    if (row.max_uses !== null && Number(row.used_count) >= Number(row.max_uses)) {
      return res.status(400).json({ error: 'Ce code promotionnel a atteint sa limite d’utilisation.' });
    }
    const discount =
      String(row.discount_type) === 'percent'
        ? Math.round((grandBefore * Math.min(100, Number(row.discount_value))) / 100)
        : Math.min(Number(row.discount_value), grandBefore);
    res.json({ valid: true, code: normalized, discountType: String(row.discount_type), discountValue: Number(row.discount_value), discount });
  });

  // System health & maintenance stats
  router.get('/admin/system', requireAdmin, (_req: AuthReq, res) => {
    const dbStats = fs.statSync(DB_PATH);
    let walSize = 0;
    try {
      walSize = fs.statSync(DB_PATH + '-wal').size;
    } catch {
      walSize = 0;
    }
    const count = (sql: string) => Number((db.prepare(sql).get() as { c: number }).c);
    let uploadsCount = 0;
    let uploadsSize = 0;
    try {
      for (const f of fs.readdirSync(UPLOADS_PATH)) {
        uploadsCount += 1;
        try {
          uploadsSize += fs.statSync(path.join(UPLOADS_PATH, f)).size;
        } catch {
          // ignore
        }
      }
    } catch {
      // no uploads dir
    }
    res.json({
      uptimeSec: Math.round(process.uptime()),
      nodeVersion: process.version,
      memoryMb: Math.round(process.memoryUsage().rss / 1_048_576),
      database: {
        path: DB_PATH,
        sizeBytes: dbStats.size,
        walBytes: walSize,
        users: count('SELECT COUNT(*) AS c FROM users'),
        vendors: count("SELECT COUNT(*) AS c FROM users WHERE role = 'vendor'"),
        products: count('SELECT COUNT(*) AS c FROM products'),
        orders: count('SELECT COUNT(*) AS c FROM orders'),
        reviews: count('SELECT COUNT(*) AS c FROM reviews'),
        messages: count('SELECT COUNT(*) AS c FROM messages'),
        payouts: count('SELECT COUNT(*) AS c FROM vendor_payouts'),
        outboxPending: count('SELECT COUNT(*) AS c FROM outbox_emails WHERE sent_at IS NULL'),
        outboxFailed: count('SELECT COUNT(*) AS c FROM outbox_emails WHERE sent_at IS NULL AND last_error IS NOT NULL'),
      },
      uploads: { count: uploadsCount, sizeBytes: uploadsSize },
      sseClients: sseClients.size,
      maintenance: getMaintenanceStats(),
    });
  });

  // Backups: create (SQLite VACUUM INTO), list, download
  router.post('/admin/backups', requireAdmin, (req: AuthReq, res) => {
    try {
      const backupsDir = path.join(path.dirname(DB_PATH), 'backups');
      fs.mkdirSync(backupsDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const fileName = `simcova-backup-${stamp}.db`;
      const target = path.join(backupsDir, fileName);
      db.prepare(`VACUUM INTO '${target.replace(/'/g, "''")}'`).run();
      writeAuditLog({
        actorId: req.authUser!.id,
        actorEmail: req.authUser!.email,
        action: 'BACKUP_CREATED',
        targetType: 'system',
        targetId: fileName,
        details: 'Instantané SQLite (VACUUM INTO)',
      });
      res.status(201).json({ created: true, fileName, sizeBytes: fs.statSync(target).size });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Sauvegarde impossible.' });
    }
  });

  router.get('/admin/backups', requireAdmin, (_req, res) => {
    const backupsDir = path.join(path.dirname(DB_PATH), 'backups');
    const backups: Array<{ fileName: string; sizeBytes: number; createdAt: string }> = [];
    try {
      for (const f of fs.readdirSync(backupsDir).sort().reverse()) {
        if (!f.endsWith('.db')) continue;
        const full = path.join(backupsDir, f);
        try {
          const st = fs.statSync(full);
          backups.push({ fileName: f, sizeBytes: st.size, createdAt: st.mtime.toISOString() });
        } catch {
          // ignore unreadable
        }
      }
    } catch {
      // no backups yet
    }
    res.json({ backups });
  });

  router.get('/admin/backups/:fileName/download', requireAdmin, (req, res) => {
    const safeName = path.basename(req.params.fileName);
    const backupsDir = path.join(path.dirname(DB_PATH), 'backups');
    const resolved = path.resolve(backupsDir, safeName);
    if (!resolved.startsWith(backupsDir + path.sep) || !fs.existsSync(resolved)) {
      return res.status(404).json({ error: 'Sauvegarde introuvable.' });
    }
    res.download(resolved, safeName);
  });

  // Segmented email campaigns (queued into the outbox, flushed by the SMTP job)
  router.post('/admin/email-campaign', requireAdmin, (req: AuthReq, res) => {
    const { segment, subject, body } = req.body as { segment?: 'buyers' | 'vendors' | 'all'; subject?: string; body?: string };
    if (!subject?.trim() || !body?.trim()) {
      return res.status(400).json({ error: 'Objet et message requis.' });
    }
    const target: 'buyers' | 'vendors' | 'all' = segment === 'buyers' || segment === 'vendors' ? segment : 'all';
    let recipients: string[] = [];
    if (target === 'buyers' || target === 'all') {
      recipients.push(
        ...((db.prepare('SELECT DISTINCT LOWER(buyer_email) AS email FROM orders').all() as Array<{ email: string }>).map((r) => r.email))
      );
    }
    if (target === 'vendors' || target === 'all') {
      recipients.push(
        ...((db.prepare("SELECT LOWER(email) AS email FROM users WHERE role = 'vendor'").all() as Array<{ email: string }>).map((r) => r.email))
      );
    }
    recipients = [...new Set(recipients)];
    for (const to of recipients) {
      queueTransactionalEmail({
        toEmail: to,
        subject: subject.trim(),
        bodyText: body.trim(),
      });
    }
    writeAuditLog({
      actorId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      action: 'EMAIL_CAMPAIGN_QUEUED',
      targetType: 'campaign',
      targetId: target,
      details: `« ${subject.trim()} » → ${recipients.length} destinataire(s) (${target})`,
    });
    res.status(201).json({ queued: recipients.length, segment: target });
  });

  router.get('/admin/audit-logs', requireAdmin, (_req, res) => {
    const logs = db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 80').all().map((l: Record<string, unknown>) => ({
      id: String(l.id),
      actorId: String(l.actor_id),
      actorEmail: String(l.actor_email),
      action: String(l.action),
      targetType: String(l.target_type),
      targetId: String(l.target_id),
      details: String(l.details),
      createdAt: String(l.created_at),
    }));
    const emails = db.prepare('SELECT * FROM outbox_emails ORDER BY created_at DESC LIMIT 40').all().map((e: Record<string, unknown>) => ({
      id: String(e.id),
      toEmail: String(e.to_email),
      subject: String(e.subject),
      bodyText: String(e.body_text),
      actionUrl: e.action_url ? String(e.action_url) : null,
      actionLabel: e.action_label ? String(e.action_label) : null,
      sentAt: e.sent_at ? String(e.sent_at) : null,
      attempts: Number(e.attempts ?? 0),
      lastError: e.last_error ? String(e.last_error) : null,
      createdAt: String(e.created_at),
    }));
    res.json({ logs, emails });
  });

  // =========================================================================
  // PWA WEB PUSH SUBSCRIPTIONS & REAL-TIME STREAM (EXF-607..610)
  // =========================================================================

  router.post('/push/subscribe', (req, res) => {
    const { endpoint, subscription, preferences } = req.body as {
      endpoint?: string;
      subscription?: Record<string, unknown>;
      preferences?: { nouveautes: boolean; promotions: boolean; annonces: boolean };
    };
    const ep = endpoint || `pwa-device-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO push_subscriptions (id, endpoint, subscription_json, preferences_json, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET
        subscription_json = excluded.subscription_json,
        preferences_json = excluded.preferences_json
    `).run(
      `sub-${crypto.randomUUID().slice(0, 8)}`,
      ep,
      JSON.stringify(subscription || { endpoint: ep }),
      JSON.stringify(preferences || { nouveautes: true, promotions: true, annonces: true }),
      now
    );
    res.status(201).json({ subscribed: true, endpoint: ep });
  });

  router.put('/push/preferences', (req, res) => {
    const { endpoint, preferences } = req.body as {
      endpoint?: string;
      preferences?: { nouveautes: boolean; promotions: boolean; annonces: boolean };
    };
    if (!endpoint) return res.status(400).json({ error: 'Identifiant d’abonnement requis.' });
    db.prepare('UPDATE push_subscriptions SET preferences_json = ? WHERE endpoint = ?').run(
      JSON.stringify(preferences || { nouveautes: true, promotions: true, annonces: true }),
      endpoint
    );
    res.json({ updated: true });
  });

  router.delete('/push/unsubscribe', (req, res) => {
    const { endpoint } = req.body as { endpoint?: string };
    if (endpoint) {
      db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
    }
    res.json({ unsubscribed: true });
  });

  router.get('/notifications/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    res.write(': connected\n\n');
    registerSseClient(res);
  });

  return router;
}

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';
import { encryptKycPayload, hashPassword } from './crypto.ts';
import type { Category, PlatformRule, PlatformSettings, RuleId } from '../src/shared/types.ts';

/**
 * Dual-mode data layer:
 *  - PostgreSQL (Neon, Vercel…) when DATABASE_URL is set — async pool
 *  - SQLite (local dev & demo, zero config) otherwise — sync driver wrapped in the same async API
 *
 * Both engines share the SAME schema (portable TEXT/INTEGER DDL) so every query,
 * seed and test runs identically on either backend. The adapter only normalizes
 * placeholders (? → $n), bigints and upsert syntax for PostgreSQL.
 */
export const IS_POSTGRES = Boolean(process.env.DATABASE_URL?.trim());

// ---------------------------------------------------------------------------
// Unified schema (portable SQLite ↔ PostgreSQL DDL, semicolons only at ends)
// ---------------------------------------------------------------------------
const DDL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'vendor')),
  email_verified INTEGER NOT NULL DEFAULT 0,
  verification_token TEXT,
  verification_expires_at TEXT,
  reset_token TEXT,
  reset_expires_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('en_attente', 'valide', 'rejete', 'certifie', 'suspendu')),
  rejection_reason TEXT,
  badges_json TEXT NOT NULL DEFAULT '[]',
  custom_fields_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kyc_documents (
  id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  encrypted_payload TEXT NOT NULL,
  iv_hex TEXT NOT NULL,
  auth_tag_hex TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'en_attente' CHECK (review_status IN ('en_attente', 'approuve', 'rejete')),
  rejection_reason TEXT,
  uploaded_at TEXT NOT NULL,
  reviewed_at TEXT,
  purge_scheduled_at TEXT
);

CREATE TABLE IF NOT EXISTS shops (
  id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  logo_url TEXT,
  contact_email TEXT NOT NULL,
  contact_phone TEXT,
  city TEXT,
  default_delivery_fee INTEGER NOT NULL DEFAULT 2000,
  default_delivery_delay TEXT NOT NULL DEFAULT '24 à 72h',
  bank_name TEXT,
  bank_account_holder TEXT,
  bank_iban TEXT,
  bank_bic TEXT,
  bank_instructions TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  forbidden INTEGER NOT NULL DEFAULT 0,
  required_badge TEXT
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES categories(id),
  price INTEGER NOT NULL,
  condition TEXT NOT NULL CHECK (condition IN ('Neuf', 'Reconditionné', 'Artisanal')),
  status TEXT NOT NULL CHECK (status IN ('brouillon', 'publie', 'archive')),
  stock INTEGER NOT NULL DEFAULT 0,
  keywords_json TEXT NOT NULL DEFAULT '[]',
  media_json TEXT NOT NULL DEFAULT '[]',
  video_url TEXT,
  variants_json TEXT NOT NULL DEFAULT '[]',
  delivery_fee INTEGER NOT NULL DEFAULT 2000,
  delivery_zones_json TEXT NOT NULL DEFAULT '[]',
  delivery_delay TEXT NOT NULL DEFAULT '24 à 72h',
  payment_methods_json TEXT NOT NULL DEFAULT '["jumia_card","mobile_money_orange","mobile_money_mtn","mobile_money_wave"]',
  view_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  buyer_name TEXT NOT NULL,
  buyer_email TEXT NOT NULL,
  buyer_phone TEXT,
  shipping_address TEXT NOT NULL,
  delivery_zone TEXT NOT NULL,
  subtotal INTEGER NOT NULL,
  delivery_total INTEGER NOT NULL,
  total_amount INTEGER NOT NULL,
  vat_amount INTEGER NOT NULL DEFAULT 0,
  commission_amount INTEGER NOT NULL DEFAULT 0,
  promo_code TEXT,
  discount_amount INTEGER NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL,
  payment_status TEXT NOT NULL CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded', 'expired')),
  payment_mode TEXT NOT NULL DEFAULT 'full',
  deposit_percent INTEGER NOT NULL DEFAULT 100,
  paid_amount INTEGER NOT NULL DEFAULT 0,
  balance_due INTEGER NOT NULL DEFAULT 0,
  has_custom_offer INTEGER NOT NULL DEFAULT 0,
  bank_transfer_ref TEXT,
  quote_thread_id TEXT,
  tracking_token_version INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  variant_id TEXT,
  vendor_id TEXT NOT NULL REFERENCES users(id),
  product_title TEXT NOT NULL,
  variant_label TEXT,
  quantity INTEGER NOT NULL,
  unit_price INTEGER NOT NULL,
  delivery_fee INTEGER NOT NULL,
  carrier TEXT,
  tracking_number TEXT,
  item_status TEXT NOT NULL DEFAULT 'creee',
  custom_specs_json TEXT
);

CREATE TABLE IF NOT EXISTS order_events (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  note TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'jumia_africa',
  provider_ref TEXT NOT NULL UNIQUE,
  method TEXT NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL,
  webhook_events_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  vendor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  buyer_name TEXT NOT NULL,
  buyer_email TEXT NOT NULL,
  thread_token_version INTEGER NOT NULL DEFAULT 1,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('buyer', 'vendor', 'admin')),
  body TEXT NOT NULL,
  read_by_vendor INTEGER NOT NULL DEFAULT 0,
  reported INTEGER NOT NULL DEFAULT 0,
  report_count INTEGER NOT NULL DEFAULT 0,
  hidden_by_moderation INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS blocked_threads (
  thread_id TEXT PRIMARY KEY,
  blocked_by TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  buyer_name TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL,
  vendor_reply TEXT,
  vendor_replied_at TEXT,
  report_count INTEGER NOT NULL DEFAULT 0,
  moderation_status TEXT NOT NULL DEFAULT 'visible' CHECK (moderation_status IN ('visible', 'signale', 'retire')),
  created_at TEXT NOT NULL,
  UNIQUE(product_id, order_id)
);

CREATE TABLE IF NOT EXISTS platform_rules (
  rule_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  help_text TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  value_json TEXT NOT NULL DEFAULT '{}',
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS platform_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  currency TEXT NOT NULL DEFAULT 'FCFA',
  default_delivery_policy TEXT NOT NULL,
  legal_mentions TEXT NOT NULL,
  cgv_text TEXT NOT NULL,
  support_email TEXT NOT NULL,
  support_phone TEXT NOT NULL,
  kyc_retention_days INTEGER NOT NULL DEFAULT 30,
  review_processing_delay_label TEXT NOT NULL DEFAULT 'Sous 24 à 48h ouvrées',
  default_deposit_percent INTEGER NOT NULL DEFAULT 30,
  bank_transfer_threshold INTEGER NOT NULL DEFAULT 5000000,
  commission_rate_percent INTEGER NOT NULL DEFAULT 0,
  vat_rate_percent INTEGER NOT NULL DEFAULT 0,
  maintenance_mode INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL UNIQUE,
  subscription_json TEXT NOT NULL,
  preferences_json TEXT NOT NULL DEFAULT '{"nouveautes":true,"promotions":true,"annonces":true}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS push_alerts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  deep_link TEXT NOT NULL,
  alert_type TEXT NOT NULL DEFAULT 'nouveautes',
  sent_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  details TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox_emails (
  id TEXT PRIMARY KEY,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  action_url TEXT,
  action_label TEXT,
  sent_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vendor_payouts (
  id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  method TEXT NOT NULL DEFAULT 'bank_transfer',
  reference TEXT,
  note TEXT,
  period_start TEXT,
  period_end TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS promo_codes (
  code TEXT PRIMARY KEY,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
  discount_value INTEGER NOT NULL CHECK (discount_value > 0),
  min_order_amount INTEGER NOT NULL DEFAULT 0,
  max_uses INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS media_files (
  id TEXT PRIMARY KEY,
  mime_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  data_base64 TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

// ---------------------------------------------------------------------------
// Statement wrapper: identical .run/.get/.all API on both engines
// ---------------------------------------------------------------------------
interface Statement {
  run(...params: unknown[]): Promise<{ changes?: number | bigint }>;
  get(...params: unknown[]): Promise<Record<string, unknown> | undefined>;
  all(...params: unknown[]): Promise<Array<Record<string, unknown>>>;
}

/** Converts `?` placeholders to `$1..$n` for PostgreSQL, ignoring ? inside string literals. */
function toPgPlaceholders(sql: string): string {
  let out = '';
  let inString = false;
  let n = 0;
  for (const ch of sql) {
    if (ch === "'") inString = !inString;
    if (ch === '?' && !inString) {
      n += 1;
      out += `$${n}`;
    } else {
      out += ch;
    }
  }
  return out;
}

/** Normalizes PostgreSQL row values to the SQLite-shaped primitives used across the codebase. */
function normalizeRow(row: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!row) return row;
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === 'bigint') row[k] = Number(v);
    else if (typeof v === 'object' && v !== null && v instanceof Date) row[k] = v.toISOString();
  }
  return row;
}

// --- SQLite backend (sync driver behind the async facade) -------------------
const DATA_DIR = path.resolve(process.cwd(), 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const DB_PATH = process.env.SIMCOVA_DB_PATH
  ? path.resolve(process.env.SIMCOVA_DB_PATH)
  : path.join(DATA_DIR, 'simcova.db');
export const UPLOADS_PATH = UPLOADS_DIR;

let sqliteDb: DatabaseSync | null = null;
function getSqlite(): DatabaseSync {
  if (!sqliteDb) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    try {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    } catch {
      // read-only filesystem (serverless) — uploads go to the DB in that mode
    }
    sqliteDb = new DatabaseSync(DB_PATH);
    sqliteDb.exec('PRAGMA journal_mode = WAL;');
    sqliteDb.exec('PRAGMA foreign_keys = ON;');
  }
  return sqliteDb;
}

function sqliteStatement(sql: string): Statement {
  const stmt = () => getSqlite().prepare(sql);
  const bind = (params: unknown[]) =>
    params.map((p) => {
      if (typeof p === 'boolean') return p ? 1 : 0; // node:sqlite binds numbers
      if (typeof p === 'number' && !Number.isInteger(p) && !Number.isSafeInteger(p)) return p;
      return p;
    });
  return {
    async run(...params: unknown[]) {
      const info = (getSqlite().prepare(sql) as unknown as { run: (...p: unknown[]) => { changes: number | bigint } }).run(...bind(params));
      return { changes: info?.changes ?? 0 };
    },
    async get(...params: unknown[]) {
      return (getSqlite().prepare(sql) as unknown as { get: (...p: unknown[]) => Record<string, unknown> | undefined }).get(...bind(params));
    },
    async all(...params: unknown[]) {
      return (getSqlite().prepare(sql) as unknown as { all: (...p: unknown[]) => Array<Record<string, unknown>> }).all(...bind(params));
    },
  };
}

// --- PostgreSQL backend (Neon/Vercel) ---------------------------------------
declare global {
  // eslint-disable-next-line no-var
  var __simcovaPgPool: pg.Pool | undefined;
}

function getPool(): pg.Pool {
  if (!globalThis.__simcovaPgPool) {
    globalThis.__simcovaPgPool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.PGPOOL_MAX || 5),
      ssl: process.env.DATABASE_URL?.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
    });
  }
  return globalThis.__simcovaPgPool;
}

function pgStatement(sql: string): Statement {
  const text = toPgPlaceholders(sql);
  return {
    async run(...params: unknown[]) {
      const res = await getPool().query(text, params);
      return { changes: res.rowCount ?? 0 };
    },
    async get(...params: unknown[]) {
      const res = await getPool().query(text, params);
      return normalizeRow(res.rows[0]);
    },
    async all(...params: unknown[]) {
      const res = await getPool().query(text, params);
      return res.rows.map((r) => normalizeRow(r as Record<string, unknown>)) as Array<Record<string, unknown>>;
    },
  };
}

/** Unified DB facade — same call sites for SQLite and PostgreSQL. */
export const db = {
  isPostgres: IS_POSTGRES,
  prepare(sql: string): Statement {
    return IS_POSTGRES ? pgStatement(sql) : sqliteStatement(sql);
  },
  async exec(sql: string): Promise<void> {
    if (IS_POSTGRES) {
      const statements = sql
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);
      for (const stmt of statements) await getPool().query(stmt);
    } else {
      getSqlite().exec(sql);
    }
  },
  /** SQLite-only helpers degrade gracefully on PostgreSQL. */
  vacuumInto(_target: string): boolean {
    if (IS_POSTGRES) return false;
    getSqlite().exec(`VACUUM INTO '${_target.replace(/'/g, "''")}'`);
    return true;
  },
};

// ---------------------------------------------------------------------------
// Migrations + seed (both engines)
// ---------------------------------------------------------------------------
let initPromise: Promise<void> | null = null;

export function initDatabase(): Promise<void> {
  if (!initPromise) {
    initPromise = doInit().catch((err) => {
      initPromise = null; // allow retry on next call after a cold-start failure
      throw err;
    });
  }
  return initPromise;
}

async function doInit(): Promise<void> {
  await db.exec(DDL);

  const ensureColumns = async (table: string, cols: Array<[string, string]>) => {
    if (!IS_POSTGRES) {
      const existing = await db.prepare(`PRAGMA table_info(${table})`).all();
      const names = new Set(existing.map((c) => String(c.name)));
      for (const [col, def] of cols) {
        if (!names.has(col)) await db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def};`);
      }
      return;
    }
    // PostgreSQL path
    if (IS_POSTGRES) {
      for (const [col, def] of cols) {
        const found = await db
          .prepare(
            `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`
          )
          .get(table, col);
        if (!found) await db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def};`);
      }
    }
  };

  await ensureColumns('order_items', [
    ['variant_id', 'TEXT'],
    ['custom_specs_json', 'TEXT'],
  ]);
  await ensureColumns('shops', [
    ['bank_name', 'TEXT'],
    ['bank_account_holder', 'TEXT'],
    ['bank_iban', 'TEXT'],
    ['bank_bic', 'TEXT'],
    ['bank_instructions', 'TEXT'],
  ]);
  await ensureColumns('orders', [
    ['payment_mode', "TEXT NOT NULL DEFAULT 'full'"],
    ['deposit_percent', 'INTEGER NOT NULL DEFAULT 100'],
    ['paid_amount', 'INTEGER NOT NULL DEFAULT 0'],
    ['balance_due', 'INTEGER NOT NULL DEFAULT 0'],
    ['has_custom_offer', 'INTEGER NOT NULL DEFAULT 0'],
    ['bank_transfer_ref', 'TEXT'],
    ['quote_thread_id', 'TEXT'],
    ['vat_amount', 'INTEGER NOT NULL DEFAULT 0'],
    ['commission_amount', 'INTEGER NOT NULL DEFAULT 0'],
    ['promo_code', 'TEXT'],
    ['discount_amount', 'INTEGER NOT NULL DEFAULT 0'],
  ]);
  await ensureColumns('platform_settings', [
    ['default_deposit_percent', 'INTEGER NOT NULL DEFAULT 30'],
    ['bank_transfer_threshold', 'INTEGER NOT NULL DEFAULT 5000000'],
    ['commission_rate_percent', 'INTEGER NOT NULL DEFAULT 0'],
    ['vat_rate_percent', 'INTEGER NOT NULL DEFAULT 0'],
    ['maintenance_mode', 'INTEGER NOT NULL DEFAULT 0'],
  ]);
  await ensureColumns('outbox_emails', [
    ['sent_at', 'TEXT'],
    ['attempts', 'INTEGER NOT NULL DEFAULT 0'],
    ['last_error', 'TEXT'],
  ]);
  await ensureColumns('products', [['view_count', 'INTEGER NOT NULL DEFAULT 0']]);

  await seedInitialData();
}

export async function seedInitialData(): Promise<void> {
  const now = new Date().toISOString();
  const isDemoMode = process.env.SIMCOVA_DEMO_MODE === 'true';

  // 1. Platform Settings
  const existingSettings = await db.prepare('SELECT id FROM platform_settings WHERE id = 1').get();
  if (!existingSettings) {
    await db.prepare(`
      INSERT INTO platform_settings (id, currency, default_delivery_policy, legal_mentions, cgv_text, support_email, support_phone, kyc_retention_days, review_processing_delay_label, default_deposit_percent, bank_transfer_threshold, commission_rate_percent, vat_rate_percent, maintenance_mode)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0)
    `).run(
      'FCFA',
      'Expédition nationale sous 24 à 72h ouvrées. Forfait standard 2 000 FCFA sauf mention spécifique du vendeur.',
      'SIMCOVA Marketplace SAS — Plateforme de commerce en ligne multi-vendeurs. Hébergement sécurisé avec chiffrement HTTPS et protection des pièces justificatives.',
      'Conditions Générales de Vente SIMCOVA : Les achats sont effectués sans création de compte acheteur. Chaque commande génère un lien de suivi personnel sécurisé. Les paiements sont traités via l’API Jumia Africa ou par virement bancaire contrôlé pour les commandes d’équipements lourds. Les échanges acheteur-vendeur s’effectuent obligatoirement sur la messagerie SIMCOVA.',
      'support@simcova.africa',
      '+225 07 00 00 00 00',
      30,
      'Sous 24 à 48h ouvrées',
      30,
      5000000
    );
  }

  // 2. Default Rules RG-01 .. RG-10 (Chapitre 7, Tableau 16)
  const defaultRules: Array<Omit<PlatformRule, 'updatedAt'>> = [
    { ruleId: 'RG-01', title: 'Certification exigée pour publier', helpText: 'Lorsque cette règle est active, seuls les comptes disposant du badge « Vendeur certifié » peuvent publier des produits ; les autres peuvent préparer des brouillons.', enabled: false, valueJson: {}, updatedBy: 'Système (défaut)' },
    { ruleId: 'RG-02', title: 'Badges requis par type de catalogue', helpText: 'Exige un badge spécifique défini sur certaines catégories (ex. électronique ou cosmétique) avant toute publication.', enabled: false, valueJson: {}, updatedBy: 'Système (défaut)' },
    { ruleId: 'RG-03', title: 'Pièces justificatives requises', helpText: 'Définit la liste des justificatifs exigés à la soumission et pour obtenir la certification vendeur.', enabled: true, valueJson: { requiredDocs: ['Pièce d’identité officielle'], availableDocs: ['Pièce d’identité officielle', 'Registre du commerce (RCCM)', 'Justificatif de domicile'] }, updatedBy: 'Système (défaut)' },
    { ruleId: 'RG-04', title: 'Champs obligatoires d’inscription vendeur', helpText: 'Configure les champs obligatoires et facultatifs du formulaire public de création de compte vendeur, avec effet immédiat.', enabled: true, valueJson: { requiredFields: ['fullName', 'email', 'password', 'shopName'], optionalFields: ['phone', 'city', 'shopDescription'] }, updatedBy: 'Système (défaut)' },
    { ruleId: 'RG-05', title: 'Plafond sans certification', helpText: 'Limite le nombre maximal de produits publiés simultanément par un vendeur non encore certifié.', enabled: true, valueJson: { maxProducts: 10 }, updatedBy: 'Système (défaut)' },
    { ruleId: 'RG-06', title: 'Catégories autorisées et interdites', helpText: 'Contrôle en temps réel les catégories ouvertes à la publication sur SIMCOVA.', enabled: true, valueJson: {}, updatedBy: 'Système (défaut)' },
    { ruleId: 'RG-07', title: 'Politique de modération automatique', helpText: 'Nombre de signalements confirmés entraînant le masquage automatique d’un avis ou d’un message pour revue administrateur.', enabled: true, valueJson: { threshold: 3 }, updatedBy: 'Système (défaut)' },
    { ruleId: 'RG-08', title: 'Modes de paiement autorisés (Jumia Africa)', helpText: 'Sélectionne les moyens de paiement proposés aux acheteurs au passage en caisse.', enabled: true, valueJson: { methods: ['jumia_card', 'mobile_money_orange', 'mobile_money_mtn', 'mobile_money_wave', 'jumia_wallet'] }, updatedBy: 'Système (défaut)' },
    { ruleId: 'RG-09', title: 'Livraison par défaut', helpText: 'Zones de livraison proposées sur la plateforme et forfait national appliqué si un vendeur n’a pas défini de tarif spécifique.', enabled: true, valueJson: { defaultFlatFee: 2000, zones: [
      { zoneId: 'abidjan', zoneName: 'Abidjan / Capitale', fee: 1500 },
      { zoneId: 'national', zoneName: 'Intérieur du pays', fee: 3000 },
      { zoneId: 'regional', zoneName: 'Afrique de l’Ouest (CÉDÉAO)', fee: 6500 },
    ] }, updatedBy: 'Système (défaut)' },
    { ruleId: 'RG-10', title: 'Expiration des commandes impayées', helpText: 'Délai avant annulation automatique d’une commande restée en attente de paiement, avec lien de relance.', enabled: true, valueJson: { expirationHours: 48 }, updatedBy: 'Système (défaut)' },
  ];

  for (const r of defaultRules) {
    await db
      .prepare(
        `INSERT INTO platform_rules (rule_id, title, help_text, enabled, value_json, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(rule_id) DO NOTHING`
      )
      .run(r.ruleId, r.title, r.helpText, r.enabled ? 1 : 0, JSON.stringify(r.valueJson), r.updatedBy, now);
  }

  // 3. Categories — Machines, Tracteurs & Matériel Industriel
  const categories: Category[] = [
    { id: 'cat-tracteurs', name: 'Tracteurs & Engins Agricoles', slug: 'tracteurs-agricoles', active: true, forbidden: false, requiredBadge: 'Vendeur certifié' },
    { id: 'cat-chantier', name: 'BTP & Terrassement', slug: 'btp-terrassement', active: true, forbidden: false, requiredBadge: 'Vendeur certifié' },
    { id: 'cat-energie', name: 'Groupes Électrogènes', slug: 'groupes-electrogenes', active: true, forbidden: false, requiredBadge: null },
    { id: 'cat-atelier', name: 'Soudure & Atelier Pro', slug: 'soudure-atelier', active: true, forbidden: false, requiredBadge: null },
    { id: 'cat-hydraulique', name: 'Outils & Accessoires Agricoles', slug: 'outils-agricoles', active: true, forbidden: false, requiredBadge: null },
  ];
  for (const c of categories) {
    await db
      .prepare(`INSERT INTO categories (id, name, slug, active, forbidden, required_badge) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
      .run(c.id, c.name, c.slug, c.active ? 1 : 0, c.forbidden ? 1 : 0, c.requiredBadge);
  }

  // 4. Admin account + official dealership + 2 demo suppliers
  const adminEnvPass = process.env.SIMCOVA_ADMIN_PASSCODE?.trim();
  const existingAdmin = (await db.prepare("SELECT id, password_hash FROM users WHERE role = 'admin'").get()) as
    | { id: string; password_hash: string }
    | undefined;

  if (!existingAdmin) {
    const adminHash = adminEnvPass ? hashPassword(adminEnvPass) : isDemoMode ? hashPassword('AdminDemo2026!') : '';
    await db.prepare(`
      INSERT INTO users (id, email, full_name, password_hash, role, email_verified, status, badges_json, custom_fields_json, created_at)
      VALUES (?, ?, ?, ?, 'admin', 1, 'certifie', ?, ?, ?)
    `).run(
      'user-admin-1',
      'admin@simcova.africa',
      'Direction SIMCOVA',
      adminHash,
      JSON.stringify(['Boutique Officielle', 'Vendeur certifié']),
      JSON.stringify({ city: 'Abidjan', phone: '+225 07 00 00 00 00' }),
      now
    );

    await db.prepare(`
      INSERT INTO shops (id, vendor_id, slug, name, description, contact_email, contact_phone, city, default_delivery_fee, default_delivery_delay, bank_name, bank_account_holder, bank_iban, bank_bic, bank_instructions, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'shop-admin-1', 'user-admin-1', 'simcova-materiel-pro', 'SIMCOVA Matériel Pro',
      'Parc officiel SIMCOVA : tracteurs 4x4, groupes électrogènes haute capacité et équipements industriels contrôlés en atelier.',
      'parc@simcova.africa', '+225 07 00 00 00 00', 'Abidjan', 25000, '24 à 72h',
      'SGBCI — Société Générale Côte d’Ivoire', 'SIMCOVA MATÉRIEL PRO SAS', 'CI008 01112 000458912345 77', 'SGCICIAB',
      'Indiquez impérativement le numéro de commande SIMCOVA en libellé de virement puis transmettez le bordereau sur la messagerie sécurisée.',
      now
    );
  } else if (adminEnvPass && existingAdmin.password_hash !== '') {
    // Env passcode always overrides claimed fallback when explicitly configured
  }

  const vendorCountRow = (await db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'vendor'").get()) as { c: number };
  if (Number(vendorCountRow.c) === 0) {
    await db.prepare(`
      INSERT INTO users (id, email, full_name, password_hash, role, email_verified, status, badges_json, custom_fields_json, created_at)
      VALUES (?, ?, ?, ?, 'vendor', 1, 'certifie', ?, ?, ?)
    `).run(
      'user-vendor-dakar', 'contact@agriforce-sahel.sn', 'Ibrahima Ndiaye', '',
      JSON.stringify(['Vendeur certifié', 'Concessionnaire Agréé']),
      JSON.stringify({ city: 'Dakar', phone: '+221 77 123 45 67' }),
      now
    );

    await db.prepare(`
      INSERT INTO shops (id, vendor_id, slug, name, description, contact_email, contact_phone, city, default_delivery_fee, default_delivery_delay, bank_name, bank_account_holder, bank_iban, bank_bic, bank_instructions, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'shop-agriforce', 'user-vendor-dakar', 'agriforce-tracteurs-sahel', 'AgriForce Tracteurs & BTP',
      'Concessionnaire spécialisé en tracteurs agricoles 4RM, mini-pelles hydrauliques et charrues portées pour exploitations et chantiers.',
      'contact@agriforce-sahel.sn', '+221 77 123 45 67', 'Dakar', 35000, '48 à 96h',
      'CBAO Attijariwafa Bank Sénégal', 'AGRIFORCE TRACTEURS & BTP SARL', 'SN012 01201 036148892014 42', 'CBAOSNDA',
      'Virement SWIFT/UEMOA avec mention du numéro CMD SIMCOVA. Confirmation atelier sous 4h après réception.',
      now
    );

    await db.prepare(`
      INSERT INTO users (id, email, full_name, password_hash, role, email_verified, status, badges_json, custom_fields_json, created_at)
      VALUES (?, ?, ?, ?, 'vendor', 1, 'valide', ?, ?, ?)
    `).run(
      'user-vendor-kora', 'ventes@forge-ivoire.ci', 'Kouamé Konan', '',
      JSON.stringify([]),
      JSON.stringify({ city: 'Abidjan', phone: '+225 05 88 99 00 11' }),
      now
    );

    await db.prepare(`
      INSERT INTO shops (id, vendor_id, slug, name, description, contact_email, contact_phone, city, default_delivery_fee, default_delivery_delay, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'shop-forge-ivoire', 'user-vendor-kora', 'forge-ivoire-equipements', 'Forge Ivoire Équipements',
      'Distribution de postes à souder industriels MIG/TIG, compresseurs 200L et outillage de maintenance mécanique.',
      'ventes@forge-ivoire.ci', '+225 05 88 99 00 11', 'Abidjan', 15000, '24 à 48h',
      now
    );

    // Encrypted demo KYC for the Admin restricted viewer (EXF-104)
    const demoKycText = Buffer.from(
      'DOCUMENT JUSTIFICATIF SIMCOVA — VERIFICATION CONCESSIONNAIRE\nTitulaire: Ibrahima Ndiaye\nEntreprise: AgriForce Tracteurs & BTP\nRéférence RCCM: SN-DKR-2026-B-88492\nStatut: Pièce authentifiée par l’administration.',
      'utf8'
    );
    const enc = encryptKycPayload(demoKycText);
    await db.prepare(`
      INSERT INTO kyc_documents (id, vendor_id, doc_type, file_name, mime_type, encrypted_payload, iv_hex, auth_tag_hex, review_status, uploaded_at, reviewed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approuve', ?, ?)
    `).run('kyc-demo-1', 'user-vendor-dakar', 'Pièce d’identité officielle', 'rccm_agriforce_ndiaye.txt', 'text/plain', enc.encryptedBase64, enc.ivHex, enc.authTagHex, now, now);
  }

  // 5. Seed 6 heavy machinery & equipment products
  const prodCountRow = (await db.prepare('SELECT COUNT(*) as c FROM products').get()) as { c: number };
  if (Number(prodCountRow.c) === 0) {
    const zonesDefault = JSON.stringify([
      { zoneId: 'abidjan', zoneName: 'Abidjan / Capitale', fee: 25000 },
      { zoneId: 'national', zoneName: 'Intérieur du pays', fee: 55000 },
      { zoneId: 'regional', zoneName: 'Afrique de l’Ouest (CÉDÉAO)', fee: 120000 },
    ]);

    const productsSeed = [
      {
        id: 'prod-tracteur-120cv', vendorId: 'user-vendor-dakar', shopId: 'shop-agriforce',
        title: 'Tracteur Agricole 4x4 120 CV Cabine Climatisée',
        description: 'Tracteur utilitaire 4 roues motrices équipé d’un moteur diesel 4 cylindres turbo 120 CV, prise de force 540/1000 tr/min, relevage hydraulique arrière 4 200 kg et cabine ROPS climatisée.',
        categoryId: 'cat-tracteurs', price: 18500000, condition: 'Neuf', stock: 4,
        keywords: ['tracteur', '4x4', '120cv', 'agricole', 'diesel', 'cabine', 'hydraulique'],
        media: [
          { id: 'm1', url: '/src/assets/images/product_tractor_4wd_1795288076896.jpg', type: 'image', order: 0, alt: 'Tracteur agricole 4x4 rouge 120 CV en atelier béton' },
          { id: 'm2', url: '/src/assets/images/hero_heavy_machinery_1795288076600.jpg', type: 'image', order: 1, alt: 'Tracteur et mini-pelle sur parc matériel SIMCOVA' },
        ],
        variants: [
          { id: 'var-tr-120', label: 'Version Standard 120 CV', priceOverride: null, stock: 3 },
          { id: 'var-tr-140', label: 'Version 140 CV + Chargeur Frontal', priceOverride: 21800000, stock: 1 },
        ],
        deliveryFee: 45000, deliveryDelay: '72 à 96h (porte-char)',
      },
      {
        id: 'prod-minipelle-35t', vendorId: 'user-admin-1', shopId: 'shop-admin-1',
        title: 'Mini-Pelle Hydraulique sur Chenilles 3,5 Tonnes',
        description: 'Excavatrice compacte sur chenilles caoutchouc renforcées, moteur diesel Yanmar 25 kW, flèche déportable, godet de terrassement 50 cm et lame de remblayage frontale.',
        categoryId: 'cat-chantier', price: 14200000, condition: 'Neuf', stock: 3,
        keywords: ['mini-pelle', 'excavatrice', 'chenilles', 'btp', 'terrassement', 'hydraulique', 'chantier'],
        media: [
          { id: 'm3', url: '/src/assets/images/product_mini_excavator_1795288076740.jpg', type: 'image', order: 0, alt: 'Mini-pelle hydraulique orange et acier sur chenilles' },
          { id: 'm4', url: '/src/assets/images/hero_heavy_machinery_1795288076600.jpg', type: 'image', order: 1, alt: 'Mini-pelle BTP et tracteur en parc' },
        ],
        variants: [
          { id: 'var-pelle-std', label: 'Avec Godet 50 cm', priceOverride: null, stock: 2 },
          { id: 'var-pelle-brh', label: 'Pack Godet + Brise-Roche (BRH)', priceOverride: 15950000, stock: 1 },
        ],
        deliveryFee: 40000, deliveryDelay: '48 à 72h',
      },
      {
        id: 'prod-groupe-50kva', vendorId: 'user-admin-1', shopId: 'shop-admin-1',
        title: 'Groupe Électrogène Diesel Insonorisé 50 kVA Triphasé',
        description: 'Groupe électrogène industriel capoté insonorisé, alternateur sans balais 400/230V, démarreur électrique automatique ATS et réservoir grande autonomie 160 L pour chantiers et unités agricoles.',
        categoryId: 'cat-energie', price: 6850000, condition: 'Neuf', stock: 6,
        keywords: ['groupe', 'electrogene', '50kva', 'diesel', 'insonorise', 'triphase', 'energie'],
        media: [
          { id: 'm5', url: '/src/assets/images/product_diesel_generator_1795288076702.jpg', type: 'image', order: 0, alt: 'Groupe électrogène diesel 50 kVA gris anthracite et ambre' },
        ],
        variants: [
          { id: 'var-gen-50', label: 'Modèle 50 kVA (40 kW)', priceOverride: null, stock: 4 },
          { id: 'var-gen-80', label: 'Modèle 80 kVA (64 kW)', priceOverride: 8900000, stock: 2 },
        ],
        deliveryFee: 30000, deliveryDelay: '24 à 48h',
      },
      {
        id: 'prod-poste-souder-mig', vendorId: 'user-vendor-kora', shopId: 'shop-forge-ivoire',
        title: 'Poste à Souder Industriel MIG/TIG 315A sur Chariot',
        description: 'Station de soudage multiprocédés onduleur IGBT 315 Ampères avec chariot porte-bouteille acier renforcé, torche refroidie, pince de masse cuivre et manomètre détendeur.',
        categoryId: 'cat-atelier', price: 785000, condition: 'Neuf', stock: 9,
        keywords: ['poste', 'souder', 'mig', 'tig', 'soudure', 'atelier', '315a', 'chariot'],
        media: [
          { id: 'm6', url: '/src/assets/images/product_welding_station_1795288076488.jpg', type: 'image', order: 0, alt: 'Poste à souder MIG/TIG industriel sur chariot acier' },
        ],
        variants: [
          { id: 'var-mig-250', label: 'Version 250A Monophasé', priceOverride: null, stock: 6 },
          { id: 'var-mig-315', label: 'Version 315A Triphasé', priceOverride: 940000, stock: 3 },
        ],
        deliveryFee: 15000, deliveryDelay: '24 à 48h',
      },
      {
        id: 'prod-rotavator-charrue', vendorId: 'user-vendor-dakar', shopId: 'shop-agriforce',
        title: 'Fraise Rotative & Charrue à Disques Portée 3 Points',
        description: 'Outillage agricole attelage 3 points catégorie II : fraise rotative lourde largeur 2,10 m avec cardan à sécurité et herse à disques crénelés haute résistance pour préparation des sols.',
        categoryId: 'cat-hydraulique', price: 1650000, condition: 'Neuf', stock: 7,
        keywords: ['fraise', 'rotavator', 'charrue', 'disques', 'agricole', 'tracteur', 'labour'],
        media: [
          { id: 'm7', url: '/src/assets/images/product_rotary_tiller_1795288075866.jpg', type: 'image', order: 0, alt: 'Fraise rotative et herse à disques agricole rouge et acier' },
        ],
        variants: [
          { id: 'var-rot-180', label: 'Largeur 1,80 m (Tracteur 60-90 CV)', priceOverride: null, stock: 4 },
          { id: 'var-rot-210', label: 'Largeur 2,10 m (Tracteur 90-130 CV)', priceOverride: 1950000, stock: 3 },
        ],
        deliveryFee: 25000, deliveryDelay: '48 à 72h',
      },
      {
        id: 'prod-compresseur-200l', vendorId: 'user-vendor-kora', shopId: 'shop-forge-ivoire',
        title: 'Compresseur d’Air Atelier Bicylindre 200 Litres — 10 Bar',
        description: 'Compresseur à piston fonte bicylindre en V entraînement par courroie, cuve acier épais 200 L sur roues industrielles freinées, double manomètre et moteur 5,5 CV.',
        categoryId: 'cat-atelier', price: 540000, condition: 'Reconditionné', stock: 8,
        keywords: ['compresseur', 'air', '200l', 'atelier', 'bicylindre', 'maintenance', 'pneumatique'],
        media: [
          { id: 'm8', url: '/src/assets/images/product_air_compressor_1795288075812.jpg', type: 'image', order: 0, alt: 'Compresseur industriel bicylindre 200 litres en acier gris' },
        ],
        variants: [],
        deliveryFee: 15000, deliveryDelay: '24 à 48h',
      },
    ];

    for (const p of productsSeed) {
      await db.prepare(`
        INSERT INTO products (
          id, vendor_id, shop_id, title, description, category_id, price, condition, status,
          stock, keywords_json, media_json, video_url, variants_json, delivery_fee, delivery_zones_json,
          delivery_delay, payment_methods_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'publie', ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        p.id, p.vendorId, p.shopId, p.title, p.description, p.categoryId, p.price, p.condition, p.stock,
        JSON.stringify(p.keywords), JSON.stringify(p.media), JSON.stringify(p.variants),
        p.deliveryFee, zonesDefault, p.deliveryDelay,
        JSON.stringify(['jumia_card', 'mobile_money_orange', 'mobile_money_mtn', 'mobile_money_wave', 'jumia_wallet']),
        now, now
      );
    }

    // Historical delivered orders + verified review (social proof)
    await db.prepare(`
      INSERT INTO orders (id, order_number, buyer_name, buyer_email, buyer_phone, shipping_address, delivery_zone, subtotal, delivery_total, total_amount, payment_method, payment_status, payment_mode, deposit_percent, paid_amount, balance_due, has_custom_offer, tracking_token_version, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid', 'full', 100, ?, 0, 0, 1, NULL, ?)
    `).run('ord-seed-1', 'CMD-2026-1001', 'Sébastien Kouadio', 's.kouadio@entreprise-btp.ci', '+225 01 23 45 67 89', 'Zone Industrielle de Yopougon, Lot 42, Abidjan', 'abidjan', 6850000, 30000, 6880000, 'mobile_money_orange', 6880000, now);

    await db.prepare(`
      INSERT INTO order_items (id, order_id, product_id, vendor_id, product_title, variant_label, quantity, unit_price, delivery_fee, carrier, tracking_number, item_status)
      VALUES (?, ?, ?, ?, ?, ?, 1, 6850000, 30000, 'SIMCOVA Logistique Lourde', 'SMV-889412', 'livree')
    `).run('oi-seed-1', 'ord-seed-1', 'prod-groupe-50kva', 'user-admin-1', 'Groupe Électrogène Diesel Insonorisé 50 kVA Triphasé', 'Modèle 50 kVA (40 kW)');

    await db.prepare(`
      INSERT INTO orders (id, order_number, buyer_name, buyer_email, buyer_phone, shipping_address, delivery_zone, subtotal, delivery_total, total_amount, payment_method, payment_status, payment_mode, deposit_percent, paid_amount, balance_due, has_custom_offer, tracking_token_version, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid', 'full', 100, ?, 0, 0, 1, NULL, ?)
    `).run('ord-seed-2', 'CMD-2026-1002', 'Coopérative Sénégalaise Niayes', 'achats@coop-niayes.sn', '+221 77 550 11 22', 'Route des Niayes, Km 18, Dakar', 'regional', 1650000, 25000, 1675000, 'jumia_card', 1675000, new Date(Date.now() - 86400000 * 12).toISOString());

    await db.prepare(`
      INSERT INTO order_items (id, order_id, product_id, vendor_id, product_title, variant_label, quantity, unit_price, delivery_fee, carrier, tracking_number, item_status)
      VALUES (?, ?, ?, ?, ?, ?, 1, 1650000, 25000, 'Sahel Fret', 'SF-44109', 'livree')
    `).run('oi-seed-2', 'ord-seed-2', 'prod-rotavator-charrue', 'user-vendor-dakar', 'Fraise Rotative & Charrue à Disques Portée 3 Points', 'Largeur 1,80 m (Tracteur 60-90 CV)');

    await db.prepare(`
      INSERT INTO orders (id, order_number, buyer_name, buyer_email, buyer_phone, shipping_address, delivery_zone, subtotal, delivery_total, total_amount, payment_method, payment_status, payment_mode, deposit_percent, paid_amount, balance_due, has_custom_offer, tracking_token_version, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid', 'full', 100, ?, 0, 0, 1, NULL, ?)
    `).run('ord-seed-3', 'CMD-2026-1003', 'Agro-Industrie Yamoussoukro', 'direction@agro-yakro.ci', '+225 07 89 45 12', 'Boulevard Houphouët-Boigny, Yamoussoukro', 'national', 18500000, 45000, 18545000, 'bank_transfer', 18545000, new Date(Date.now() - 86400000 * 18).toISOString());

    await db.prepare(`
      INSERT INTO order_items (id, order_id, product_id, vendor_id, product_title, variant_label, quantity, unit_price, delivery_fee, carrier, tracking_number, item_status)
      VALUES (?, ?, ?, ?, ?, ?, 1, 18500000, 45000, 'Porte-Char AgriForce', 'AF-90211', 'livree')
    `).run('oi-seed-3', 'ord-seed-3', 'prod-tracteur-120cv', 'user-vendor-dakar', 'Tracteur Agricole 4x4 120 CV Cabine Climatisée', 'Version Standard 120 CV');

    const seedEvents = [
      ['ev-1', 'creee', 'Commande enregistrée sans compte acheteur.', 'Système', -172800000],
      ['ev-2', 'payee', 'Paiement confirmé via Jumia Africa (Orange Money).', 'Jumia Africa Webhook', -172500000],
      ['ev-3', 'en_preparation', 'Machine testée sur banc de charge par SIMCOVA Matériel Pro.', 'Direction SIMCOVA', -120000000],
      ['ev-4', 'expediee', 'Chargement sur camion plateau SIMCOVA Logistique (Suivi SMV-889412).', 'Direction SIMCOVA', -86400000],
      ['ev-5', 'livraison_commencee', 'Convoi en approche de la Zone Industrielle de Yopougon.', 'SIMCOVA Logistique Lourde', -21600000],
      ['ev-6', 'livree', 'Équipement livré et réceptionné sur site.', 'SIMCOVA Logistique Lourde', -3600000],
    ] as const;

    for (const [id, st, note, actor, offset] of seedEvents) {
      await db.prepare('INSERT INTO order_events (id, order_id, status, note, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        id, 'ord-seed-1', st, note, actor, new Date(Date.now() + offset).toISOString()
      );
    }

    await db.prepare(`
      INSERT INTO payments (id, order_id, provider, provider_ref, method, amount, status, webhook_events_json, created_at, updated_at)
      VALUES (?, ?, 'jumia_africa', ?, 'mobile_money_orange', 6880000, 'paid', ?, ?, ?)
    `).run('pay-seed-1', 'ord-seed-1', 'JAF-SEED-1001', JSON.stringify([{ event: 'payment.succeeded', timestamp: now, amount: 6880000 }]), now, now);

    await db.prepare(`
      INSERT INTO reviews (id, product_id, order_id, buyer_name, rating, comment, vendor_reply, vendor_replied_at, report_count, moderation_status, created_at)
      VALUES (?, ?, ?, ?, 5, ?, ?, ?, 0, 'visible', ?)
    `).run(
      'rev-seed-1', 'prod-groupe-50kva', 'ord-seed-1', 'Sébastien K.',
      'Groupe électrogène très silencieux sur chantier, tableau ATS opérationnel dès la mise en route. Livré à Yopougon avec procès-verbal de test.',
      'Merci Sébastien pour votre retour. Notre atelier reste disponible pour votre suivi d’entretien périodique.',
      now, now
    );
  }

  // 6. SIMCOVA_DEMO_MODE: ready-to-present vendor account
  if (isDemoMode) {
    const demoVendorExists = await db.prepare('SELECT id FROM users WHERE email = ?').get('vendeur@simcova.africa');
    if (!demoVendorExists) {
      await db.prepare(`
        INSERT INTO users (id, email, full_name, password_hash, role, email_verified, status, badges_json, custom_fields_json, created_at)
        VALUES (?, ?, ?, ?, 'vendor', 1, 'certifie', ?, ?, ?)
      `).run(
        'user-vendor-demo', 'vendeur@simcova.africa', 'Yao Koffi — Concession Démo', hashPassword('VendeurDemo2026!'),
        JSON.stringify(['Vendeur certifié', 'Concessionnaire Agréé']),
        JSON.stringify({ city: 'Abidjan', phone: '+225 07 88 99 00 00' }),
        now
      );

      await db.prepare(`
        INSERT INTO shops (id, vendor_id, slug, name, description, contact_email, contact_phone, city, default_delivery_fee, default_delivery_delay, bank_name, bank_account_holder, bank_iban, bank_bic, bank_instructions, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'shop-demo', 'user-vendor-demo', 'concession-demo-simcova', 'Concession Démo SIMCOVA',
        'Compte vendeur de démonstration certifié : tracteurs, groupes électrogènes et matériel d’atelier prêts à présenter.',
        'vendeur@simcova.africa', '+225 07 88 99 00 00', 'Abidjan', 20000, '24 à 72h',
        'NSIA Banque CI', 'CONCESSION DEMO SARL', 'CI93CI0080111200DEMO0099', 'NSIACIAB',
        'Mentionnez le numéro CMD SIMCOVA en libellé de virement.', now
      );

      const demoZones = JSON.stringify([
        { zoneId: 'abidjan', zoneName: 'Abidjan / Capitale', fee: 20000 },
        { zoneId: 'national', zoneName: 'Intérieur du pays', fee: 45000 },
        { zoneId: 'regional', zoneName: 'Afrique de l’Ouest (CÉDÉAO)', fee: 95000 },
      ]);

      const demoProducts = [
        {
          id: 'prod-demo-tracteur-90',
          title: 'Tracteur Agricole 90 CV Transmission Powershift',
          description: 'Tracteur polyvalent 90 chevaux, transmission powershift 24 rapports, relevage arrière 3 800 kg et prise de force réversible. Idéal exploitations et travaux vitaflor.',
          categoryId: 'cat-tracteurs', price: 12500000, stock: 3,
          keywords: ['tracteur', '90cv', 'powershift', 'agricole', 'relevage'],
          media: [
            { id: 'md1', url: '/src/assets/images/product_tractor_4wd_1795288076896.jpg', type: 'image', order: 0, alt: 'Tracteur agricole rouge 90 CV avec cabine' },
            { id: 'md2', url: '/src/assets/images/hero_heavy_machinery_1795288076600.jpg', type: 'image', order: 1, alt: 'Parc matériel lourd concession démo' },
          ],
          variants: [
            { id: 'var-demo-90', label: 'Version Cabine Confort', priceOverride: null, stock: 2 },
            { id: 'var-demo-90g', label: 'Version 90 CV + Chargeur', priceOverride: 14200000, stock: 1 },
          ],
        },
        {
          id: 'prod-demo-groupe-30',
          title: 'Groupe Électrogène Insonorisé 30 kVA Démarrage Auto',
          description: 'Groupe électrogène capoté 30 kVA, moteur diesel water-cooling, coffret ATS démarrage automatique sur coupure secteur, réservoir 110 L.',
          categoryId: 'cat-energie', price: 4350000, stock: 5,
          keywords: ['groupe', 'electrogene', '30kva', 'diesel', 'ats', 'insonorise'],
          media: [
            { id: 'md3', url: '/src/assets/images/product_diesel_generator_1795288076702.jpg', type: 'image', order: 0, alt: 'Groupe électrogène diesel insonorisé 30 kVA' },
          ],
          variants: [],
        },
      ];

      for (const p of demoProducts) {
        await db.prepare(`
          INSERT INTO products (
            id, vendor_id, shop_id, title, description, category_id, price, condition, status,
            stock, keywords_json, media_json, video_url, variants_json, delivery_fee, delivery_zones_json,
            delivery_delay, payment_methods_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Neuf', 'publie', ?, ?, ?, NULL, ?, 20000, ?, '48 à 96h (porte-char)', ?, ?, ?)
        `).run(
          p.id, 'user-vendor-demo', 'shop-demo', p.title, p.description, p.categoryId, p.price, p.stock,
          JSON.stringify(p.keywords), JSON.stringify(p.media), JSON.stringify(p.variants), demoZones,
          JSON.stringify(['jumia_card', 'mobile_money_orange', 'mobile_money_mtn', 'mobile_money_wave']),
          now, now
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Shared helpers (async)
// ---------------------------------------------------------------------------
export async function writeAuditLog(params: {
  actorId: string;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId: string;
  details: string;
}): Promise<void> {
  await db.prepare(`
    INSERT INTO audit_logs (id, actor_id, actor_email, action, target_type, target_id, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `aud-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    params.actorId,
    params.actorEmail,
    params.action,
    params.targetType,
    params.targetId,
    params.details,
    new Date().toISOString()
  );
}

export async function queueTransactionalEmail(params: {
  toEmail: string;
  subject: string;
  bodyText: string;
  actionUrl?: string | null;
  actionLabel?: string | null;
}): Promise<void> {
  await db.prepare(`
    INSERT INTO outbox_emails (id, to_email, subject, body_text, action_url, action_label, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    `mail-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    params.toEmail,
    params.subject,
    params.bodyText,
    params.actionUrl ?? null,
    params.actionLabel ?? null,
    new Date().toISOString()
  );
}

export async function getRulesMap(): Promise<Record<RuleId, PlatformRule>> {
  const rows = (await db.prepare('SELECT * FROM platform_rules').all()) as Array<{
    rule_id: RuleId;
    title: string;
    help_text: string;
    enabled: number;
    value_json: string;
    updated_by: string;
    updated_at: string;
  }>;
  const map = {} as Record<RuleId, PlatformRule>;
  for (const r of rows) {
    map[r.rule_id] = {
      ruleId: r.rule_id,
      title: r.title,
      helpText: r.help_text,
      enabled: Boolean(r.enabled),
      valueJson: JSON.parse(String(r.value_json || '{}')),
      updatedBy: r.updated_by,
      updatedAt: r.updated_at,
    };
  }
  return map;
}

export async function getPlatformSettings(): Promise<PlatformSettings> {
  const row = (await db.prepare('SELECT * FROM platform_settings WHERE id = 1').get()) as {
    currency: string;
    default_delivery_policy: string;
    legal_mentions: string;
    cgv_text: string;
    support_email: string;
    support_phone: string;
    kyc_retention_days: number;
    review_processing_delay_label: string;
    default_deposit_percent?: number;
    bank_transfer_threshold?: number;
    commission_rate_percent?: number;
    vat_rate_percent?: number;
    maintenance_mode?: number;
  };
  return {
    currency: row.currency,
    defaultDeliveryPolicy: row.default_delivery_policy,
    legalMentions: row.legal_mentions,
    cgvText: row.cgv_text,
    supportEmail: row.support_email,
    supportPhone: row.support_phone,
    kycRetentionDays: row.kyc_retention_days,
    reviewProcessingDelayLabel: row.review_processing_delay_label,
    defaultDepositPercent: Number(row.default_deposit_percent ?? 30),
    bankTransferThreshold: Number(row.bank_transfer_threshold ?? 5000000),
    commissionRatePercent: Number(row.commission_rate_percent ?? 0),
    vatRatePercent: Number(row.vat_rate_percent ?? 0),
    maintenanceMode: Boolean(row.maintenance_mode ?? 0),
  };
}

/** Closes the active connection(s) — used by tests. */
export async function closeDatabase(): Promise<void> {
  if (globalThis.__simcovaPgPool) {
    await globalThis.__simcovaPgPool.end();
    globalThis.__simcovaPgPool = undefined;
  }
  if (sqliteDb) {
    sqliteDb.close();
    sqliteDb = null;
  }
}

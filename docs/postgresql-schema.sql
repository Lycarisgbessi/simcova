-- SIMCOVA Marketplace — Schéma relationnel PostgreSQL de référence (Tableau 13 du Cahier des Charges)
-- Miroir exact des 18 tables SQLite de server/db.ts (dev) : prêt pour la migration production.
-- Montants en INTEGER (FCFA sans centimes).

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============ Comptes & Boutiques ============

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'vendor')),
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  verification_token TEXT,
  verification_expires_at TIMESTAMPTZ,
  reset_token TEXT,
  reset_expires_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'en_attente' CHECK (status IN ('en_attente', 'valide', 'rejete', 'certifie', 'suspendu')),
  rejection_reason TEXT,
  badges_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  custom_fields_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE shops (
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE kyc_documents (
  id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  encrypted_payload TEXT NOT NULL,   -- AES-256-GCM (voir server/crypto.ts)
  iv_hex TEXT NOT NULL,
  auth_tag_hex TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'en_attente' CHECK (review_status IN ('en_attente', 'approuve', 'rejete')),
  rejection_reason TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  purge_scheduled_at TIMESTAMPTZ     -- purgé par le job de maintenance (EXNF-05)
);

-- ============ Catalogue ============

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  forbidden BOOLEAN NOT NULL DEFAULT FALSE,
  required_badge TEXT
);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES categories(id),
  price INTEGER NOT NULL CHECK (price >= 0),
  condition TEXT NOT NULL CHECK (condition IN ('Neuf', 'Reconditionné', 'Artisanal')),
  status TEXT NOT NULL CHECK (status IN ('brouillon', 'publie', 'archive')),
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  keywords_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  media_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  video_url TEXT,
  variants_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  delivery_fee INTEGER NOT NULL DEFAULT 0,
  delivery_zones_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  delivery_delay TEXT NOT NULL DEFAULT '24 à 48h',
  payment_methods_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  view_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============ Commandes invités & Paiement Jumia Africa ============

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  buyer_name TEXT NOT NULL,
  buyer_email TEXT NOT NULL,
  buyer_phone TEXT,
  shipping_address TEXT NOT NULL,
  delivery_zone TEXT NOT NULL DEFAULT 'abidjan',
  subtotal INTEGER NOT NULL,                -- HT produits
  delivery_total INTEGER NOT NULL,
  total_amount INTEGER NOT NULL,            -- HT produits + livraison
  vat_amount INTEGER NOT NULL DEFAULT 0,    -- TVA (0 = prix TTC par défaut)
  commission_amount INTEGER NOT NULL DEFAULT 0, -- Commission marketplace sur sous-total
  payment_method TEXT NOT NULL,
  payment_status TEXT NOT NULL CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded', 'expired')),
  payment_mode TEXT NOT NULL DEFAULT 'full' CHECK (payment_mode IN ('full', 'deposit', 'quote', 'bank_transfer')),
  deposit_percent INTEGER NOT NULL DEFAULT 100,
  paid_amount INTEGER NOT NULL DEFAULT 0,
  balance_due INTEGER NOT NULL DEFAULT 0,
  has_custom_offer BOOLEAN NOT NULL DEFAULT FALSE,
  bank_transfer_ref TEXT,
  quote_thread_id TEXT,
  promo_code TEXT,
  discount_amount INTEGER NOT NULL DEFAULT 0,
  tracking_token_version INTEGER NOT NULL DEFAULT 1,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  variant_id TEXT,
  vendor_id TEXT NOT NULL REFERENCES users(id),
  product_title TEXT NOT NULL,
  variant_label TEXT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price INTEGER NOT NULL,
  delivery_fee INTEGER NOT NULL,
  carrier TEXT,
  tracking_number TEXT,
  item_status TEXT NOT NULL,
  custom_specs_json JSONB
);

CREATE TABLE order_events (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  note TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'jumia_africa',
  provider_ref TEXT NOT NULL UNIQUE,
  method TEXT NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL,
  webhook_events_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============ Messagerie & Avis ============

CREATE TABLE messages (
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
  read_by_vendor BOOLEAN NOT NULL DEFAULT FALSE,
  reported BOOLEAN NOT NULL DEFAULT FALSE,
  report_count INTEGER NOT NULL DEFAULT 0,
  hidden_by_moderation BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE blocked_threads (
  thread_id TEXT PRIMARY KEY,
  blocked_by TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE reviews (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  buyer_name TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL,
  vendor_reply TEXT,
  vendor_replied_at TIMESTAMPTZ,
  report_count INTEGER NOT NULL DEFAULT 0,
  moderation_status TEXT NOT NULL DEFAULT 'visible' CHECK (moderation_status IN ('visible', 'signale', 'retire')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(order_id, product_id)
);

-- ============ Gouvernance & Exploitation ============

CREATE TABLE platform_rules (
  rule_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  help_text TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  value_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE platform_settings (
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
  vat_rate_percent INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL UNIQUE,
  subscription_json JSONB NOT NULL,
  preferences_json JSONB NOT NULL DEFAULT '{"nouveautes":true,"promotions":true,"annonces":true}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE push_alerts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  deep_link TEXT NOT NULL DEFAULT '/',
  alert_type TEXT NOT NULL,
  sent_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  details TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE outbox_emails (
  id TEXT PRIMARY KEY,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  action_url TEXT,
  action_label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Reversements vendeurs (net = ventes - commission marketplace)
CREATE TABLE vendor_payouts (
  id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  method TEXT NOT NULL DEFAULT 'bank_transfer',
  reference TEXT,
  note TEXT,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Codes promotionnels (remise plafonnée au TTC, commission inchangée)
CREATE TABLE promo_codes (
  code TEXT PRIMARY KEY,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
  discount_value INTEGER NOT NULL CHECK (discount_value > 0),
  min_order_amount INTEGER NOT NULL DEFAULT 0,
  max_uses INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============ Index de recherche & performance ============

CREATE INDEX idx_products_status_stock ON products(status, stock);
CREATE INDEX idx_products_shop ON products(shop_id);
CREATE INDEX idx_products_vendor ON products(vendor_id);
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_orders_buyer_email ON orders(LOWER(buyer_email));
CREATE INDEX idx_orders_payment_status ON orders(payment_status);
CREATE INDEX idx_orders_expires ON orders(expires_at) WHERE payment_status = 'pending';
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_vendor ON order_items(vendor_id);
CREATE INDEX idx_order_events_order ON order_events(order_id, created_at);
CREATE INDEX idx_payments_order ON payments(order_id);
CREATE INDEX idx_messages_thread ON messages(thread_id, created_at);
CREATE INDEX idx_messages_vendor ON messages(vendor_id);
CREATE INDEX idx_reviews_product ON reviews(product_id);
CREATE INDEX idx_kyc_vendor ON kyc_documents(vendor_id);
CREATE INDEX idx_kyc_purge ON kyc_documents(purge_scheduled_at) WHERE purge_scheduled_at IS NOT NULL;
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at DESC);
CREATE INDEX idx_outbox_created ON outbox_emails(created_at DESC);
CREATE INDEX idx_outbox_unsent ON outbox_emails(created_at ASC) WHERE sent_at IS NULL;
CREATE INDEX idx_promo_active ON promo_codes(active) WHERE active;
CREATE INDEX idx_payouts_vendor ON vendor_payouts(vendor_id);

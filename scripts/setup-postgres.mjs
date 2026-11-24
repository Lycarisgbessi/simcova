// SIMCOVA — Mise en place PostgreSQL (Neon) : schéma de référence + données initiales.
// Usage : DATABASE_URL="postgresql://…" node scripts/setup-postgres.mjs [--demo]
// --demo ajoute les comptes de présentation (admin/vendeur démo).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Client } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('[ERREUR] DATABASE_URL manquante.');
  process.exit(1);
}
const withDemo = process.argv.includes('--demo');

// scrypt hash compatible avec server/crypto.ts (salt:derived hex)
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

const client = new Client({ connectionString: DATABASE_URL });
await client.connect();
console.log('Connecté à PostgreSQL.');

// ---------- 1. Schéma de référence (idempotent) ----------
const schemaSql = fs.readFileSync(path.resolve('docs/postgresql-schema.sql'), 'utf8');
// retire les commentaires, rend les CREATE idempotents, puis découpe par ';'
const statements = schemaSql
  .replace(/--[^\n]*/g, '')
  .replaceAll('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS ')
  .replaceAll('CREATE TABLE IF NOT EXISTS IF NOT EXISTS ', 'CREATE TABLE IF NOT EXISTS ')
  .replaceAll('CREATE INDEX ', 'CREATE INDEX IF NOT EXISTS ')
  .replaceAll('CREATE INDEX IF NOT EXISTS IF NOT EXISTS ', 'CREATE INDEX IF NOT EXISTS ')
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean);
// Réparation des bases créées avant l'ajout de colonnes récentes
const repairs = [
  'ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS maintenance_mode BOOLEAN NOT NULL DEFAULT FALSE',
  'ALTER TABLE orders ADD COLUMN IF NOT EXISTS promo_code TEXT',
  'ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE products ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE outbox_emails ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ',
  'ALTER TABLE outbox_emails ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE outbox_emails ADD COLUMN IF NOT EXISTS last_error TEXT',
];
// Ordre garanti : tables -> réparations -> index (les index partiels dépendent des colonnes réparées)
const createTables = statements.filter((s) => s.startsWith('CREATE TABLE'));
const createIndexes = statements.filter((s) => s.startsWith('CREATE INDEX'));
const ordered = [...createTables, ...repairs, ...createIndexes];
for (const stmt of ordered) {
  await client.query(stmt);
}
console.log(`Schéma appliqué : ${ordered.length} instructions (${createTables.length} tables, ${createIndexes.length} index, ${repairs.length} réparations).`);

// ---------- 2. Données initiales (idempotent : ON CONFLICT DO NOTHING) ----------
const now = new Date().toISOString();
const adminPass = process.env.SIMCOVA_ADMIN_PASSCODE?.trim() || '';

await client.query(
  `INSERT INTO platform_settings (id, currency, default_delivery_policy, legal_mentions, cgv_text, support_email, support_phone, kyc_retention_days, review_processing_delay_label, default_deposit_percent, bank_transfer_threshold, commission_rate_percent, vat_rate_percent, maintenance_mode)
   VALUES (1, 'FCFA', $1, $2, $3, 'support@simcova.africa', '+225 07 00 00 00 00', 30, 'Sous 24 à 48h ouvrées', 30, 5000000, 0, 0, false)
   ON CONFLICT (id) DO NOTHING`,
  [
    'Expédition nationale sous 24 à 72h ouvrées. Forfait standard 2 000 FCFA sauf mention spécifique du vendeur.',
    'SIMCOVA Marketplace SAS — Plateforme de commerce en ligne multi-vendeurs. Hébergement sécurisé avec chiffrement HTTPS et protection des pièces justificatives.',
    'Conditions Générales de Vente SIMCOVA : Les achats sont effectués sans création de compte acheteur. Chaque commande génère un lien de suivi personnel sécurisé. Les paiements sont traités via l’API Jumia Africa ou par virement bancaire contrôlé pour les commandes d’équipements lourds. Les échanges acheteur-vendeur s’effectuent obligatoirement sur la messagerie SIMCOVA.',
  ]
);

const rules = [
  ['RG-01', 'Certification exigée pour publier', 'Lorsque cette règle est active, seuls les comptes disposant du badge « Vendeur certifié » peuvent publier des produits ; les autres peuvent préparer des brouillons.', false, '{}'],
  ['RG-02', 'Badges requis par type de catalogue', 'Exige un badge spécifique défini sur certaines catégories (ex. électronique ou cosmétique) avant toute publication.', false, '{}'],
  ['RG-03', 'Pièces justificatives requises', 'Définit la liste des justificatifs exigés à la soumission et pour obtenir la certification vendeur.', true, JSON.stringify({ requiredDocs: ['Pièce d’identité officielle'], availableDocs: ['Pièce d’identité officielle', 'Registre du commerce (RCCM)', 'Justificatif de domicile'] })],
  ['RG-04', 'Champs obligatoires d’inscription vendeur', 'Configure les champs obligatoires et facultatifs du formulaire public de création de compte vendeur, avec effet immédiat.', true, JSON.stringify({ requiredFields: ['fullName', 'email', 'password', 'shopName'], optionalFields: ['phone', 'city', 'shopDescription'] })],
  ['RG-05', 'Plafond sans certification', 'Limite le nombre maximal de produits publiés simultanément par un vendeur non encore certifié.', true, JSON.stringify({ maxProducts: 10 })],
  ['RG-06', 'Catégories autorisées et interdites', 'Contrôle en temps réel les catégories ouvertes à la publication sur SIMCOVA.', true, '{}'],
  ['RG-07', 'Politique de modération automatique', 'Nombre de signalements confirmés entraînant le masquage automatique d’un avis ou d’un message pour revue administrateur.', true, JSON.stringify({ threshold: 3 })],
  ['RG-08', 'Modes de paiement autorisés (Jumia Africa)', 'Sélectionne les moyens de paiement proposés aux acheteurs au passage en caisse.', true, JSON.stringify({ methods: ['jumia_card', 'mobile_money_orange', 'mobile_money_mtn', 'mobile_money_wave', 'jumia_wallet'] })],
  ['RG-09', 'Livraison par défaut', 'Zones de livraison proposées sur la plateforme et forfait national appliqué si un vendeur n’a pas défini de tarif spécifique.', true, JSON.stringify({ defaultFlatFee: 2000, zones: [
    { zoneId: 'abidjan', zoneName: 'Abidjan / Capitale', fee: 1500 },
    { zoneId: 'national', zoneName: 'Intérieur du pays', fee: 3000 },
    { zoneId: 'regional', zoneName: 'Afrique de l’Ouest (CÉDÉAO)', fee: 6500 },
  ] })],
  ['RG-10', 'Expiration des commandes impayées', 'Délai avant annulation automatique d’une commande restée en attente de paiement, avec lien de relance.', true, JSON.stringify({ expirationHours: 48 })],
];
for (const [id, title, help, enabled, value] of rules) {
  await client.query(
    `INSERT INTO platform_rules (rule_id, title, help_text, enabled, value_json, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,$5::jsonb,'Système (défaut)',$6) ON CONFLICT (rule_id) DO NOTHING`,
    [id, title, help, enabled, value, now]
  );
}

const categories = [
  ['cat-tracteurs', 'Tracteurs & Engins Agricoles', 'tracteurs-agricoles', 'Vendeur certifié'],
  ['cat-chantier', 'BTP & Terrassement', 'btp-terrassement', 'Vendeur certifié'],
  ['cat-energie', 'Groupes Électrogènes', 'groupes-electrogenes', null],
  ['cat-atelier', 'Soudure & Atelier Pro', 'soudure-atelier', null],
  ['cat-hydraulique', 'Outils & Accessoires Agricoles', 'outils-agricoles', null],
];
for (const [id, name, slug, badge] of categories) {
  await client.query(
    `INSERT INTO categories (id, name, slug, active, forbidden, required_badge)
     VALUES ($1,$2,$3,true,false,$4) ON CONFLICT (id) DO NOTHING`,
    [id, name, slug, badge]
  );
}

// Admin (mot de passe initialisé via claim au premier démarrage, ou passcode env)
await client.query(
  `INSERT INTO users (id, email, password_hash, full_name, role, email_verified, status, badges_json, custom_fields_json, created_at)
   VALUES ('user-admin-1','admin@simcova.africa',$1,'Direction SIMCOVA','admin',true,'certifie',$2::jsonb,$3::jsonb,$4)
   ON CONFLICT (id) DO NOTHING`,
  [adminPass ? hashPassword(adminPass) : '', JSON.stringify(['Boutique Officielle', 'Vendeur certifié']), JSON.stringify({ city: 'Abidjan', phone: '+225 07 00 00 00 00' }), now]
);
await client.query(
  `INSERT INTO shops (id, vendor_id, slug, name, description, contact_email, contact_phone, city, default_delivery_fee, default_delivery_delay, bank_name, bank_account_holder, bank_iban, bank_bic, bank_instructions, created_at)
   VALUES ('shop-admin-1','user-admin-1','simcova-materiel-pro','SIMCOVA Matériel Pro','Parc officiel SIMCOVA : tracteurs 4x4, groupes électrogènes haute capacité et équipements industriels contrôlés en atelier.','parc@simcova.africa','+225 07 00 00 00 00','Abidjan',25000,'24 à 72h','SGBCI — Société Générale Côte d’Ivoire','SIMCOVA MATÉRIEL PRO SAS','CI008 01112 000458912345 77','SGCICIAB','Indiquez impérativement le numéro de commande SIMCOVA en libellé de virement puis transmettez le bordereau sur la messagerie sécurisée.',$1)
   ON CONFLICT (id) DO NOTHING`,
  [now]
);

// Deux concessionnaires tiers
await client.query(
  `INSERT INTO users (id, email, password_hash, full_name, role, email_verified, status, badges_json, custom_fields_json, created_at)
   VALUES ('user-vendor-dakar','contact@agriforce-sahel.sn','','Ibrahima Ndiaye','vendor',true,'certifie',$1::jsonb,$2::jsonb,$3)
   ON CONFLICT (id) DO NOTHING`,
  [JSON.stringify(['Vendeur certifié', 'Concessionnaire Agréé']), JSON.stringify({ city: 'Dakar', phone: '+221 77 123 45 67' }), now]
);
await client.query(
  `INSERT INTO shops (id, vendor_id, slug, name, description, contact_email, contact_phone, city, default_delivery_fee, default_delivery_delay, bank_name, bank_account_holder, bank_iban, bank_bic, bank_instructions, created_at)
   VALUES ('shop-agriforce','user-vendor-dakar','agriforce-tracteurs-sahel','AgriForce Tracteurs & BTP','Concessionnaire spécialisé en tracteurs agricoles 4RM, mini-pelles hydrauliques et charrues portées pour exploitations et chantiers.','contact@agriforce-sahel.sn','+221 77 123 45 67','Dakar',35000,'48 à 96h','CBAO Attijariwafa Bank Sénégal','AGRIFORCE TRACTEURS & BTP SARL','SN012 01201 036148892014 42','CBAOSNDA','Virement SWIFT/UEMOA avec mention du numéro CMD SIMCOVA. Confirmation atelier sous 4h après réception.',$1)
   ON CONFLICT (id) DO NOTHING`,
  [now]
);
await client.query(
  `INSERT INTO users (id, email, password_hash, full_name, role, email_verified, status, badges_json, custom_fields_json, created_at)
   VALUES ('user-vendor-kora','ventes@forge-ivoire.ci','','Kouamé Konan','vendor',true,'valide','[]'::jsonb,$1::jsonb,$2)
   ON CONFLICT (id) DO NOTHING`,
  [JSON.stringify({ city: 'Abidjan', phone: '+225 05 88 99 00 11' }), now]
);
await client.query(
  `INSERT INTO shops (id, vendor_id, slug, name, description, contact_email, contact_phone, city, default_delivery_fee, default_delivery_delay, created_at)
   VALUES ('shop-forge-ivoire','user-vendor-kora','forge-ivoire-equipements','Forge Ivoire Équipements','Distribution de postes à souder industriels MIG/TIG, compresseurs 200L et outillage de maintenance mécanique.','ventes@forge-ivoire.ci','+225 05 88 99 00 11','Abidjan',15000,'24 à 48h',$1)
   ON CONFLICT (id) DO NOTHING`,
  [now]
);

// Catalogue initial
const zonesDefault = JSON.stringify([
  { zoneId: 'abidjan', zoneName: 'Abidjan / Capitale', fee: 25000 },
  { zoneId: 'national', zoneName: 'Intérieur du pays', fee: 55000 },
  { zoneId: 'regional', zoneName: 'Afrique de l’Ouest (CÉDÉAO)', fee: 120000 },
]);
const products = [
  ['prod-tracteur-120cv', 'user-vendor-dakar', 'shop-agriforce', 'Tracteur Agricole 4x4 120 CV Cabine Climatisée', 'Tracteur utilitaire 4 roues motrices équipé d’un moteur diesel 4 cylindres turbo 120 CV, prise de force 540/1000 tr/min, relevage hydraulique arrière 4 200 kg et cabine ROPS climatisée.', 'cat-tracteurs', 18500000, 'Neuf', 4, ['tracteur', '4x4', '120cv', 'agricole', 'diesel', 'cabine', 'hydraulique'], [
    { id: 'm1', url: '/src/assets/images/product_tractor_4wd_1795288076896.jpg', type: 'image', order: 0, alt: 'Tracteur agricole 4x4 rouge 120 CV en atelier béton' },
    { id: 'm2', url: '/src/assets/images/hero_heavy_machinery_1795288076600.jpg', type: 'image', order: 1, alt: 'Tracteur et mini-pelle sur parc matériel SIMCOVA' },
  ], [
    { id: 'var-tr-120', label: 'Version Standard 120 CV', priceOverride: null, stock: 3 },
    { id: 'var-tr-140', label: 'Version 140 CV + Chargeur Frontal', priceOverride: 21800000, stock: 1 },
  ], 45000, '72 à 96h (porte-char)'],
  ['prod-minipelle-35t', 'user-admin-1', 'shop-admin-1', 'Mini-Pelle Hydraulique sur Chenilles 3,5 Tonnes', 'Excavatrice compacte sur chenilles caoutchouc renforcées, moteur diesel Yanmar 25 kW, flèche déportable, godet de terrassement 50 cm et lame de remblayage frontale.', 'cat-chantier', 14200000, 'Neuf', 3, ['mini-pelle', 'excavatrice', 'chenilles', 'btp', 'terrassement', 'hydraulique', 'chantier'], [
    { id: 'm3', url: '/src/assets/images/product_mini_excavator_1795288076740.jpg', type: 'image', order: 0, alt: 'Mini-pelle hydraulique orange et acier sur chenilles' },
    { id: 'm4', url: '/src/assets/images/hero_heavy_machinery_1795288076600.jpg', type: 'image', order: 1, alt: 'Mini-pelle BTP et tracteur en parc' },
  ], [
    { id: 'var-pelle-std', label: 'Avec Godet 50 cm', priceOverride: null, stock: 2 },
    { id: 'var-pelle-brh', label: 'Pack Godet + Brise-Roche (BRH)', priceOverride: 15950000, stock: 1 },
  ], 40000, '48 à 72h'],
  ['prod-groupe-50kva', 'user-admin-1', 'shop-admin-1', 'Groupe Électrogène Diesel Insonorisé 50 kVA Triphasé', 'Groupe électrogène industriel capoté insonorisé, alternateur sans balais 400/230V, démarreur électrique automatique ATS et réservoir grande autonomie 160 L pour chantiers et unités agricoles.', 'cat-energie', 6850000, 'Neuf', 6, ['groupe', 'electrogene', '50kva', 'diesel', 'insonorise', 'triphase', 'energie'], [
    { id: 'm5', url: '/src/assets/images/product_diesel_generator_1795288076702.jpg', type: 'image', order: 0, alt: 'Groupe électrogène diesel 50 kVA gris anthracite et ambre' },
  ], [
    { id: 'var-gen-50', label: 'Modèle 50 kVA (40 kW)', priceOverride: null, stock: 4 },
    { id: 'var-gen-80', label: 'Modèle 80 kVA (64 kW)', priceOverride: 8900000, stock: 2 },
  ], 30000, '24 à 48h'],
  ['prod-poste-souder-mig', 'user-vendor-kora', 'shop-forge-ivoire', 'Poste à Souder Industriel MIG/TIG 315A sur Chariot', 'Station de soudage multiprocédés onduleur IGBT 315 Ampères avec chariot porte-bouteille acier renforcé, torche refroidie, pince de masse cuivre et manomètre détendeur.', 'cat-atelier', 785000, 'Neuf', 9, ['poste', 'souder', 'mig', 'tig', 'soudure', 'atelier', '315a', 'chariot'], [
    { id: 'm6', url: '/src/assets/images/product_welding_station_1795288076488.jpg', type: 'image', order: 0, alt: 'Poste à souder MIG/TIG industriel sur chariot acier' },
  ], [
    { id: 'var-mig-250', label: 'Version 250A Monophasé', priceOverride: null, stock: 6 },
    { id: 'var-mig-315', label: 'Version 315A Triphasé', priceOverride: 940000, stock: 3 },
  ], 15000, '24 à 48h'],
  ['prod-rotavator-charrue', 'user-vendor-dakar', 'shop-agriforce', 'Fraise Rotative & Charrue à Disques Portée 3 Points', 'Outillage agricole attelage 3 points catégorie II : fraise rotative lourde largeur 2,10 m avec cardan à sécurité et herse à disques crénelés haute résistance pour préparation des sols.', 'cat-hydraulique', 1650000, 'Neuf', 7, ['fraise', 'rotavator', 'charrue', 'disques', 'agricole', 'tracteur', 'labour'], [
    { id: 'm7', url: '/src/assets/images/product_rotary_tiller_1795288075866.jpg', type: 'image', order: 0, alt: 'Fraise rotative et herse à disques agricole rouge et acier' },
  ], [
    { id: 'var-rot-180', label: 'Largeur 1,80 m (Tracteur 60-90 CV)', priceOverride: null, stock: 4 },
    { id: 'var-rot-210', label: 'Largeur 2,10 m (Tracteur 90-130 CV)', priceOverride: 1950000, stock: 3 },
  ], 25000, '48 à 72h'],
  ['prod-compresseur-200l', 'user-vendor-kora', 'shop-forge-ivoire', 'Compresseur d’Air Atelier Bicylindre 200 Litres — 10 Bar', 'Compresseur à piston fonte bicylindre en V entraînement par courroie, cuve acier épais 200 L sur roues industrielles freinées, double manomètre et moteur 5,5 CV.', 'cat-atelier', 540000, 'Reconditionné', 8, ['compresseur', 'air', '200l', 'atelier', 'bicylindre', 'maintenance', 'pneumatique'], [
    { id: 'm8', url: '/src/assets/images/product_air_compressor_1795288075812.jpg', type: 'image', order: 0, alt: 'Compresseur industriel bicylindre 200 litres en acier gris' },
  ], [], 15000, '24 à 48h'],
];
for (const [id, vendor, shop, title, desc, cat, price, condition, stock, keywords, media, variants, fee, delay] of products) {
  await client.query(
    `INSERT INTO products (id, vendor_id, shop_id, title, description, category_id, price, condition, status, stock, keywords_json, media_json, video_url, variants_json, delivery_fee, delivery_zones_json, delivery_delay, payment_methods_json, view_count, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'publie',$9,$10::jsonb,$11::jsonb,NULL,$12::jsonb,$13,$14::jsonb,$15,$16::jsonb,0,$17,$17)
     ON CONFLICT (id) DO NOTHING`,
    [id, vendor, shop, title, desc, cat, price, condition, stock, JSON.stringify(keywords), JSON.stringify(media), JSON.stringify(variants), fee, zonesDefault, delay, JSON.stringify(['jumia_card', 'mobile_money_orange', 'mobile_money_mtn', 'mobile_money_wave', 'jumia_wallet']), now]
  );
}

// Comptes de démonstration (optionnel)
if (withDemo) {
  await client.query(
    `INSERT INTO users (id, email, password_hash, full_name, role, email_verified, status, badges_json, custom_fields_json, created_at)
     VALUES ('user-vendor-demo','vendeur@simcova.africa',$1,'Yao Koffi — Concession Démo','vendor',true,'certifie',$2::jsonb,$3::jsonb,$4)
     ON CONFLICT (id) DO NOTHING`,
    [hashPassword('VendeurDemo2026!'), JSON.stringify(['Vendeur certifié', 'Concessionnaire Agréé']), JSON.stringify({ city: 'Abidjan', phone: '+225 07 88 99 00 00' }), now]
  );
  await client.query(
    `INSERT INTO shops (id, vendor_id, slug, name, description, contact_email, contact_phone, city, default_delivery_fee, default_delivery_delay, bank_name, bank_account_holder, bank_iban, bank_bic, created_at)
     VALUES ('shop-demo','user-vendor-demo','concession-demo-simcova','Concession Démo SIMCOVA','Compte vendeur de démonstration certifié : tracteurs, groupes électrogènes et matériel d’atelier prêts à présenter.','vendeur@simcova.africa','+225 07 88 99 00 00','Abidjan',20000,'24 à 72h','NSIA Banque CI','CONCESSION DEMO SARL','CI93CI0080111200DEMO0099','NSIACIAB',$1)
     ON CONFLICT (id) DO NOTHING`,
    [now]
  );
  console.log('Comptes démo ajoutés : vendeur@simcova.africa / VendeurDemo2026!');
}

// ---------- 3. Vérification ----------
const counts = {};
for (const t of ['users', 'shops', 'categories', 'products', 'platform_rules', 'platform_settings']) {
  const r = await client.query(`SELECT COUNT(*)::int AS c FROM ${t}`);
  counts[t] = r.rows[0].c;
}
console.log('Vérification :', JSON.stringify(counts));
await client.end();
console.log('✅ Base PostgreSQL SIMCOVA prête.');

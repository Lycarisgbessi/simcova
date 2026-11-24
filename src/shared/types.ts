export type UserRole = 'admin' | 'vendor';

export type VendorStatus = 'en_attente' | 'valide' | 'rejete' | 'certifie' | 'suspendu';

export type ProductCondition = 'Neuf' | 'Reconditionné' | 'Artisanal';

export type ProductStatus = 'brouillon' | 'publie' | 'archive';

export type PaymentMode = 'full' | 'deposit' | 'quote' | 'bank_transfer';

export type OrderEventStatus =
  | 'creee'
  | 'devis_demande'
  | 'devis_propose'
  | 'en_attente_paiement'
  | 'en_attente_virement'
  | 'acompte_paye'
  | 'payee'
  | 'en_preparation'
  | 'expediee'
  | 'livraison_commencee'
  | 'livree'
  | 'annulee'
  | 'remboursee'
  | 'expiree';

export type PaymentMethodId = 'jumia_card' | 'mobile_money_orange' | 'mobile_money_mtn' | 'mobile_money_wave' | 'jumia_wallet';

export interface CustomSpecs {
  dimensions?: string;
  technicalSpecs?: string;
  notes?: string;
}

export interface BankDetails {
  bankName: string;
  accountHolder: string;
  iban: string;
  swiftBic?: string;
  instructions?: string;
}

export interface UserAccount {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  emailVerified: boolean;
  status: VendorStatus;
  rejectionReason: string | null;
  badges: string[];
  customFields: Record<string, string>;
  createdAt: string;
}

export interface Shop {
  id: string;
  vendorId: string;
  slug: string;
  name: string;
  description: string;
  logoUrl: string | null;
  contactEmail: string;
  contactPhone: string | null;
  city: string | null;
  badges: string[];
  vendorStatus: VendorStatus;
  defaultDeliveryFee: number;
  defaultDeliveryDelay: string;
  ratingAverage: number;
  reviewCount: number;
  salesCount?: number;
  publishedProductsCount?: number;
  bankDetails?: BankDetails | null;
  hasBankDetails?: boolean;
  createdAt: string;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  forbidden: boolean;
  requiredBadge: string | null;
}

export interface ProductMediaItem {
  id: string;
  url: string;
  type: 'image' | 'video';
  order: number;
  alt: string;
}

export interface ProductVariant {
  id: string;
  label: string;
  priceOverride: number | null;
  stock: number;
}

export interface DeliveryZoneFee {
  zoneId: string;
  zoneName: string;
  fee: number;
}

export interface Product {
  id: string;
  vendorId: string;
  shopId: string;
  shopName?: string;
  shopSlug?: string;
  shopBadges?: string[];
  vendorStatus?: VendorStatus;
  title: string;
  description: string;
  categoryId: string;
  categoryName?: string;
  price: number;
  condition: ProductCondition;
  status: ProductStatus;
  stock: number;
  keywords: string[];
  media: ProductMediaItem[];
  videoUrl: string | null;
  variants: ProductVariant[];
  deliveryFee: number;
  deliveryZones: DeliveryZoneFee[];
  deliveryDelay: string;
  paymentMethods: PaymentMethodId[];
  ratingAverage: number;
  reviewCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface OrderItem {
  id: string;
  orderId: string;
  productId: string;
  variantId?: string | null;
  vendorId: string;
  productTitle: string;
  variantLabel: string | null;
  quantity: number;
  unitPrice: number;
  deliveryFee: number;
  carrier: string | null;
  trackingNumber: string | null;
  itemStatus: OrderEventStatus;
  customSpecs?: CustomSpecs | null;
}

export interface OrderEvent {
  id: string;
  orderId: string;
  status: OrderEventStatus;
  note: string;
  actor: string;
  createdAt: string;
}

export interface VendorBankCoordinate {
  shopId: string;
  shopName: string;
  bankDetails: BankDetails;
}

export interface Order {
  id: string;
  orderNumber: string;
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string | null;
  shippingAddress: string;
  deliveryZone: string;
  subtotal: number;
  deliveryTotal: number;
  totalAmount: number;
  /** Montant HT (produits + livraison). Égal à totalAmount quand la TVA est à 0. */
  vatAmount?: number;
  /** Montant TTC à payer par l'acheteur (totalAmount + TVA). */
  grandTotal?: number;
  /** Commission marketplace prélevée sur le sous-total produits. */
  commissionAmount?: number;
  /** Remise code promo appliquée (FCFA). */
  discountAmount?: number;
  /** Code promo appliqué à la commande. */
  promoCode?: string | null;
  paymentMethod: PaymentMethodId | 'bank_transfer' | 'quote';
  paymentStatus: 'pending' | 'paid' | 'failed' | 'refunded' | 'expired';
  paymentMode?: PaymentMode;
  depositPercent?: number;
  paidAmount?: number;
  balanceDue?: number;
  hasCustomOffer?: boolean;
  bankTransferRef?: string | null;
  quoteThreadToken?: string | null;
  vendorBankDetails?: VendorBankCoordinate[];
  expiresAt: string | null;
  createdAt: string;
  items?: OrderItem[];
  events?: OrderEvent[];
  trackingUrl?: string;
}

export interface MessageThreadItem {
  id: string;
  threadId: string;
  productId: string | null;
  productTitle?: string | null;
  shopId: string;
  shopName?: string;
  vendorId: string;
  buyerName: string;
  buyerEmail: string;
  senderRole: 'buyer' | 'vendor' | 'admin';
  body: string;
  readByVendor: boolean;
  reported: boolean;
  reportCount: number;
  hiddenByModeration: boolean;
  createdAt: string;
}

export interface ReviewItem {
  id: string;
  productId: string;
  productTitle?: string;
  orderId: string;
  buyerName: string;
  rating: number;
  comment: string;
  vendorReply: string | null;
  vendorRepliedAt: string | null;
  reportCount: number;
  moderationStatus: 'visible' | 'signale' | 'retire';
  createdAt: string;
}

export type RuleId =
  | 'RG-01'
  | 'RG-02'
  | 'RG-03'
  | 'RG-04'
  | 'RG-05'
  | 'RG-06'
  | 'RG-07'
  | 'RG-08'
  | 'RG-09'
  | 'RG-10';

export interface PlatformRule {
  ruleId: RuleId;
  title: string;
  helpText: string;
  enabled: boolean;
  valueJson: Record<string, unknown>;
  updatedBy: string;
  updatedAt: string;
}

export interface KycDocumentMeta {
  id: string;
  vendorId: string;
  vendorName?: string;
  vendorEmail?: string;
  docType: string;
  fileName: string;
  mimeType: string;
  reviewStatus: 'en_attente' | 'approuve' | 'rejete';
  rejectionReason: string | null;
  uploadedAt: string;
  reviewedAt: string | null;
  purgeScheduledAt: string | null;
}

export interface PushAlertItem {
  id: string;
  title: string;
  body: string;
  deepLink: string;
  alertType: 'nouveautes' | 'promotions' | 'annonces';
  sentCount: number;
  createdBy: string;
  createdAt: string;
}

export interface AuditLogItem {
  id: string;
  actorId: string;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId: string;
  details: string;
  createdAt: string;
}

export interface OutboxEmail {
  id: string;
  toEmail: string;
  subject: string;
  bodyText: string;
  actionUrl: string | null;
  actionLabel: string | null;
  createdAt: string;
}

export interface PlatformSettings {
  currency: string;
  defaultDeliveryPolicy: string;
  legalMentions: string;
  cgvText: string;
  supportEmail: string;
  supportPhone: string;
  kycRetentionDays: number;
  reviewProcessingDelayLabel: string;
  defaultDepositPercent: number;
  bankTransferThreshold: number;
  /** Commission marketplace prélevée sur le sous-total produits (0 = désactivée). */
  commissionRatePercent: number;
  /** TVA appliquée au montant HT (produits + livraison), 0 = prix tous taxes compris par défaut. */
  vatRatePercent: number;
  /** Mode maintenance : seuls les administrateurs conservent l'accès API. */
  maintenanceMode: boolean;
}

export interface CartItem {
  cartKey?: string;
  productId: string;
  variantId: string | null;
  variantLabel: string | null;
  quantity: number;
  title: string;
  price: number;
  deliveryFee: number;
  deliveryZones?: DeliveryZoneFee[];
  imageUrl: string;
  shopName: string;
  shopId: string;
  paymentMethods: PaymentMethodId[];
  isCustom?: boolean;
  customSpecs?: CustomSpecs | null;
}

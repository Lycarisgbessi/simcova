import type { DeliveryZoneFee, PaymentMethodId } from './types';

/**
 * Single source of truth for the Jumia Africa payment catalog (RG-08) —
 * previously duplicated across CartCheckoutDrawer, VendorWorkspace,
 * AdminConsole, ProductDetailModal and OrderTrackingView.
 */
export const PAYMENT_METHOD_CATALOG: Array<{
  id: PaymentMethodId;
  label: string;
  subtitle: string;
}> = [
  { id: 'mobile_money_orange', label: 'Orange Money', subtitle: 'Validation mobile instantanée via Jumia Africa' },
  { id: 'mobile_money_mtn', label: 'MTN MoMo', subtitle: 'Paiement mobile sécurisé' },
  { id: 'mobile_money_wave', label: 'Wave', subtitle: 'Sans frais cachés via Jumia Africa' },
  {
    id: 'jumia_card',
    label: 'Carte Bancaire (Visa / Mastercard)',
    subtitle: 'Traitement chiffré JumiaPay (aucune donnée stockée)',
  },
  { id: 'jumia_wallet', label: 'Portefeuille JumiaPay', subtitle: 'Règlement rapide' },
];

/** Compact id → label map (labels shown on chips, specs and tracking views). */
export const PAYMENT_METHOD_LABELS: Record<PaymentMethodId, string> = PAYMENT_METHOD_CATALOG.reduce(
  (acc, m) => ({ ...acc, [m.id]: m.label }),
  {} as Record<PaymentMethodId, string>
);

/** Fallback selection when RG-08 does not restrict methods (mirrors server default). */
export const DEFAULT_PAYMENT_METHODS: PaymentMethodId[] = ['mobile_money_orange', 'mobile_money_mtn', 'jumia_card'];

/** All methods supported by the Jumia Africa integration. */
export const ALL_PAYMENT_METHODS: PaymentMethodId[] = PAYMENT_METHOD_CATALOG.map((m) => m.id);

/** Default RG-09 delivery zones — fallback everywhere a zone list is needed. */
export const DEFAULT_DELIVERY_ZONES: DeliveryZoneFee[] = [
  { zoneId: 'abidjan', zoneName: 'Abidjan / Capitale', fee: 1500 },
  { zoneId: 'national', zoneName: 'Intérieur du pays', fee: 3000 },
  { zoneId: 'regional', zoneName: 'Afrique de l’Ouest (CÉDÉAO)', fee: 6500 },
];

/** Default KYC document types when RG-03 carries no list. */
export const DEFAULT_KYC_DOC_TYPES: string[] = [
  'Pièce d’identité officielle',
  'Registre du commerce (RCCM)',
  'Justificatif de domicile',
];

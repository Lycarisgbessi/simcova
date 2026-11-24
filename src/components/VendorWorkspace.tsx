import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Package,
  ShoppingCart,
  MessageSquare,
  Star,
  Store,
  Plus,
  Copy,
  Trash2,
  Sparkles,
  Upload,
  ShieldCheck,
  AlertTriangle,
  ArrowUp,
  ArrowDown,
  Send,
  Flag,
  CheckCircle2,
  Lock,
  GripVertical,
  RotateCcw,
  Video,
  Landmark,
  Banknote,
} from 'lucide-react';
import { api } from '../lib/api';
import {
  formatCurrency,
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
} from '../shared/rulesEngine';
import {
  DEFAULT_DELIVERY_ZONES,
  DEFAULT_KYC_DOC_TYPES,
  DEFAULT_PAYMENT_METHODS,
  PAYMENT_METHOD_CATALOG,
} from '../shared/constants';
import type {
  Category,
  DeliveryZoneFee,
  KycDocumentMeta,
  MessageThreadItem,
  PaymentMethodId,
  PlatformRule,
  PlatformSettings,
  Product,
  ProductCondition,
  ProductMediaItem,
  ProductStatus,
  ProductVariant,
  ReviewItem,
  RuleId,
  Shop,
  UserAccount,
} from '../shared/types';

interface VendorWorkspaceProps {
  categories: Category[];
  rules: Record<RuleId, PlatformRule>;
  settings: PlatformSettings;
  onCatalogRefresh: () => void;
  onToast: (type: 'success' | 'error' | 'info', title: string, description?: string) => void;
}

const VENDOR_STATUS_LABELS: Record<string, { label: string; tone: string }> = {
  en_attente: { label: 'En attente de validation', tone: 'text-[var(--sim-warning-text)] bg-[var(--sim-warning-bg)]' },
  valide: { label: 'Compte validé (non certifié)', tone: 'text-[var(--sim-info-text)] bg-[var(--sim-info-bg)]' },
  rejete: { label: 'Candidature rejetée', tone: 'text-[var(--sim-error-text)] bg-[var(--sim-error-bg)]' },
  certifie: { label: 'Vendeur certifié', tone: 'text-[var(--sim-success-text)] bg-[var(--sim-success-bg)]' },
  suspendu: { label: 'Compte suspendu', tone: 'text-[var(--sim-error-text)] bg-[var(--sim-error-bg)]' },
};

const VENDOR_PAYMENT_OPTIONS: Array<{ id: PaymentMethodId; label: string }> = PAYMENT_METHOD_CATALOG.map(
  (m) => ({ id: m.id, label: m.label })
);

export const VendorWorkspace: React.FC<VendorWorkspaceProps> = ({
  categories,
  rules,
  settings,
  onCatalogRefresh,
  onToast,
}) => {
  const [tab, setTab] = useState<'overview' | 'products' | 'orders' | 'messages' | 'reviews' | 'shop'>('overview');
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<UserAccount | null>(null);
  const [shop, setShop] = useState<Shop | null>(null);
  const [kpis, setKpis] = useState({
    revenueTotal: 0,
    commissionTotal: 0,
    netRevenue: 0,
    pendingOrdersCount: 0,
    publishedProductsCount: 0,
    totalProductsCount: 0,
    avgRating: 0,
    reviewCount: 0,
  });
  const [products, setProducts] = useState<Product[]>([]);
  const [orderItems, setOrderItems] = useState<Array<Record<string, unknown>>>([]);
  const [kycDocs, setKycDocs] = useState<KycDocumentMeta[]>([]);
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [messages, setMessages] = useState<MessageThreadItem[]>([]);

  // Product Editor Modal/Drawer State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [pTitle, setPTitle] = useState('');
  const [pDesc, setPDesc] = useState('');
  const [pCat, setPCat] = useState(categories[0]?.id || '');
  const [pPrice, setPPrice] = useState('25000');
  const [pCondition, setPCondition] = useState<ProductCondition>('Neuf');
  const [pStatus, setPStatus] = useState<ProductStatus>('publie');
  const [pStock, setPStock] = useState('10');
  const [pDeliveryFee, setPDeliveryFee] = useState('2000');
  const [pDeliveryDelay, setPDeliveryDelay] = useState('24 à 48h');
  const [pKeywords, setPKeywords] = useState('');
  const [pVideoUrl, setPVideoUrl] = useState('');
  const [pMedia, setPMedia] = useState<ProductMediaItem[]>([]);
  const [pVariants, setPVariants] = useState<ProductVariant[]>([]);
  const [pZones, setPZones] = useState<DeliveryZoneFee[]>([]);
  const [pPayments, setPPayments] = useState<PaymentMethodId[]>([
    'mobile_money_orange',
    'mobile_money_mtn',
    'jumia_card',
  ]);
  const [newImgUrl, setNewImgUrl] = useState('');
  const [savingProduct, setSavingProduct] = useState(false);

  // Order fulfillment, quote pricing & bank transfer confirmation inputs
  const [carrierInputs, setCarrierInputs] = useState<Record<string, string>>({});
  const [trackNumInputs, setTrackNumInputs] = useState<Record<string, string>>({});
  const [quoteOfferInputs, setQuoteOfferInputs] = useState<Record<string, string>>({});
  const [bankRefInputs, setBankRefInputs] = useState<Record<string, string>>({});
  const [confirmRefundId, setConfirmRefundId] = useState<string | null>(null);
  const [refundReasonInputs, setRefundReasonInputs] = useState<Record<string, string>>({});
  const [draggedMediaIdx, setDraggedMediaIdx] = useState<number | null>(null);

  // Message reply & review reply inputs
  const [msgReplies, setMsgReplies] = useState<Record<string, string>>({});
  const [revReplies, setRevReplies] = useState<Record<string, string>>({});

  // Shop & KYC state
  const [shopForm, setShopForm] = useState({
    name: '',
    description: '',
    city: '',
    contactPhone: '',
    logoUrl: '',
    defaultDeliveryFee: '2000',
    defaultDeliveryDelay: '24 à 72h',
    bankName: '',
    accountHolder: '',
    iban: '',
    swiftBic: '',
    bankInstructions: '',
  });
  // Memoized so the KYC-type effect below no longer runs on every render
  const availableKycDocs = useMemo(
    () =>
      (rules['RG-03']?.valueJson?.availableDocs as string[] | undefined) ??
      (rules['RG-03']?.valueJson?.requiredDocs as string[] | undefined) ??
      DEFAULT_KYC_DOC_TYPES,
    [rules]
  );
  const [kycType, setKycType] = useState<string>(availableKycDocs[0] || DEFAULT_KYC_DOC_TYPES[0]);
  const [demoVerifToken, setDemoVerifToken] = useState<string | null>(null);

  useEffect(() => {
    if (availableKycDocs.length > 0 && !availableKycDocs.includes(kycType)) {
      setKycType(availableKycDocs[0]);
    }
  }, [availableKycDocs, kycType]);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.vendorDashboard();
      setUser(data.user);
      setShop(data.shop);
      setKpis(data.kpis);
      setProducts(data.products);
      setOrderItems(data.orderItems);
      setKycDocs(data.kycDocs);
      setReviews(data.reviews);
      setMessages(data.messages);
      if (data.shop) {
        setShopForm({
          name: data.shop.name,
          description: data.shop.description,
          city: data.shop.city || '',
          contactPhone: data.shop.contactPhone || '',
          logoUrl: data.shop.logoUrl || '',
          defaultDeliveryFee: String(data.shop.defaultDeliveryFee),
          defaultDeliveryDelay: data.shop.defaultDeliveryDelay,
          bankName: data.shop.bankDetails?.bankName || '',
          accountHolder: data.shop.bankDetails?.accountHolder || '',
          iban: data.shop.bankDetails?.iban || '',
          swiftBic: data.shop.bankDetails?.swiftBic || '',
          bankInstructions: data.shop.bankDetails?.instructions || '',
        });
      }
    } catch (err) {
      onToast('error', 'Erreur de chargement', err instanceof Error ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const getDefaultZones = (): DeliveryZoneFee[] =>
    ((rules['RG-09']?.valueJson?.zones as DeliveryZoneFee[] | undefined) ?? DEFAULT_DELIVERY_ZONES).map((z) => ({
      ...z,
    }));

  const openNewProduct = () => {
    const canPublishImmediately =
      user?.role === 'admin' ||
      (user?.emailVerified &&
        (isCertified || (user?.status === 'valide' && !rg01Active)));
    const defaultMethods =
      (rules['RG-08']?.valueJson?.methods as PaymentMethodId[] | undefined) ?? DEFAULT_PAYMENT_METHODS;
    setEditingId(null);
    setPTitle('');
    setPDesc('');
    setPCat(categories.find((c) => c.active && !c.forbidden)?.id || categories[0]?.id || '');
    setPPrice('25000');
    setPCondition('Neuf');
    setPStatus(canPublishImmediately ? 'publie' : 'brouillon');
    setPStock('10');
    setPDeliveryFee(String(shop?.defaultDeliveryFee ?? rules['RG-09']?.valueJson?.defaultFlatFee ?? 2000));
    setPDeliveryDelay(shop?.defaultDeliveryDelay || '24 à 48h');
    setPKeywords('');
    setPVideoUrl('');
    setPMedia([]);
    setPVariants([]);
    setPZones(getDefaultZones());
    setPPayments(defaultMethods);
    setShowEditor(true);
  };

  const openEditProduct = (p: Product) => {
    setEditingId(p.id);
    setPTitle(p.title);
    setPDesc(p.description);
    setPCat(p.categoryId);
    setPPrice(String(p.price));
    setPCondition(p.condition);
    setPStatus(p.status);
    setPStock(String(p.stock));
    setPDeliveryFee(String(p.deliveryFee));
    setPDeliveryDelay(p.deliveryDelay);
    setPKeywords(p.keywords.join(', '));
    setPVideoUrl(p.videoUrl || '');
    setPMedia(p.media);
    setPVariants(p.variants);
    setPZones(p.deliveryZones?.length ? p.deliveryZones.map((z) => ({ ...z })) : getDefaultZones());
    setPPayments(p.paymentMethods);
    setShowEditor(true);
  };

  const handleUploadImageFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const res = await api.uploadMedia(String(reader.result), file.name);
          setPMedia((prev) => [
            ...prev,
            {
              id: `med-${Date.now().toString(36)}-${prev.length}`,
              url: res.url,
              type: 'image',
              order: prev.length,
              alt: pTitle || file.name,
            },
          ]);
          onToast('success', 'Image ajoutée');
        } catch (err) {
          onToast('error', 'Échec du téléversement', err instanceof Error ? err.message : undefined);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleUploadVideoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await api.uploadMedia(String(reader.result), file.name);
        setPVideoUrl(res.url);
        onToast('success', 'Vidéo ajoutée à la fiche');
      } catch (err) {
        onToast('error', 'Échec du téléversement vidéo', err instanceof Error ? err.message : undefined);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleUploadShopLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await api.uploadMedia(String(reader.result), file.name);
        setShopForm((s) => ({ ...s, logoUrl: res.url }));
        onToast('success', 'Logo importé');
      } catch (err) {
        onToast('error', 'Échec import logo', err instanceof Error ? err.message : undefined);
      }
    };
    reader.readAsDataURL(file);
  };

  const moveMedia = (idx: number, dir: -1 | 1) => {
    const next = [...pMedia];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    setPMedia(next.map((m, i) => ({ ...m, order: i })));
  };

  const reorderMediaDrop = (fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0 || fromIdx >= pMedia.length || toIdx >= pMedia.length) {
      return;
    }
    const next = [...pMedia];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    setPMedia(next.map((m, i) => ({ ...m, order: i })));
  };

  const handleGenerateKeywords = async () => {
    const catName = categories.find((c) => c.id === pCat)?.name || '';
    try {
      const res = await api.suggestKeywords(pTitle, pDesc, catName);
      setPKeywords(res.keywords.join(', '));
      onToast('success', 'Mots-clés générés automatiquement');
    } catch (err) {
      onToast('error', 'Erreur', err instanceof Error ? err.message : undefined);
    }
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProduct(true);
    const payload: Partial<Product> = {
      title: pTitle,
      description: pDesc,
      categoryId: pCat,
      price: Number(pPrice),
      condition: pCondition,
      status: pStatus,
      stock: Number(pStock),
      deliveryFee: Number(pDeliveryFee),
      deliveryDelay: pDeliveryDelay,
      keywords: pKeywords
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      media: pMedia,
      videoUrl: pVideoUrl.trim() || null,
      variants: pVariants,
      deliveryZones: pZones,
      paymentMethods: pPayments,
    };

    try {
      if (editingId) {
        await api.updateProduct(editingId, payload);
        onToast('success', 'Produit mis à jour');
      } else {
        await api.createProduct(payload);
        onToast('success', 'Produit créé');
      }
      setShowEditor(false);
      await loadDashboard();
      onCatalogRefresh();
    } catch (err) {
      onToast('error', 'Action bloquée par une règle', err instanceof Error ? err.message : undefined);
    } finally {
      setSavingProduct(false);
    }
  };

  const handleKycUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await api.uploadKyc({
          docType: kycType,
          fileName: file.name,
          contentBase64: String(reader.result),
          mimeType: file.type || 'application/octet-stream',
        });
        onToast('success', 'Pièce chiffrée et déposée', 'Votre document sera examiné par l’administrateur.');
        loadDashboard();
      } catch (err) {
        onToast('error', 'Échec du dépôt KYC', err instanceof Error ? err.message : undefined);
      }
    };
    reader.readAsDataURL(file);
  };

  // Group messages by threadId
  const threadsMap = new Map<string, MessageThreadItem[]>();
  for (const m of messages) {
    const list = threadsMap.get(m.threadId) ?? [];
    list.push(m);
    threadsMap.set(m.threadId, list);
  }

  const statusMeta = user ? VENDOR_STATUS_LABELS[user.status] || VENDOR_STATUS_LABELS.en_attente : VENDOR_STATUS_LABELS.en_attente;
  const rg01Active = rules['RG-01']?.enabled;
  const rg05Limit = Number((rules['RG-05']?.valueJson?.maxProducts as number) ?? 10);
  const isCertified = user?.status === 'certifie' || user?.badges?.includes('Vendeur certifié');

  if (loading) {
    return <div className="h-64 rounded-[var(--sim-radius-xl)] sim-skeleton" />;
  }

  return (
    <div className="space-y-6">
      {/* Bandeau statut vendeur & règles actives */}
      {user && (
        <div className="rounded-[var(--sim-radius-xl)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs text-[var(--sim-text-muted)]">
                Espace Vendeur · {shop?.name}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2.5">
                <span className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-semibold ${statusMeta.tone}`}>
                  {isCertified && <ShieldCheck className="w-3.5 h-3.5" />}
                  {statusMeta.label}
                </span>
                <span className="text-xs text-[var(--sim-text-secondary)]">
                  Délai d’examen annoncé : {settings.reviewProcessingDelayLabel}
                </span>
              </div>
            </div>

            <div className="text-xs text-[var(--sim-text-secondary)] text-right">
              {user.role !== 'admin' && rg01Active && !isCertified && (
                <p className="font-semibold text-[var(--sim-warning-text)]">
                  Règle RG-01 active : certification requise pour publier (brouillons autorisés).
                </p>
              )}
              {user.role !== 'admin' && rules['RG-05']?.enabled && !isCertified && (
                <p>
                  Plafond actuel (RG-05) : {kpis.publishedProductsCount} / {rg05Limit} produits publiés.
                </p>
              )}
            </div>
          </div>

          {user.rejectionReason && (
            <div className="flex items-center gap-2 rounded-[var(--sim-radius-md)] bg-[var(--sim-error-bg)] p-3 text-xs text-[var(--sim-error-text)]">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>
                <strong>Motif communiqué par l’administration :</strong> {user.rejectionReason}
              </span>
            </div>
          )}

          {!user.emailVerified && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--sim-radius-md)] bg-[var(--sim-warning-bg)] p-3 text-xs text-[var(--sim-warning-text)]">
              <span>Votre adresse électronique n’est pas encore confirmée. Confirmez-la pour pouvoir publier.</span>
              <div className="flex items-center gap-2">
                {demoVerifToken ? (
                  <button
                    type="button"
                    onClick={async () => {
                      await api.verifyEmail(demoVerifToken);
                      setDemoVerifToken(null);
                      loadDashboard();
                      onToast('success', 'Courriel confirmé !');
                    }}
                    className="rounded bg-[var(--sim-warning-text)] px-3 py-1 font-semibold text-white"
                  >
                    Valider le lien maintenant
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={async () => {
                      const r = await api.resendVerification();
                      setDemoVerifToken(r.verificationToken);
                    }}
                    className="underline font-semibold"
                  >
                    Renvoyer le lien de confirmation
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Onglets de l'Espace Vendeur */}
      <div role="tablist" className="flex flex-wrap items-center gap-1.5 border-b border-[var(--sim-border-hairline)] pb-3">
        {(
          [
            ['overview', 'Synthèse', Package],
            ['products', `Produits (${products.length})`, Package],
            ['orders', `Commandes (${orderItems.length})`, ShoppingCart],
            ['messages', `Messagerie (${threadsMap.size})`, MessageSquare],
            ['reviews', `Avis (${reviews.length})`, Star],
            ['shop', 'Boutique & KYC', Store],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`inline-flex items-center gap-2 rounded-[var(--sim-radius-md)] px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
              tab === id
                ? 'bg-[var(--sim-accent-500)] text-white'
                : 'bg-[var(--sim-bg-subtle)] text-[var(--sim-text-secondary)] hover:text-[var(--sim-text-primary)]'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* 1. Synthèse Vendeur (EXF-301) */}
      {tab === 'overview' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-[var(--sim-radius-lg)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-5">
            <p className="text-xs text-[var(--sim-text-muted)]">Ventes confirmées</p>
            <p className="mt-2 font-mono-nums text-2xl font-bold text-[var(--sim-text-primary)]">
              {formatCurrency(kpis.revenueTotal, settings.currency)}
            </p>
            {kpis.commissionTotal > 0 && (
              <p className="mt-1 text-[11px] text-[var(--sim-text-muted)]">
                Commission plateforme ({settings.commissionRatePercent}%) :{' '}
                <span className="font-mono-nums">-{formatCurrency(kpis.commissionTotal, settings.currency)}</span> · Net
                : <span className="font-mono-nums">{formatCurrency(kpis.netRevenue, settings.currency)}</span>
              </p>
            )}
          </div>
          <div className="rounded-[var(--sim-radius-lg)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-5">
            <p className="text-xs text-[var(--sim-text-muted)]">Commandes à traiter</p>
            <p className="mt-2 font-mono-nums text-2xl font-bold text-[var(--sim-accent-600)]">
              {kpis.pendingOrdersCount}
            </p>
          </div>
          <div className="rounded-[var(--sim-radius-lg)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-5">
            <p className="text-xs text-[var(--sim-text-muted)]">Produits en ligne</p>
            <p className="mt-2 font-mono-nums text-2xl font-bold text-[var(--sim-text-primary)]">
              {kpis.publishedProductsCount} / {kpis.totalProductsCount}
            </p>
          </div>
          <div className="rounded-[var(--sim-radius-lg)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-5">
            <p className="text-xs text-[var(--sim-text-muted)]">Note moyenne boutique</p>
            <p className="mt-2 font-mono-nums text-2xl font-bold text-[var(--sim-text-primary)]">
              {kpis.avgRating > 0 ? `${kpis.avgRating} / 5` : '—'}
            </p>
          </div>
        </div>
      )}

      {/* 2. Gestion des Produits (EXF-302 .. EXF-311) */}
      {tab === 'products' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl font-bold text-[var(--sim-text-primary)]">
              Mes fiches produits
            </h2>
            <button
              type="button"
              onClick={openNewProduct}
              className="inline-flex items-center gap-2 rounded-[var(--sim-radius-md)] bg-[var(--sim-accent-500)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--sim-accent-600)]"
            >
              <Plus className="w-4 h-4" />
              <span>Nouveau produit</span>
            </button>
          </div>

          {showEditor && (
            <form
              onSubmit={handleSaveProduct}
              className="rounded-[var(--sim-radius-xl)] border border-[var(--sim-border-strong)] bg-[var(--sim-bg-surface)] p-6 space-y-5"
            >
              <div className="flex items-center justify-between border-b border-[var(--sim-border-hairline)] pb-3">
                <h3 className="font-display text-lg font-bold text-[var(--sim-text-primary)]">
                  {editingId ? 'Modifier le produit' : 'Créer une nouvelle fiche produit'}
                </h3>
                <button
                  type="button"
                  onClick={() => setShowEditor(false)}
                  className="text-xs font-semibold text-[var(--sim-text-muted)]"
                >
                  Fermer
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="prod-title" className="sim-label">Nom de l’équipement / produit *</label>
                  <input
                    id="prod-title"
                    required
                    value={pTitle}
                    onChange={(e) => setPTitle(e.target.value)}
                    className="sim-input"
                  />
                </div>
                <div>
                  <label htmlFor="prod-cat" className="sim-label">Catégorie *</label>
                  <select
                    id="prod-cat"
                    value={pCat}
                    onChange={(e) => setPCat(e.target.value)}
                    className="sim-input"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.forbidden ? '(Interdite)' : ''} {c.requiredBadge ? `· Requis: ${c.requiredBadge}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="prod-desc" className="sim-label">Description technique détaillée *</label>
                  <textarea
                    id="prod-desc"
                    required
                    rows={3}
                    value={pDesc}
                    onChange={(e) => setPDesc(e.target.value)}
                    className="sim-input"
                  />
                </div>
                <div>
                  <label htmlFor="prod-price" className="sim-label">Prix ({settings.currency}) *</label>
                  <input
                    id="prod-price"
                    type="number"
                    min="100"
                    required
                    value={pPrice}
                    onChange={(e) => setPPrice(e.target.value)}
                    className="sim-input font-mono-nums"
                  />
                </div>
                <div>
                  <label htmlFor="prod-stock" className="sim-label">Stock disponible</label>
                  <input
                    id="prod-stock"
                    type="number"
                    min="0"
                    value={pStock}
                    onChange={(e) => setPStock(e.target.value)}
                    className="sim-input font-mono-nums"
                  />
                </div>
                <div>
                  <label htmlFor="prod-cond" className="sim-label">État</label>
                  <select
                    id="prod-cond"
                    value={pCondition}
                    onChange={(e) => setPCondition(e.target.value as ProductCondition)}
                    className="sim-input"
                  >
                    <option value="Neuf">Neuf</option>
                    <option value="Artisanal">Artisanal</option>
                    <option value="Reconditionné">Reconditionné</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="prod-status" className="sim-label">Statut de publication</label>
                  <select
                    id="prod-status"
                    value={pStatus}
                    onChange={(e) => setPStatus(e.target.value as ProductStatus)}
                    className="sim-input"
                  >
                    <option value="brouillon">Brouillon</option>
                    <option value="publie">Publié au catalogue</option>
                    <option value="archive">Archivé</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="prod-deliv" className="sim-label">Frais de livraison ({settings.currency})</label>
                  <input
                    id="prod-deliv"
                    type="number"
                    min="0"
                    value={pDeliveryFee}
                    onChange={(e) => setPDeliveryFee(e.target.value)}
                    className="sim-input font-mono-nums"
                  />
                </div>
                <div>
                  <label htmlFor="prod-delay" className="sim-label">Délai indicatif</label>
                  <input
                    id="prod-delay"
                    value={pDeliveryDelay}
                    onChange={(e) => setPDeliveryDelay(e.target.value)}
                    className="sim-input"
                  />
                </div>
              </div>

              {/* Mots-clés + Génération automatique (EXF-305) */}
              <div>
                <div className="flex items-center justify-between">
                  <label htmlFor="prod-kw" className="block text-xs font-semibold">
                    Mots-clés de recherche (séparés par des virgules)
                  </label>
                  <button
                    type="button"
                    onClick={handleGenerateKeywords}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--sim-accent-600)] hover:underline"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Générer automatiquement</span>
                  </button>
                </div>
                <input
                  id="prod-kw"
                  value={pKeywords}
                  onChange={(e) => setPKeywords(e.target.value)}
                  placeholder="tracteur, 4x4, diesel, chantier, hydraulique..."
                  className="mt-1 w-full rounded-[var(--sim-radius-sm)] border border-[var(--sim-border-strong)] px-3 py-2 text-sm"
                />
              </div>

              {/* Galerie images avec glisser-déposer + réorganisation et vidéo */}
              <div className="space-y-3 border-t border-[var(--sim-border-hairline)] pt-4">
                <p className="sim-label">Images (glisser-déposer ou flèches) &amp; Vidéo courte</p>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="inline-flex items-center gap-2 rounded-[var(--sim-radius-md)] border border-[var(--sim-border-strong)] px-3.5 py-2 text-xs font-semibold cursor-pointer hover:border-[var(--sim-accent-500)]">
                    <Upload className="w-3.5 h-3.5" />
                    <span>Téléverser des images</span>
                    <input type="file" accept="image/*" multiple onChange={handleUploadImageFile} className="sr-only" />
                  </label>
                  <div className="flex flex-1 min-w-[220px] gap-2">
                    <input
                      value={newImgUrl}
                      onChange={(e) => setNewImgUrl(e.target.value)}
                      placeholder="Ou coller une URL d’image (/src/assets/...)"
                      className="sim-input flex-1 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (!newImgUrl.trim()) return;
                        setPMedia((m) => [
                          ...m,
                          { id: `med-${Date.now()}`, url: newImgUrl.trim(), type: 'image', order: m.length, alt: pTitle || 'Produit' },
                        ]);
                        setNewImgUrl('');
                      }}
                      className="sim-btn-secondary py-1.5 px-3"
                    >
                      Ajouter URL
                    </button>
                  </div>
                </div>

                {pMedia.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {pMedia.map((m, idx) => (
                      <div
                        key={m.id}
                        draggable
                        onDragStart={() => setDraggedMediaIdx(idx)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => {
                          if (draggedMediaIdx !== null) {
                            reorderMediaDrop(draggedMediaIdx, idx);
                            setDraggedMediaIdx(null);
                          }
                        }}
                        className={`rounded-[var(--sim-radius-md)] border p-2 space-y-1.5 cursor-grab active:cursor-grabbing transition-colors ${
                          draggedMediaIdx === idx
                            ? 'border-[var(--sim-accent-500)] bg-[var(--sim-accent-50)]'
                            : 'border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)]'
                        }`}
                      >
                        <img src={m.url} alt={m.alt} referrerPolicy="no-referrer" className="aspect-[4/3] w-full object-cover rounded" />
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="inline-flex items-center gap-1 font-semibold text-[var(--sim-text-muted)]">
                            <GripVertical className="w-3 h-3" />
                            {idx === 0 ? 'Couverture' : `#${idx + 1}`}
                          </span>
                          <div className="flex items-center gap-1">
                            <button type="button" aria-label="Monter" onClick={() => moveMedia(idx, -1)} className="p-0.5">
                              <ArrowUp className="w-3.5 h-3.5" />
                            </button>
                            <button type="button" aria-label="Descendre" onClick={() => moveMedia(idx, 1)} className="p-0.5">
                              <ArrowDown className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              aria-label="Retirer"
                              onClick={() => setPMedia((list) => list.filter((_, i) => i !== idx))}
                              className="p-0.5 text-[var(--sim-error-text)]"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="space-y-2 pt-1">
                  <label htmlFor="prod-video" className="sim-label">
                    Vidéo de démonstration facultative (MP4 / WebM)
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="inline-flex items-center gap-2 rounded-[var(--sim-radius-md)] border border-[var(--sim-border-strong)] px-3 py-2 text-xs font-semibold cursor-pointer hover:border-[var(--sim-accent-500)] shrink-0">
                      <Video className="w-3.5 h-3.5 text-[var(--sim-accent-500)]" />
                      <span>Importer une vidéo</span>
                      <input type="file" accept="video/mp4,video/webm" onChange={handleUploadVideoFile} className="sr-only" />
                    </label>
                    <input
                      id="prod-video"
                      value={pVideoUrl}
                      onChange={(e) => setPVideoUrl(e.target.value)}
                      placeholder="Ou coller URL vidéo : https://... ou /api/uploads/clip.mp4"
                      className="sim-input flex-1 min-w-[200px] text-xs"
                    />
                  </div>
                  {pVideoUrl && (
                    <video
                      src={pVideoUrl}
                      controls
                      className="mt-2 max-h-40 w-full max-w-sm rounded-[var(--sim-radius-md)] border border-[var(--sim-border-hairline)] bg-black"
                    />
                  )}
                </div>
              </div>

              {/* Variantes EXF-311 */}
              <div className="space-y-2 border-t border-[var(--sim-border-hairline)] pt-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold">Variantes de produit (taille, couleur...)</span>
                  <button
                    type="button"
                    onClick={() =>
                      setPVariants((v) => [
                        ...v,
                        { id: `var-${Date.now().toString(36)}`, label: 'Nouvelle option', priceOverride: null, stock: 5 },
                      ])
                    }
                    className="text-xs font-semibold text-[var(--sim-accent-600)] hover:underline"
                  >
                    + Ajouter une variante
                  </button>
                </div>
                {pVariants.map((v, i) => (
                  <div key={v.id} className="grid grid-cols-12 gap-2 items-center">
                    <input
                      value={v.label}
                      onChange={(e) =>
                        setPVariants((arr) => arr.map((x, idx) => (idx === i ? { ...x, label: e.target.value } : x)))
                      }
                      placeholder="Libellé (ex. Taille L)"
                      className="col-span-5 rounded border border-[var(--sim-border-strong)] px-2.5 py-1.5 text-xs"
                    />
                    <input
                      type="number"
                      value={v.priceOverride ?? ''}
                      onChange={(e) =>
                        setPVariants((arr) =>
                          arr.map((x, idx) =>
                            idx === i ? { ...x, priceOverride: e.target.value ? Number(e.target.value) : null } : x
                          )
                        )
                      }
                      placeholder="Prix optionnel"
                      className="col-span-4 rounded border border-[var(--sim-border-strong)] px-2.5 py-1.5 text-xs font-mono-nums"
                    />
                    <input
                      type="number"
                      value={v.stock}
                      onChange={(e) =>
                        setPVariants((arr) => arr.map((x, idx) => (idx === i ? { ...x, stock: Number(e.target.value) } : x)))
                      }
                      placeholder="Stock"
                      className="col-span-2 rounded border border-[var(--sim-border-strong)] px-2.5 py-1.5 text-xs font-mono-nums"
                    />
                    <button
                      type="button"
                      aria-label="Supprimer variante"
                      onClick={() => setPVariants((arr) => arr.filter((_, idx) => idx !== i))}
                      className="col-span-1 text-[var(--sim-error-text)]"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Zones de livraison & Modes de paiement */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-[var(--sim-border-hairline)] pt-4">
                <div className="space-y-2">
                  <p className="sim-label">Tarifs par zone de livraison</p>
                  <div className="space-y-1.5">
                    {pZones.map((z, idx) => (
                      <div key={z.zoneId} className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-[var(--sim-text-secondary)] truncate">{z.zoneName}</span>
                        <input
                          type="number"
                          min={0}
                          step={100}
                          value={z.fee}
                          onChange={(e) =>
                            setPZones((arr) =>
                              arr.map((item, i) => (i === idx ? { ...item, fee: Number(e.target.value) } : item))
                            )
                          }
                          className="w-28 rounded border border-[var(--sim-border-strong)] bg-[var(--sim-bg-surface)] px-2 py-1 text-xs font-mono-nums"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="sim-label">Modes de paiement acceptés (RG-08)</p>
                  <div className="flex flex-wrap gap-2.5">
                    {VENDOR_PAYMENT_OPTIONS.map((opt) => {
                      const rg08Methods = (rules['RG-08']?.valueJson?.methods as PaymentMethodId[] | undefined) ?? [];
                      const disabledByAdmin = rules['RG-08']?.enabled && rg08Methods.length > 0 && !rg08Methods.includes(opt.id);
                      const checked = pPayments.includes(opt.id);
                      return (
                        <label
                          key={opt.id}
                          className={`inline-flex items-center gap-1.5 text-xs ${
                            disabledByAdmin ? 'opacity-45 cursor-not-allowed' : 'cursor-pointer'
                          }`}
                        >
                          <input
                            type="checkbox"
                            disabled={Boolean(disabledByAdmin)}
                            checked={checked}
                            onChange={(e) => {
                              const next = new Set<PaymentMethodId>(pPayments);
                              if (e.target.checked) next.add(opt.id);
                              else next.delete(opt.id);
                              setPPayments([...next]);
                            }}
                          />
                          <span>{opt.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowEditor(false)}
                  className="rounded-[var(--sim-radius-md)] border border-[var(--sim-border-strong)] px-4 py-2 text-xs font-semibold"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={savingProduct}
                  className="rounded-[var(--sim-radius-md)] bg-[var(--sim-accent-500)] px-5 py-2 text-xs font-semibold text-white hover:bg-[var(--sim-accent-600)]"
                >
                  {savingProduct ? 'Enregistrement...' : 'Enregistrer le produit'}
                </button>
              </div>
            </form>
          )}

          <div className="space-y-3">
            {products.length === 0 ? (
              <div className="rounded-[var(--sim-radius-lg)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-10 text-center text-sm text-[var(--sim-text-secondary)]">
                Aucun équipement créé. Cliquez sur « Nouveau produit » pour publier votre première machine.
              </div>
            ) : (
              products.map((p) => (
                <div
                  key={p.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-[var(--sim-radius-lg)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-4"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="h-14 w-16 shrink-0 rounded bg-[var(--sim-bg-subtle)] overflow-hidden">
                      {p.media[0]?.url && (
                        <img src={p.media[0].url} alt={p.title} referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--sim-text-muted)]">
                        <span className="font-semibold text-[var(--sim-text-primary)]">{p.status.toUpperCase()}</span>
                        <span>·</span>
                        <span>{p.categoryName}</span>
                        <span>·</span>
                        <span
                          className={`font-mono-nums font-semibold ${
                            p.stock === 0
                              ? 'text-[var(--sim-error-text)]'
                              : p.stock <= 3
                              ? 'text-[var(--sim-warning-text)]'
                              : 'text-[var(--sim-text-secondary)]'
                          }`}
                        >
                          {p.stock === 0
                            ? 'Rupture · Archivé'
                            : p.stock <= 3
                            ? `Stock critique (${p.stock})`
                            : `Stock : ${p.stock}`}
                        </span>
                      </div>
                      <p className="font-display text-base font-semibold text-[var(--sim-text-primary)] truncate">
                        {p.title}
                      </p>
                    <p className="font-mono-nums text-xs font-semibold text-[var(--sim-accent-600)]">
                      {formatCurrency(p.price, settings.currency)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => openEditProduct(p)}
                    className="rounded-[var(--sim-radius-sm)] border border-[var(--sim-border-strong)] px-3 py-1.5 text-xs font-semibold"
                  >
                    Modifier
                  </button>
                  <button
                    type="button"
                    aria-label={`Dupliquer ${p.title}`}
                    onClick={async () => {
                      await api.duplicateProduct(p.id);
                      loadDashboard();
                      onToast('info', 'Produit dupliqué en brouillon');
                    }}
                    className="rounded-[var(--sim-radius-sm)] border border-[var(--sim-border-strong)] p-1.5 text-[var(--sim-text-secondary)]"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Supprimer ${p.title}`}
                    onClick={async () => {
                      await api.deleteProduct(p.id);
                      loadDashboard();
                      onCatalogRefresh();
                      onToast('info', 'Produit retiré');
                    }}
                    className="rounded-[var(--sim-radius-sm)] border border-[var(--sim-border-strong)] p-1.5 text-[var(--sim-error-text)]"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* 3. Traitement des Commandes & Remboursement Vendeur */}
      {tab === 'orders' && (
        <div className="space-y-4">
          <h2 className="font-display text-xl font-bold text-[var(--sim-text-primary)]">
            Commandes reçues à traiter
          </h2>
          {orderItems.length === 0 ? (
            <div className="rounded-[var(--sim-radius-lg)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-10 text-center text-sm text-[var(--sim-text-secondary)]">
              Aucune commande reçue pour l’instant.
            </div>
          ) : (
            orderItems.map((oi) => {
              const orderId = String(oi.order_id);
              const itemStatus = String(oi.item_status);
              const paymentStatus = String(oi.payment_status);
              const paymentMode = String(oi.payment_mode || 'full');
              const totalAmount = Number(oi.total_amount || 0);
              const paidAmount = Number(oi.paid_amount || 0);
              const balanceDue = Number(oi.balance_due || 0);
              const bankTransferRef = oi.bank_transfer_ref ? String(oi.bank_transfer_ref) : '';
              const customSpecs = (oi.customSpecs as { dimensions?: string; technicalSpecs?: string; notes?: string } | null) || null;
              const canRefund = paymentStatus === 'paid' && !['livree', 'annulee', 'remboursee'].includes(itemStatus);
              const modeLabel =
                paymentMode === 'deposit'
                  ? `Acompte (${Number(oi.deposit_percent || settings.defaultDepositPercent)}%)`
                  : paymentMode === 'quote'
                  ? 'Devis sur mesure'
                  : paymentMode === 'bank_transfer'
                  ? 'Virement bancaire'
                  : 'Paiement intégral';
              return (
                <div
                  key={String(oi.id)}
                  className="rounded-[var(--sim-radius-lg)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-5 space-y-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-mono-nums text-sm font-bold text-[var(--sim-text-primary)]">
                        {String(oi.order_number)} · {String(oi.product_title)} × {Number(oi.quantity)}
                      </p>
                      <p className="text-xs text-[var(--sim-text-secondary)]">
                        Client : {String(oi.buyer_name)} ({String(oi.buyer_email)}) · {String(oi.shipping_address)}
                      </p>
                      <p className="mt-1 font-mono-nums text-[11px] text-[var(--sim-text-muted)]">
                        {modeLabel} · Total : {formatCurrency(totalAmount, settings.currency)} · Encaissé :{' '}
                        {formatCurrency(paidAmount, settings.currency)}
                        {balanceDue > 0 ? ` · Reste dû : ${formatCurrency(balanceDue, settings.currency)}` : ''}
                      </p>
                    </div>
                    <span className="text-xs font-semibold text-[var(--sim-accent-600)]">
                      Statut : {ORDER_STATUS_LABELS[itemStatus] || itemStatus} · Paiement :{' '}
                      {PAYMENT_STATUS_LABELS[paymentStatus] || paymentStatus}
                    </span>
                  </div>

                  {customSpecs && (customSpecs.dimensions || customSpecs.technicalSpecs || customSpecs.notes) && (
                    <div className="rounded-[var(--sim-radius-md)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-subtle)] p-3 text-xs space-y-1">
                      <p className="font-semibold text-[var(--sim-text-primary)]">Spécificités sur mesure demandées :</p>
                      {customSpecs.dimensions && (
                        <p className="text-[var(--sim-text-secondary)]">
                          <strong>Dimensions / capacité :</strong> {customSpecs.dimensions}
                        </p>
                      )}
                      {customSpecs.technicalSpecs && (
                        <p className="text-[var(--sim-text-secondary)]">
                          <strong>Contraintes techniques :</strong> {customSpecs.technicalSpecs}
                        </p>
                      )}
                      {customSpecs.notes && (
                        <p className="text-[var(--sim-text-secondary)]">
                          <strong>Notes :</strong> {customSpecs.notes}
                        </p>
                      )}
                    </div>
                  )}

                  {paymentMode === 'quote' && paymentStatus === 'pending' && (
                    <div className="flex flex-wrap items-center gap-2 rounded-[var(--sim-radius-md)] border border-[var(--sim-accent-500)]/30 bg-[var(--sim-accent-50)] p-3 text-xs">
                      <span className="font-semibold text-[var(--sim-accent-600)]">
                        Chiffrer le devis ({settings.currency}) :
                      </span>
                      <input
                        type="number"
                        min={1000}
                        step={1000}
                        value={quoteOfferInputs[orderId] ?? (totalAmount > 0 ? String(totalAmount) : '')}
                        onChange={(e) => setQuoteOfferInputs((q) => ({ ...q, [orderId]: e.target.value }))}
                        placeholder="Montant total TTC"
                        className="sim-input w-44 py-1.5 text-xs font-mono-nums"
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          const val = Number(quoteOfferInputs[orderId] ?? totalAmount);
                          if (!Number.isFinite(val) || val <= 0) {
                            onToast('error', 'Montant invalide', 'Saisissez un total TTC supérieur à 0.');
                            return;
                          }
                          try {
                            await api.vendorProposeQuote(orderId, val);
                            onToast('success', 'Proposition commerciale envoyée', 'Le client peut désormais régler ce devis.');
                            loadDashboard();
                          } catch (err) {
                            onToast('error', 'Envoi du devis impossible', err instanceof Error ? err.message : undefined);
                          }
                        }}
                        className="rounded-[var(--sim-radius-sm)] bg-[var(--sim-accent-500)] px-3 py-1.5 font-semibold text-white whitespace-nowrap hover:bg-[var(--sim-accent-600)]"
                      >
                        Proposer ce tarif
                      </button>
                    </div>
                  )}

                  {paymentMode === 'bank_transfer' && paymentStatus === 'pending' && (
                    <div className="flex flex-wrap items-center gap-2 rounded-[var(--sim-radius-md)] border border-[var(--sim-border-strong)] bg-[var(--sim-bg-subtle)] p-3 text-xs">
                      <Landmark className="w-4 h-4 text-[var(--sim-accent-600)] shrink-0" />
                      <input
                        type="text"
                        value={bankRefInputs[orderId] ?? bankTransferRef}
                        onChange={(e) => setBankRefInputs((b) => ({ ...b, [orderId]: e.target.value }))}
                        placeholder="Référence virement reçu (ex. VIR-2026-041)"
                        className="sim-input flex-1 min-w-[200px] py-1.5 text-xs font-mono"
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await api.vendorConfirmBankTransfer(orderId, bankRefInputs[orderId] ?? bankTransferRef);
                            onToast('success', 'Virement confirmé', 'La commande passe en préparation et le stock a été réservé.');
                            loadDashboard();
                            onCatalogRefresh();
                          } catch (err) {
                            onToast('error', 'Confirmation impossible', err instanceof Error ? err.message : undefined);
                          }
                        }}
                        className="rounded-[var(--sim-radius-sm)] bg-[var(--sim-accent-500)] px-3 py-1.5 font-semibold text-white whitespace-nowrap hover:bg-[var(--sim-accent-600)]"
                      >
                        Confirmer virement reçu
                      </button>
                    </div>
                  )}

                  {paymentMode === 'deposit' && paymentStatus === 'paid' && balanceDue > 0 && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--sim-radius-md)] border border-[var(--sim-warning-text)]/30 bg-[var(--sim-warning-bg)] p-3 text-xs">
                      <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--sim-warning-text)]">
                        <Banknote className="w-4 h-4 shrink-0" />
                        Solde à encaisser à la livraison :{' '}
                        <strong className="font-mono-nums">{formatCurrency(balanceDue, settings.currency)}</strong>
                      </span>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await api.vendorConfirmBalance(orderId);
                            onToast('success', 'Solde marqué encaissé', 'La commande est entièrement réglée.');
                            loadDashboard();
                          } catch (err) {
                            onToast('error', 'Erreur', err instanceof Error ? err.message : undefined);
                          }
                        }}
                        className="rounded-[var(--sim-radius-sm)] bg-[var(--sim-warning-text)] px-3 py-1.5 font-semibold text-white whitespace-nowrap"
                      >
                        Confirmer encaissement solde livraison
                      </button>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-[var(--sim-border-hairline)]">
                    <input
                      placeholder="Transporteur (ex. DHL, Chronopost, Livreur SIMCOVA)"
                      value={carrierInputs[orderId] ?? String(oi.carrier || '')}
                      onChange={(e) => setCarrierInputs((c) => ({ ...c, [orderId]: e.target.value }))}
                      className="sim-input text-xs py-1.5"
                    />
                    <input
                      placeholder="Numéro de suivi transporteur"
                      value={trackNumInputs[orderId] ?? String(oi.tracking_number || '')}
                      onChange={(e) => setTrackNumInputs((t) => ({ ...t, [orderId]: e.target.value }))}
                      className="sim-input text-xs py-1.5 font-mono"
                    />
                  </div>

                  {paymentStatus === 'pending' && (
                    <p className="text-[11px] font-medium text-[var(--sim-warning-text)]">
                      Règlement client (Jumia Africa ou confirmation de virement) requis avant de lancer la préparation.
                    </p>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    {(
                      [
                        ['en_preparation', 'Passer en préparation'],
                        ['expediee', 'Marquer expédiée'],
                        ['livraison_commencee', 'Livraison commencée'],
                        ['livree', 'Confirmer livraison'],
                      ] as const
                    ).map(([nextSt, label]) => {
                      const isBlocked =
                        paymentStatus !== 'paid' ||
                        ['annulee', 'remboursee', 'expiree'].includes(itemStatus) ||
                        ['refunded', 'expired'].includes(paymentStatus);
                      const isCurrentStage = itemStatus === nextSt;
                      return (
                        <button
                          key={nextSt}
                          type="button"
                          disabled={isBlocked}
                          onClick={async () => {
                            try {
                              await api.updateOrderStatus(orderId, {
                                status: nextSt,
                                carrier: carrierInputs[orderId],
                                trackingNumber: trackNumInputs[orderId],
                              });
                              onToast('success', 'Statut mis à jour', 'L’acheteur a été notifié avec son lien de suivi.');
                              loadDashboard();
                            } catch (err) {
                              onToast('error', 'Erreur', err instanceof Error ? err.message : undefined);
                            }
                          }}
                          className={`inline-flex items-center gap-1 rounded-[var(--sim-radius-sm)] border px-3 py-1.5 text-xs font-semibold transition-colors ${
                            isBlocked
                              ? 'border-[var(--sim-border-hairline)] bg-[var(--sim-bg-subtle)] text-[var(--sim-text-muted)] opacity-55 cursor-not-allowed'
                              : isCurrentStage
                              ? 'border-[var(--sim-accent-500)] bg-[var(--sim-accent-50)] text-[var(--sim-accent-700)]'
                              : 'border-[var(--sim-border-strong)] hover:border-[var(--sim-accent-500)] hover:text-[var(--sim-accent-600)]'
                          }`}
                        >
                          {isCurrentStage && <CheckCircle2 className="w-3.5 h-3.5" />}
                          <span>{label}</span>
                        </button>
                      );
                    })}

                    {canRefund && confirmRefundId !== orderId && (
                      <button
                        type="button"
                        onClick={() => setConfirmRefundId(orderId)}
                        className="inline-flex items-center gap-1 rounded-[var(--sim-radius-sm)] border border-red-300 bg-[var(--sim-error-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--sim-error-text)] hover:opacity-90"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Annuler &amp; Rembourser</span>
                      </button>
                    )}
                  </div>

                  {canRefund && confirmRefundId === orderId && (
                    <div className="flex flex-wrap items-center gap-2 rounded-[var(--sim-radius-md)] bg-[var(--sim-error-bg)] p-3 text-xs">
                      <input
                        type="text"
                        placeholder="Motif d’annulation / remboursement (facultatif)..."
                        value={refundReasonInputs[orderId] || ''}
                        onChange={(e) => setRefundReasonInputs((r) => ({ ...r, [orderId]: e.target.value }))}
                        className="sim-input flex-1 min-w-[200px] text-xs py-1.5"
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await api.vendorRefundOrder(orderId, refundReasonInputs[orderId]);
                            setConfirmRefundId(null);
                            onToast('success', 'Commande annulée et remboursée', 'L’acheteur a reçu le remboursement Jumia Africa.');
                            loadDashboard();
                            onCatalogRefresh();
                          } catch (err) {
                            onToast('error', 'Remboursement impossible', err instanceof Error ? err.message : undefined);
                          }
                        }}
                        className="rounded-[var(--sim-radius-sm)] bg-[var(--sim-error-text)] px-3 py-1.5 font-semibold text-white whitespace-nowrap"
                      >
                        Confirmer le remboursement
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmRefundId(null)}
                        className="rounded-[var(--sim-radius-sm)] border border-[var(--sim-border-strong)] bg-[var(--sim-bg-surface)] px-3 py-1.5 font-semibold text-[var(--sim-text-primary)]"
                      >
                        Annuler
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* 4. Messagerie Vendeur (EXF-602) */}
      {tab === 'messages' && (
        <div className="space-y-4">
          <h2 className="font-display text-xl font-bold text-[var(--sim-text-primary)]">
            Boîte de messagerie clients
          </h2>
          <div className="flex items-start gap-2.5 rounded-[var(--sim-radius-md)] border border-[var(--sim-border-strong)] bg-[var(--sim-bg-subtle)] p-3 text-xs text-[var(--sim-text-secondary)]">
            <ShieldCheck className="w-4 h-4 text-[var(--sim-accent-600)] shrink-0 mt-0.5" />
            <span>
              <strong>Canal officiel obligatoire :</strong> tous les échanges commerciaux, négociations et devis s’effectuent exclusivement sur SIMCOVA. La transmission de numéros directs, courriels personnels ou liens externes est automatiquement bloquée.
            </span>
          </div>
          {threadsMap.size === 0 ? (
            <p className="text-sm text-[var(--sim-text-secondary)]">Aucun message reçu pour le moment.</p>
          ) : (
            Array.from(threadsMap.entries()).map(([threadId, msgs]) => {
              const first = msgs[0];
              return (
                <div
                  key={threadId}
                  className="rounded-[var(--sim-radius-lg)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-5 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-bold text-[var(--sim-text-primary)]">
                        {first.buyerName} ({first.buyerEmail})
                      </p>
                      {first.productTitle && (
                        <p className="text-xs text-[var(--sim-text-muted)]">Sujet : {first.productTitle}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        await api.vendorReportThread(threadId);
                        onToast('info', 'Conversation signalée à la modération');
                      }}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--sim-error-text)]"
                    >
                      <Flag className="w-3.5 h-3.5" />
                      <span>Signaler</span>
                    </button>
                  </div>

                  <div className="space-y-2">
                    {msgs.map((m) => (
                      <div
                        key={m.id}
                        className={`rounded p-3 text-xs ${
                          m.senderRole === 'buyer' ? 'bg-[var(--sim-bg-subtle)]' : 'bg-[var(--sim-accent-50)]'
                        }`}
                      >
                        <span className="font-semibold">
                          {m.senderRole === 'buyer' ? m.buyerName : 'Vous'} :{' '}
                        </span>
                        <span>{m.body}</span>
                      </div>
                    ))}
                  </div>

                  <div className="flex gap-2">
                    <input
                      value={msgReplies[threadId] || ''}
                      onChange={(e) => setMsgReplies((r) => ({ ...r, [threadId]: e.target.value }))}
                      placeholder="Répondre via SIMCOVA (sans numéro ni courriel externe)..."
                      className="flex-1 rounded-[var(--sim-radius-sm)] border border-[var(--sim-border-strong)] px-3 py-2 text-xs"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        if (!msgReplies[threadId]?.trim()) return;
                        try {
                          await api.vendorReplyMessage(threadId, msgReplies[threadId]);
                          setMsgReplies((r) => ({ ...r, [threadId]: '' }));
                          loadDashboard();
                          onToast('success', 'Réponse envoyée au client');
                        } catch (err) {
                          onToast('error', 'Message bloqué', err instanceof Error ? err.message : undefined);
                        }
                      }}
                      className="inline-flex items-center gap-1.5 rounded-[var(--sim-radius-sm)] bg-[var(--sim-accent-500)] px-3.5 py-2 text-xs font-semibold text-white"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Répondre</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* 5. Avis clients & Réponse unique (EXF-604 / EXF-606) */}
      {tab === 'reviews' && (
        <div className="space-y-4">
          <h2 className="font-display text-xl font-bold text-[var(--sim-text-primary)]">
            Avis clients sur vos produits
          </h2>
          {reviews.length === 0 ? (
            <p className="text-sm text-[var(--sim-text-secondary)]">Aucun avis reçu pour l’instant.</p>
          ) : (
            reviews.map((rev) => (
              <div
                key={rev.id}
                className="rounded-[var(--sim-radius-lg)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-5 space-y-3"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-[var(--sim-text-primary)]">
                    {rev.buyerName} · {rev.productTitle} · {rev.rating}/5
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      await api.vendorReportReview(rev.id);
                      loadDashboard();
                      onToast('info', 'Avis signalé à l’administrateur');
                    }}
                    className="inline-flex items-center gap-1 font-semibold text-[var(--sim-error-text)]"
                  >
                    <Flag className="w-3.5 h-3.5" />
                    <span>Signaler abus</span>
                  </button>
                </div>
                <p className="text-sm text-[var(--sim-text-secondary)]">{rev.comment}</p>
                {rev.vendorReply ? (
                  <p className="rounded bg-[var(--sim-bg-subtle)] p-3 text-xs">
                    <strong>Votre réponse publique :</strong> {rev.vendorReply}
                  </p>
                ) : (
                  <div className="flex gap-2">
                    <input
                      value={revReplies[rev.id] || ''}
                      onChange={(e) => setRevReplies((r) => ({ ...r, [rev.id]: e.target.value }))}
                      placeholder="Publier une réponse publique (1 seule réponse autorisée)..."
                      className="sim-input flex-1 text-xs py-1.5"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        if (!revReplies[rev.id]?.trim()) return;
                        await api.vendorReplyReview(rev.id, revReplies[rev.id]);
                        loadDashboard();
                        onToast('success', 'Réponse publiée');
                      }}
                      className="sim-btn-primary py-1.5 px-3.5"
                    >
                      Répondre
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* 6. Profil de Boutique & Pièces justificatives chiffrées KYC */}
      {tab === 'shop' && (
        <div className="space-y-4">
          {user?.status === 'en_attente' && (
            <div className="rounded-[var(--sim-radius-md)] border border-[var(--sim-accent-500)]/30 bg-[var(--sim-accent-50)] px-4 py-3 text-xs text-[var(--sim-accent-700)]">
              <strong>Étapes d’activation boutique :</strong> 1. Complétez votre profil et votre RIB/IBAN ci-dessous · 2. Déposez vos pièces justificatives chiffrées à droite pour obtenir la validation et la certification administrateur.
            </div>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-6 rounded-[var(--sim-radius-xl)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-6 space-y-4">
            <h2 className="font-display text-lg font-bold text-[var(--sim-text-primary)]">
              Profil public du concessionnaire
            </h2>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const hasAnyBank = Boolean(
                  shopForm.bankName.trim() || shopForm.accountHolder.trim() || shopForm.iban.trim()
                );
                if (hasAnyBank && (!shopForm.bankName.trim() || !shopForm.accountHolder.trim() || !shopForm.iban.trim())) {
                  onToast(
                    'error',
                    'Coordonnées bancaires incomplètes',
                    'Indiquez la banque, le titulaire et l’IBAN / RIB complet.'
                  );
                  return;
                }
                try {
                  await api.updateShop({
                    name: shopForm.name,
                    description: shopForm.description,
                    city: shopForm.city,
                    contactPhone: shopForm.contactPhone,
                    logoUrl: shopForm.logoUrl.trim() || null,
                    defaultDeliveryFee: Number(shopForm.defaultDeliveryFee),
                    defaultDeliveryDelay: shopForm.defaultDeliveryDelay,
                    bankDetails: hasAnyBank
                      ? {
                          bankName: shopForm.bankName.trim(),
                          accountHolder: shopForm.accountHolder.trim(),
                          iban: shopForm.iban.trim(),
                          swiftBic: shopForm.swiftBic.trim() || undefined,
                          instructions: shopForm.bankInstructions.trim() || undefined,
                        }
                      : null,
                  });
                  loadDashboard();
                  onCatalogRefresh();
                  onToast('success', 'Profil concessionnaire et RIB enregistrés');
                } catch (err) {
                  onToast('error', 'Erreur d’enregistrement', err instanceof Error ? err.message : undefined);
                }
              }}
              className="space-y-3"
            >
              <div>
                <label className="sim-label">Logo / Emblème de la boutique</label>
                <div className="flex flex-wrap items-center gap-3">
                  {shopForm.logoUrl ? (
                    <img
                      src={shopForm.logoUrl}
                      alt={shopForm.name || 'Logo'}
                      className="h-12 w-12 rounded-[var(--sim-radius-md)] object-cover border border-[var(--sim-border-hairline)]"
                    />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-[var(--sim-radius-md)] bg-[var(--sim-steel-950)] font-display text-sm font-bold uppercase text-[var(--sim-accent-400)]">
                      {(shopForm.name || 'SC').slice(0, 2)}
                    </div>
                  )}
                  <label className="inline-flex items-center gap-1.5 rounded-[var(--sim-radius-md)] border border-[var(--sim-border-strong)] px-3 py-1.5 text-xs font-semibold cursor-pointer hover:border-[var(--sim-accent-500)]">
                    <Upload className="w-3.5 h-3.5" />
                    <span>Importer logo</span>
                    <input type="file" accept="image/*" onChange={handleUploadShopLogo} className="sr-only" />
                  </label>
                  <input
                    value={shopForm.logoUrl}
                    onChange={(e) => setShopForm((s) => ({ ...s, logoUrl: e.target.value }))}
                    placeholder="Ou URL image logo"
                    className="sim-input flex-1 min-w-[160px] text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="sim-label">Nom de la boutique</label>
                <input
                  value={shopForm.name}
                  onChange={(e) => setShopForm((s) => ({ ...s, name: e.target.value }))}
                  placeholder="Nom de la boutique"
                  className="sim-input"
                />
              </div>
              <div>
                <label className="sim-label">Description publique</label>
                <textarea
                  rows={3}
                  value={shopForm.description}
                  onChange={(e) => setShopForm((s) => ({ ...s, description: e.target.value }))}
                  placeholder="Description publique"
                  className="sim-input"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="sim-label">Ville</label>
                  <input
                    value={shopForm.city}
                    onChange={(e) => setShopForm((s) => ({ ...s, city: e.target.value }))}
                    placeholder="Ville"
                    className="sim-input"
                  />
                </div>
                <div>
                  <label className="sim-label">Téléphone</label>
                  <input
                    value={shopForm.contactPhone}
                    onChange={(e) => setShopForm((s) => ({ ...s, contactPhone: e.target.value }))}
                    placeholder="Téléphone"
                    className="sim-input"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="sim-label">Frais de livraison par défaut ({settings.currency})</label>
                  <input
                    type="number"
                    min={0}
                    value={shopForm.defaultDeliveryFee}
                    onChange={(e) => setShopForm((s) => ({ ...s, defaultDeliveryFee: e.target.value }))}
                    className="sim-input font-mono-nums"
                  />
                </div>
                <div>
                  <label className="sim-label">Délai standard</label>
                  <input
                    value={shopForm.defaultDeliveryDelay}
                    onChange={(e) => setShopForm((s) => ({ ...s, defaultDeliveryDelay: e.target.value }))}
                    placeholder="Ex. 24 à 72h"
                    className="sim-input"
                  />
                </div>
              </div>
              <div className="space-y-3 rounded-[var(--sim-radius-md)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-subtle)] p-4">
                <div className="flex items-center gap-2">
                  <Landmark className="w-4 h-4 text-[var(--sim-accent-600)]" />
                  <p className="text-xs font-bold text-[var(--sim-text-primary)]">
                    Coordonnées bancaires (Virements montants importants ≥{' '}
                    {formatCurrency(settings.bankTransferThreshold, settings.currency)})
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="sim-label">Établissement bancaire</label>
                    <input
                      value={shopForm.bankName}
                      onChange={(e) => setShopForm((s) => ({ ...s, bankName: e.target.value }))}
                      placeholder="Ex. NSIA Banque Côte d’Ivoire"
                      className="sim-input text-xs"
                    />
                  </div>
                  <div>
                    <label className="sim-label">Titulaire du compte</label>
                    <input
                      value={shopForm.accountHolder}
                      onChange={(e) => setShopForm((s) => ({ ...s, accountHolder: e.target.value }))}
                      placeholder="Ex. Atelier Lagune SARL"
                      className="sim-input text-xs"
                    />
                  </div>
                  <div>
                    <label className="sim-label">RIB / IBAN</label>
                    <input
                      value={shopForm.iban}
                      onChange={(e) => setShopForm((s) => ({ ...s, iban: e.target.value }))}
                      placeholder="CI93 CI00 8011 1100 2233 4455 66"
                      className="sim-input text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="sim-label">Code SWIFT / BIC</label>
                    <input
                      value={shopForm.swiftBic}
                      onChange={(e) => setShopForm((s) => ({ ...s, swiftBic: e.target.value }))}
                      placeholder="NSIACIAB"
                      className="sim-input text-xs font-mono"
                    />
                  </div>
                </div>
                <div>
                  <label className="sim-label">Instructions de virement (optionnel)</label>
                  <input
                    value={shopForm.bankInstructions}
                    onChange={(e) => setShopForm((s) => ({ ...s, bankInstructions: e.target.value }))}
                    placeholder="Ex. Rappeler la référence de commande SIMCOVA en motif de virement"
                    className="sim-input text-xs"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="sim-btn-primary"
              >
                Enregistrer la boutique
              </button>
            </form>
          </div>

          <div className="lg:col-span-6 rounded-[var(--sim-radius-xl)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-[var(--sim-accent-500)]" />
              <h2 className="font-display text-lg font-bold text-[var(--sim-text-primary)]">
                Pièces justificatives &amp; Certification
              </h2>
            </div>
            <p className="text-xs text-[var(--sim-text-secondary)]">
              Documents demandés selon la règle RG-03 :{' '}
              <strong>
                {((rules['RG-03']?.valueJson?.requiredDocs as string[]) ?? ['Pièce d’identité officielle']).join(', ')}
              </strong>
              . Vos fichiers sont chiffrés au repos (AES-256-GCM) et accessibles uniquement à l’administrateur.
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <select
                value={kycType}
                onChange={(e) => setKycType(e.target.value)}
                className="rounded-[var(--sim-radius-sm)] border border-[var(--sim-border-strong)] px-3 py-2 text-xs"
              >
                {availableKycDocs.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <label className="inline-flex items-center gap-2 rounded-[var(--sim-radius-md)] bg-[var(--sim-text-primary)] px-4 py-2 text-xs font-semibold text-white cursor-pointer">
                <Upload className="w-3.5 h-3.5" />
                <span>Déposer une pièce chiffrée</span>
                <input type="file" onChange={handleKycUpload} className="sr-only" />
              </label>
            </div>

            <div className="space-y-2 pt-2">
              {kycDocs.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between rounded border border-[var(--sim-border-hairline)] px-3 py-2 text-xs"
                >
                  <div>
                    <p className="font-semibold text-[var(--sim-text-primary)]">
                      {doc.docType} · {doc.fileName}
                    </p>
                    <p className="text-[var(--sim-text-muted)]">
                      Déposé le {new Date(doc.uploadedAt).toLocaleString('fr-FR')}
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1 font-semibold text-[var(--sim-accent-600)]">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {doc.reviewStatus}
                  </span>
                </div>
              ))}
            </div>
          </div>
          </div>
        </div>
      )}
    </div>
  );
};

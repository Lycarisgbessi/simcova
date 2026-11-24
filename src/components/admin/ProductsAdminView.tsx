import React, { useCallback, useEffect, useState } from 'react';
import { Archive, Package, RefreshCw, Search } from 'lucide-react';
import { api } from '../../lib/api';
import { formatCurrency } from '../../shared/rulesEngine';
import type { AdminProductRow } from '../../shared/adminTypes';

interface ProductsAdminViewProps {
  currency: string;
  onToast: (type: 'success' | 'error' | 'info', title: string, description?: string) => void;
}

const STATUS_OPTIONS = [
  { id: '', label: 'Tous les statuts' },
  { id: 'publie', label: 'Publiés' },
  { id: 'brouillon', label: 'Brouillons' },
  { id: 'archive', label: 'Archivés' },
];

export const ProductsAdminView: React.FC<ProductsAdminViewProps> = ({ currency, onToast }) => {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [products, setProducts] = useState<AdminProductRow[]>([]);
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.adminProducts({ status: status || undefined, q: q.trim() || undefined });
      setProducts(res.products);
    } catch (err) {
      onToast('error', 'Erreur catalogue', err instanceof Error ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  }, [status, q, onToast]);

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  const handleArchive = async (id: string, title: string) => {
    try {
      await api.adminArchiveProduct(id);
      onToast('success', 'Produit dépublié', `« ${title} » est retiré de la vente.`);
      setConfirmArchiveId(null);
      load();
    } catch (err) {
      onToast('error', 'Dépublication impossible', err instanceof Error ? err.message : undefined);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-64">
          <label className="sim-label">Rechercher (titre, vendeur, boutique, rayon)</label>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--sim-text-muted)]" />
            <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tracteur, AgriForce…" className="sim-input pl-9" />
          </div>
        </div>
        <div>
          <label className="sim-label">Statut</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="sim-input">
            {STATUS_OPTIONS.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>
        <button type="button" onClick={load} className="sim-btn-secondary py-2 px-3">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="rounded-[var(--sim-radius-lg)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-[var(--sim-bg-subtle)] text-[var(--sim-text-muted)]">
            <tr>
              <th className="px-3 py-3 font-semibold">Produit</th>
              <th className="px-3 py-3 font-semibold">Vendeur / Boutique</th>
              <th className="px-3 py-3 font-semibold">Rayon</th>
              <th className="px-3 py-3 font-semibold text-right">Prix</th>
              <th className="px-3 py-3 font-semibold text-right">Stock</th>
              <th className="px-3 py-3 font-semibold text-right">Vues</th>
              <th className="px-3 py-3 font-semibold text-right">Note</th>
              <th className="px-3 py-3 font-semibold">Statut</th>
              <th className="px-3 py-3 font-semibold">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--sim-border-hairline)]">
            {products.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-sm text-[var(--sim-text-secondary)]">
                  Aucun produit ne correspond aux filtres.
                </td>
              </tr>
            ) : (
              products.map((p) => (
                <tr key={p.id}>
                  <td className="px-3 py-2.5">
                    <p className="font-semibold text-[var(--sim-text-primary)] max-w-72 truncate" title={p.title}>{p.title}</p>
                    <p className="text-[11px] text-[var(--sim-text-muted)]">{p.condition} · maj {new Date(p.updatedAt).toLocaleDateString('fr-FR')}</p>
                  </td>
                  <td className="px-3 py-2.5 text-[var(--sim-text-secondary)]">
                    <p>{p.shopName || '—'}</p>
                    <p className="text-[11px] text-[var(--sim-text-muted)]">{p.vendorName}</p>
                  </td>
                  <td className="px-3 py-2.5 text-[var(--sim-text-secondary)]">{p.categoryName}</td>
                  <td className="px-3 py-2.5 text-right font-mono-nums font-semibold">{formatCurrency(p.price, currency)}</td>
                  <td className={`px-3 py-2.5 text-right font-mono-nums ${p.stock === 0 ? 'text-[var(--sim-error-text)] font-bold' : ''}`}>{p.stock}</td>
                  <td className="px-3 py-2.5 text-right font-mono-nums text-[var(--sim-text-muted)]">{p.viewCount}</td>
                  <td className="px-3 py-2.5 text-right font-mono-nums">{p.reviewCount > 0 ? `${p.ratingAverage} (${p.reviewCount})` : '—'}</td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                        p.status === 'publie'
                          ? 'bg-[var(--sim-success-bg)] text-[var(--sim-success-text)]'
                          : p.status === 'brouillon'
                          ? 'bg-[var(--sim-warning-bg)] text-[var(--sim-warning-text)]'
                          : 'bg-[var(--sim-bg-muted)] text-[var(--sim-text-muted)]'
                      }`}
                    >
                      {p.status}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    {p.status === 'publie' && confirmArchiveId !== p.id && (
                      <button
                        type="button"
                        onClick={() => setConfirmArchiveId(p.id)}
                        className="inline-flex items-center gap-1 rounded bg-[var(--sim-warning-bg)] px-2.5 py-1 text-[11px] font-semibold text-[var(--sim-warning-text)]"
                      >
                        <Archive className="w-3 h-3" />
                        <span>Dépublier</span>
                      </button>
                    )}
                    {confirmArchiveId === p.id && (
                      <div className="inline-flex items-center gap-1">
                        <button type="button" onClick={() => handleArchive(p.id, p.title)} className="rounded bg-[var(--sim-error-text)] px-2 py-1 text-[10px] font-bold text-white">
                          Confirmer
                        </button>
                        <button type="button" onClick={() => setConfirmArchiveId(null)} className="rounded border border-[var(--sim-border-strong)] px-1.5 py-1 text-[10px] font-semibold">
                          Annuler
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-[var(--sim-text-muted)] flex items-center gap-1.5">
        <Package className="w-3 h-3" /> {products.length} fiche(s) — le compteur de vues est anonyme (incrémenté à chaque ouverture de fiche produit côté acheteur).
      </p>
    </div>
  );
};

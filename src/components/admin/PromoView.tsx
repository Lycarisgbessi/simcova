import React, { useCallback, useEffect, useState } from 'react';
import { Plus, RefreshCw, Tag, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { formatCurrency } from '../../shared/rulesEngine';
import type { AdminPromoRow } from '../../shared/adminTypes';

interface PromoViewProps {
  currency: string;
  onToast: (type: 'success' | 'error' | 'info', title: string, description?: string) => void;
}

export const PromoView: React.FC<PromoViewProps> = ({ currency, onToast }) => {
  const [promos, setPromos] = useState<AdminPromoRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ code: '', discountType: 'percent' as 'percent' | 'fixed', discountValue: '', minOrderAmount: '', maxUses: '', expiresAt: '' });
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPromos((await api.adminPromos()).promos);
    } catch (err) {
      onToast('error', 'Erreur codes promo', err instanceof Error ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      await api.adminCreatePromo({
        code: form.code.trim().toUpperCase(),
        discountType: form.discountType,
        discountValue: Number(form.discountValue),
        minOrderAmount: form.minOrderAmount.trim() ? Number(form.minOrderAmount) : undefined,
        maxUses: form.maxUses.trim() ? Number(form.maxUses) : null,
        expiresAt: form.expiresAt || null,
      });
      onToast('success', 'Code promo créé', `${form.code.trim().toUpperCase()} est actif.`);
      setForm({ code: '', discountType: 'percent', discountValue: '', minOrderAmount: '', maxUses: '', expiresAt: '' });
      load();
    } catch (err) {
      onToast('error', 'Création impossible', err instanceof Error ? err.message : undefined);
    } finally {
      setCreating(false);
    }
  };

  const toggle = async (code: string, active: boolean) => {
    try {
      await api.adminTogglePromo(code, !active);
      load();
    } catch (err) {
      onToast('error', 'Action impossible', err instanceof Error ? err.message : undefined);
    }
  };

  const remove = async (code: string) => {
    try {
      await api.adminDeletePromo(code);
      onToast('success', 'Code supprimé', code);
      setConfirmDelete(null);
      load();
    } catch (err) {
      onToast('error', 'Suppression impossible', err instanceof Error ? err.message : undefined);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-bold text-[var(--sim-text-primary)]">Codes promotionnels</h2>
        <button type="button" onClick={load} className="sim-btn-secondary py-1.5 px-3">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Actualiser</span>
        </button>
      </div>

      <form onSubmit={create} className="rounded-[var(--sim-radius-lg)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-4 space-y-3">
        <p className="font-display text-sm font-bold flex items-center gap-2 text-[var(--sim-text-primary)]">
          <Plus className="w-4 h-4 text-[var(--sim-accent-500)]" /> Créer un code
        </p>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <div>
            <label className="sim-label">Code</label>
            <input type="text" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} required minLength={3} placeholder="ARRIVAGE10" className="sim-input font-mono" />
          </div>
          <div>
            <label className="sim-label">Type</label>
            <select value={form.discountType} onChange={(e) => setForm((f) => ({ ...f, discountType: e.target.value as 'percent' | 'fixed' }))} className="sim-input">
              <option value="percent">Pourcentage (%)</option>
              <option value="fixed">Montant fixe ({currency})</option>
            </select>
          </div>
          <div>
            <label className="sim-label">{form.discountType === 'percent' ? 'Remise (%)' : `Remise (${currency})`}</label>
            <input type="number" min={1} max={form.discountType === 'percent' ? 100 : undefined} value={form.discountValue} onChange={(e) => setForm((f) => ({ ...f, discountValue: e.target.value }))} required className="sim-input font-mono-nums" />
          </div>
          <div>
            <label className="sim-label">Montant min. ({currency})</label>
            <input type="number" min={0} value={form.minOrderAmount} onChange={(e) => setForm((f) => ({ ...f, minOrderAmount: e.target.value }))} placeholder="0" className="sim-input font-mono-nums" />
          </div>
          <div>
            <label className="sim-label">Utilisations max</label>
            <input type="number" min={1} value={form.maxUses} onChange={(e) => setForm((f) => ({ ...f, maxUses: e.target.value }))} placeholder="illimité" className="sim-input font-mono-nums" />
          </div>
          <div>
            <label className="sim-label">Expire le</label>
            <input type="date" value={form.expiresAt} onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))} className="sim-input" />
          </div>
        </div>
        <button type="submit" disabled={creating} className="sim-btn-primary py-2 px-5 text-xs">
          {creating ? 'Création…' : 'Créer le code'}
        </button>
      </form>

      <div className="rounded-[var(--sim-radius-lg)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-[var(--sim-bg-subtle)] text-[var(--sim-text-muted)]">
            <tr>
              <th className="px-3 py-3 font-semibold">Code</th>
              <th className="px-3 py-3 font-semibold">Remise</th>
              <th className="px-3 py-3 font-semibold">Minimum</th>
              <th className="px-3 py-3 font-semibold text-right">Utilisations</th>
              <th className="px-3 py-3 font-semibold">Expiration</th>
              <th className="px-3 py-3 font-semibold">Statut</th>
              <th className="px-3 py-3 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--sim-border-hairline)]">
            {promos.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-[var(--sim-text-secondary)]">
                  Aucun code promo — créez-en un pour lancer une opération commerciale.
                </td>
              </tr>
            ) : (
              promos.map((p) => (
                <tr key={p.code} className={p.active ? '' : 'opacity-60'}>
                  <td className="px-3 py-2.5 font-mono font-bold text-[var(--sim-text-primary)]">
                    <span className="inline-flex items-center gap-1.5">
                      <Tag className="w-3.5 h-3.5 text-[var(--sim-accent-500)]" />
                      {p.code}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 font-mono-nums font-semibold">
                    {p.discountType === 'percent' ? `-${p.discountValue} %` : `-${formatCurrency(p.discountValue, currency)}`}
                  </td>
                  <td className="px-3 py-2.5 font-mono-nums text-[var(--sim-text-secondary)]">
                    {p.minOrderAmount > 0 ? formatCurrency(p.minOrderAmount, currency) : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono-nums">
                    {p.usedCount}{p.maxUses !== null ? ` / ${p.maxUses}` : ''}
                  </td>
                  <td className="px-3 py-2.5 text-[11px] text-[var(--sim-text-muted)]">
                    {p.expiresAt ? new Date(p.expiresAt).toLocaleDateString('fr-FR') : 'sans expiration'}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${p.active ? 'bg-[var(--sim-success-bg)] text-[var(--sim-success-text)]' : 'bg-[var(--sim-bg-muted)] text-[var(--sim-text-muted)]'}`}>
                      {p.active ? 'actif' : 'désactivé'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="inline-flex items-center gap-1.5">
                      <button type="button" onClick={() => toggle(p.code, p.active)} className="rounded border border-[var(--sim-border-strong)] px-2 py-1 text-[10px] font-semibold">
                        {p.active ? 'Désactiver' : 'Activer'}
                      </button>
                      {confirmDelete !== p.code ? (
                        <button type="button" onClick={() => setConfirmDelete(p.code)} className="rounded bg-[var(--sim-error-bg)] px-2 py-1 text-[10px] font-semibold text-[var(--sim-error-text)] inline-flex items-center gap-1">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      ) : (
                        <>
                          <button type="button" onClick={() => remove(p.code)} className="rounded bg-[var(--sim-error-text)] px-2 py-1 text-[10px] font-bold text-white">Confirmer</button>
                          <button type="button" onClick={() => setConfirmDelete(null)} className="rounded border border-[var(--sim-border-strong)] px-1.5 py-1 text-[10px] font-semibold">Non</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-[var(--sim-text-muted)]">
        La remise s’applique sur le TTC (plafonnée au montant de la commande), validée côté serveur à la création de commande. La commission plateforme reste calculée sur le sous-total produits avant remise.
      </p>
    </div>
  );
};

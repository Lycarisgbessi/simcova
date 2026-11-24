import React, { useEffect, useState } from 'react';
import { ShieldCheck, Store, LogOut } from 'lucide-react';
import { api, getAuthToken, setAuthToken } from '../lib/api';
import type { Category, PlatformRule, PlatformSettings, RuleId, Shop, UserAccount } from '../shared/types';
import { ProAuthPanel } from './ProAuthPanel';
import { VendorWorkspace } from './VendorWorkspace';
import { AdminConsole } from './AdminConsole';

interface ProPortalViewProps {
  categories: Category[];
  rules: Record<RuleId, PlatformRule>;
  settings: PlatformSettings;
  adminNeedsClaim: boolean;
  initialResetToken?: string | null;
  onConsumeResetToken?: () => void;
  onRefreshBootstrap: () => void;
  onToast: (type: 'success' | 'error' | 'info', title: string, description?: string) => void;
}

export const ProPortalView: React.FC<ProPortalViewProps> = ({
  categories,
  rules,
  settings,
  adminNeedsClaim,
  initialResetToken,
  onConsumeResetToken,
  onRefreshBootstrap,
  onToast,
}) => {
  const [user, setUser] = useState<UserAccount | null>(null);
  const [shop, setShop] = useState<Shop | null>(null);
  const [checking, setChecking] = useState(() => Boolean(getAuthToken()));
  const [adminMode, setAdminMode] = useState<'admin' | 'vendor'>('admin');

  useEffect(() => {
    const token = getAuthToken();
    if (!token) {
      setChecking(false);
      return;
    }
    api
      .me()
      .then((res) => {
        setUser(res.user);
        setShop(res.shop);
      })
      .catch(() => {
        setAuthToken(null);
      })
      .finally(() => setChecking(false));
  }, []);

  const handleLogout = () => {
    setAuthToken(null);
    setUser(null);
    setShop(null);
    onToast('info', 'Session fermée', 'Vous êtes déconnecté de l’Espace Pro.');
  };

  if (checking) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="h-48 rounded-[var(--sim-radius-xl)] sim-skeleton" />
      </div>
    );
  }

  if (!user) {
    return (
      <ProAuthPanel
        rules={rules}
        adminNeedsClaim={adminNeedsClaim}
        initialResetToken={initialResetToken}
        onConsumeResetToken={onConsumeResetToken}
        onAuthenticated={(u, s) => {
          setUser(u);
          setShop(s);
          setAdminMode(u.role === 'admin' ? 'admin' : 'vendor');
        }}
        onAdminClaimed={onRefreshBootstrap}
        onToast={onToast}
      />
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 pb-24 sm:px-6 lg:px-8 space-y-6">
      {/* Barre supérieure RBAC : distinction stricte Administration Générale vs Espace Vendeur */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-[var(--sim-radius-xl)] border border-[var(--sim-steel-800)] bg-[var(--sim-steel-950)] px-5 py-4 text-white shadow-[var(--sim-shadow-2)]">
        <div>
          <p className="font-mono-nums text-xs font-medium text-[var(--sim-accent-400)]">
            {user.role === 'admin'
              ? 'Administrateur Général & Vendeur Direct'
              : `Compte Vendeur · ${shop?.name || 'Boutique'}`}
          </p>
          <h1 className="mt-0.5 font-display text-2xl font-bold tracking-tight text-white">
            {user.fullName}{' '}
            <span className="font-mono-nums text-xs font-normal text-slate-400">({user.email})</span>
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {user.role === 'admin' && (
            <div className="inline-flex rounded-[var(--sim-radius-md)] border border-[var(--sim-steel-800)] bg-[var(--sim-steel-900)] p-1">
              <button
                type="button"
                onClick={() => setAdminMode('admin')}
                className={`inline-flex items-center gap-1.5 rounded-[var(--sim-radius-sm)] px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  adminMode === 'admin'
                    ? 'bg-white text-[var(--sim-steel-950)] shadow-sm'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Administration générale</span>
              </button>
              <button
                type="button"
                onClick={() => setAdminMode('vendor')}
                className={`inline-flex items-center gap-1.5 rounded-[var(--sim-radius-sm)] px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  adminMode === 'vendor'
                    ? 'bg-[var(--sim-accent-500)] text-white shadow-sm'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <Store className="w-3.5 h-3.5" />
                <span>Mon Espace Vendeur SIMCOVA</span>
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-1.5 rounded-[var(--sim-radius-md)] border border-[var(--sim-steel-800)] bg-[var(--sim-steel-900)] px-3.5 py-2 text-xs font-semibold text-slate-200 hover:border-[var(--sim-error-text)] hover:text-red-300 transition-colors whitespace-nowrap shrink-0"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Déconnexion</span>
          </button>
        </div>
      </div>

      {user.role === 'admin' && adminMode === 'admin' ? (
        <AdminConsole
          categories={categories}
          rules={rules}
          settings={settings}
          onRefreshBootstrap={onRefreshBootstrap}
          onToast={onToast}
        />
      ) : (
        <VendorWorkspace
          categories={categories}
          rules={rules}
          settings={settings}
          onCatalogRefresh={onRefreshBootstrap}
          onToast={onToast}
        />
      )}
    </div>
  );
};

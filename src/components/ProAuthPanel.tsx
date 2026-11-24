import React, { useEffect, useState } from 'react';
import { ShieldCheck, KeyRound, UserPlus, CheckCircle2, MailCheck, Check } from 'lucide-react';
import { api, setAuthToken } from '../lib/api';
import type { PlatformRule, RuleId, Shop, UserAccount } from '../shared/types';

interface ProAuthPanelProps {
  rules: Record<RuleId, PlatformRule>;
  adminNeedsClaim: boolean;
  initialResetToken?: string | null;
  onConsumeResetToken?: () => void;
  onAuthenticated: (user: UserAccount, shop: Shop | null) => void;
  onAdminClaimed: () => void;
  onToast: (type: 'success' | 'error' | 'info', title: string, description?: string) => void;
}

type RegistrationFieldKey =
  | 'fullName'
  | 'email'
  | 'password'
  | 'shopName'
  | 'phone'
  | 'city'
  | 'shopDescription';

const OPTIONAL_FIELD_LABELS: Record<RegistrationFieldKey, { label: string; placeholder: string; type?: string }> = {
  fullName: { label: 'Nom complet', placeholder: 'Ex. Moussa Traoré' },
  email: { label: 'Adresse électronique', placeholder: 'contact@entreprise.com', type: 'email' },
  password: { label: 'Mot de passe', placeholder: '••••••••', type: 'password' },
  shopName: { label: 'Nom du concessionnaire / entreprise', placeholder: 'Ex. Abidjan Engins & BTP' },
  phone: { label: 'Numéro de téléphone', placeholder: '+225 07...', type: 'tel' },
  city: { label: 'Ville / Zone d’activité', placeholder: 'Ex. Abidjan, Dakar, Lomé...' },
  shopDescription: { label: 'Présentation de votre parc matériel', placeholder: 'Décrivez vos gammes de tracteurs, machines, engins ou pièces détachées...' },
};

const PasswordStrengthChecklist: React.FC<{ password: string }> = ({ password }) => {
  const checks = [
    { label: '8+ caractères', ok: password.length >= 8 },
    { label: '1 majuscule', ok: /[A-Z]/.test(password) },
    { label: '1 minuscule', ok: /[a-z]/.test(password) },
    { label: '1 chiffre', ok: /[0-9]/.test(password) },
  ];
  return (
    <div className="mt-2 grid grid-cols-2 gap-1.5 text-[11px]">
      {checks.map((c) => (
        <span
          key={c.label}
          className={`inline-flex items-center gap-1 font-medium ${
            c.ok ? 'text-[var(--sim-success-text)]' : 'text-[var(--sim-text-muted)]'
          }`}
        >
          <Check className={`w-3 h-3 ${c.ok ? 'opacity-100' : 'opacity-30'}`} />
          <span>{c.label}</span>
        </span>
      ))}
    </div>
  );
};

export const ProAuthPanel: React.FC<ProAuthPanelProps> = ({
  rules,
  adminNeedsClaim,
  initialResetToken,
  onConsumeResetToken,
  onAuthenticated,
  onAdminClaimed,
  onToast,
}) => {
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>(() => (initialResetToken ? 'forgot' : 'login'));
  const [loading, setLoading] = useState(false);

  // Login state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Admin first-run bootstrap state
  const [claimPassword, setClaimPassword] = useState('');
  const [claimConfirm, setClaimConfirm] = useState('');

  // Registration state driven dynamically by RG-04
  const [regFields, setRegFields] = useState<{
    fullName: string;
    email: string;
    password: string;
    shopName: string;
    phone: string;
    city: string;
    shopDescription: string;
  }>({
    fullName: '',
    email: '',
    password: '',
    shopName: '',
    phone: '',
    city: '',
    shopDescription: '',
  });
  const [verificationDemo, setVerificationDemo] = useState<{ token: string; user: UserAccount; shop: Shop } | null>(null);

  // Reset password state
  const [forgotEmail, setForgotEmail] = useState('');
  const [demoResetToken, setDemoResetToken] = useState<string | null>(initialResetToken ?? null);
  const [newResetPassword, setNewResetPassword] = useState('');

  useEffect(() => {
    if (initialResetToken) {
      setMode('forgot');
      setDemoResetToken(initialResetToken);
    }
  }, [initialResetToken]);

  const requiredFields = (rules['RG-04']?.valueJson?.requiredFields as string[]) ?? [
    'fullName',
    'email',
    'password',
    'shopName',
  ];

  const handleAdminBootstrap = async (e: React.FormEvent) => {
    e.preventDefault();
    if (claimPassword !== claimConfirm) {
      onToast('error', 'Les mots de passe ne correspondent pas.');
      return;
    }
    setLoading(true);
    try {
      const res = await api.adminBootstrap(claimPassword);
      setAuthToken(res.token);
      onAdminClaimed();
      onAuthenticated(res.user, res.shop);
      onToast('success', 'Compte Administrateur initialisé', 'Bienvenue dans votre poste de pilotage SIMCOVA.');
    } catch (err) {
      onToast('error', 'Initialisation impossible', err instanceof Error ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.login(loginEmail, loginPassword);
      setAuthToken(res.token);
      onAuthenticated(res.user, res.shop);
      onToast('success', `Bienvenue ${res.user.fullName}`);
    } catch (err) {
      onToast('error', 'Connexion refusée', err instanceof Error ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.register(regFields);
      setAuthToken(res.token);
      // verificationToken is only echoed outside production (demo without email delivery)
      setVerificationDemo(res.verificationToken ? { token: res.verificationToken, user: res.user, shop: res.shop } : null);
      onToast('success', 'Compte vendeur créé', 'Confirmez votre courriel pour activer la publication.');
    } catch (err) {
      onToast('error', 'Inscription impossible', err instanceof Error ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmEmailNow = async () => {
    if (!verificationDemo) return;
    setLoading(true);
    try {
      const res = await api.verifyEmail(verificationDemo.token);
      onAuthenticated(res.user, verificationDemo.shop);
      onToast('success', 'Adresse électronique confirmée !');
    } catch (err) {
      onToast('error', 'Erreur', err instanceof Error ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.forgotPassword(forgotEmail);
      if (res.demoResetToken) setDemoResetToken(res.demoResetToken);
      onToast('info', 'Si le compte existe, un lien de réinitialisation a été envoyé.');
    } catch (err) {
      onToast('error', 'Erreur', err instanceof Error ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!demoResetToken) return;
    setLoading(true);
    try {
      await api.resetPassword(demoResetToken, newResetPassword);
      setDemoResetToken(null);
      onConsumeResetToken?.();
      setMode('login');
      onToast('success', 'Mot de passe mis à jour', 'Vous pouvez maintenant vous connecter.');
    } catch (err) {
      onToast('error', 'Erreur', err instanceof Error ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 pb-24 sm:px-6">
      <div className="mb-8">
        <p className="text-xs font-semibold text-[var(--sim-accent-600)]">
          SIMCOVA · Espace Vendeurs &amp; Administration
        </p>
        <h1 className="mt-1 font-display text-3xl font-bold text-[var(--sim-text-primary)]">
          Accéder à votre espace professionnel
        </h1>
        <p className="mt-2 text-sm text-[var(--sim-text-secondary)]">
          Les comptes sont réservés aux vendeurs et à l’administrateur de la place de marché. Les acheteurs commandent sans compte.
        </p>
      </div>

      {/* Formulaire de premier démarrage pour le compte Administrateur (si non encore configuré) */}
      {adminNeedsClaim && (
        <div className="mb-8 rounded-[var(--sim-radius-xl)] border border-[var(--sim-accent-500)] bg-[var(--sim-accent-50)] p-6">
          <div className="flex items-start gap-3">
            <ShieldCheck className="w-6 h-6 shrink-0 text-[var(--sim-accent-600)] mt-0.5" />
            <div className="flex-1">
              <h2 className="font-display text-lg font-bold text-[var(--sim-text-primary)]">
                Premier démarrage : Initialiser le compte Administrateur SIMCOVA
              </h2>
              <p className="mt-1 text-xs text-[var(--sim-text-secondary)] leading-relaxed">
                Définissez le mot de passe du compte administrateur principal (<span className="font-mono">admin@simcova.africa</span>) pour débloquer le tableau de bord d’administration générale et votre propre espace vendeur officiel.
              </p>
              <form onSubmit={handleAdminBootstrap} className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                <input
                  type="password"
                  required
                  placeholder="Mot de passe admin (8+ car., Maj, 123)"
                  value={claimPassword}
                  onChange={(e) => setClaimPassword(e.target.value)}
                  className="rounded-[var(--sim-radius-md)] border border-[var(--sim-border-strong)] bg-[var(--sim-bg-surface)] px-3.5 py-2 text-sm"
                />
                <input
                  type="password"
                  required
                  placeholder="Confirmer le mot de passe"
                  value={claimConfirm}
                  onChange={(e) => setClaimConfirm(e.target.value)}
                  className="rounded-[var(--sim-radius-md)] border border-[var(--sim-border-strong)] bg-[var(--sim-bg-surface)] px-3.5 py-2 text-sm"
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="rounded-[var(--sim-radius-md)] bg-[var(--sim-accent-500)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--sim-accent-600)] disabled:opacity-50"
                >
                  Activer l’administration
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-[var(--sim-radius-xl)] border border-[var(--sim-border-hairline)] bg-[var(--sim-bg-surface)] p-6 sm:p-8 shadow-[var(--sim-shadow-1)]">
        <div className="flex items-center gap-2 border-b border-[var(--sim-border-hairline)] pb-4">
          <button
            type="button"
            onClick={() => setMode('login')}
            className={`inline-flex items-center gap-2 rounded-[var(--sim-radius-md)] px-4 py-2 text-xs font-semibold transition-colors ${
              mode === 'login'
                ? 'bg-[var(--sim-text-primary)] text-white'
                : 'bg-[var(--sim-bg-subtle)] text-[var(--sim-text-secondary)]'
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span>Connexion</span>
          </button>
          <button
            type="button"
            onClick={() => setMode('register')}
            className={`inline-flex items-center gap-2 rounded-[var(--sim-radius-md)] px-4 py-2 text-xs font-semibold transition-colors ${
              mode === 'register'
                ? 'bg-[var(--sim-text-primary)] text-white'
                : 'bg-[var(--sim-bg-subtle)] text-[var(--sim-text-secondary)]'
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Créer un compte vendeur</span>
          </button>
        </div>

        {mode === 'login' && (
          <form onSubmit={handleLogin} className="mt-6 space-y-4 max-w-md">
            <div>
              <label htmlFor="pro-login-email" className="sim-label">
                Courriel professionnel
              </label>
              <input
                id="pro-login-email"
                type="email"
                required
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="admin@simcova.africa ou vendeur@boutique.com"
                className="sim-input"
              />
            </div>
            <div>
              <label htmlFor="pro-login-pass" className="sim-label">
                Mot de passe
              </label>
              <input
                id="pro-login-pass"
                type="password"
                required
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                className="sim-input"
              />
            </div>
            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => setMode('forgot')}
                className="text-xs font-medium text-[var(--sim-text-secondary)] hover:text-[var(--sim-accent-600)] hover:underline"
              >
                Mot de passe oublié ?
              </button>
              <button
                type="submit"
                disabled={loading}
                className="sim-btn-primary px-6 py-2.5"
              >
                {loading ? 'Connexion...' : 'Se connecter'}
              </button>
            </div>
          </form>
        )}

        {mode === 'register' && (
          <div className="mt-6">
            {verificationDemo ? (
              <div className="rounded-[var(--sim-radius-lg)] bg-[var(--sim-success-bg)] p-6 space-y-4">
                <div className="flex items-center gap-2 text-[var(--sim-success-text)]">
                  <MailCheck className="w-6 h-6" />
                  <h2 className="font-display text-lg font-bold">Vérifiez votre adresse électronique</h2>
                </div>
                <p className="text-sm text-[var(--sim-text-primary)]">
                  Un courriel de confirmation à double usage vient d’être envoyé à <strong>{verificationDemo.user.email}</strong>. Cliquez ci-dessous pour activer votre adresse immédiatement et accéder à votre espace vendeur.
                </p>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={handleConfirmEmailNow}
                    className="inline-flex items-center gap-2 rounded-[var(--sim-radius-md)] bg-[var(--sim-success-text)] px-4 py-2.5 text-xs font-semibold text-white"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Confirmer mon courriel et ouvrir mon espace</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onAuthenticated(verificationDemo.user, verificationDemo.shop)}
                    className="sim-btn-secondary py-2.5"
                  >
                    Accéder sans confirmer maintenant
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleRegister} className="space-y-4">
                <p className="text-xs text-[var(--sim-text-secondary)]">
                  Les champs marqués * sont configurés comme obligatoires par la gouvernance SIMCOVA.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {(Object.keys(OPTIONAL_FIELD_LABELS) as RegistrationFieldKey[]).map((fieldKey) => {
                    const meta = OPTIONAL_FIELD_LABELS[fieldKey];
                    const isRequired = requiredFields.includes(fieldKey);
                    return (
                      <div key={fieldKey} className={fieldKey === 'shopDescription' ? 'sm:col-span-2' : ''}>
                        <label htmlFor={`reg-${fieldKey}`} className="sim-label">
                          {meta.label} {isRequired ? '*' : '(facultatif)'}
                        </label>
                        {fieldKey === 'shopDescription' ? (
                          <textarea
                            id={`reg-${fieldKey}`}
                            rows={2}
                            required={isRequired}
                            placeholder={meta.placeholder}
                            value={regFields[fieldKey] || ''}
                            onChange={(e) => setRegFields((f) => ({ ...f, [fieldKey]: e.target.value }))}
                            className="sim-input"
                          />
                        ) : (
                          <>
                            <input
                              id={`reg-${fieldKey}`}
                              type={meta.type || 'text'}
                              required={isRequired}
                              placeholder={meta.placeholder}
                              value={regFields[fieldKey] || ''}
                              onChange={(e) => setRegFields((f) => ({ ...f, [fieldKey]: e.target.value }))}
                              className="sim-input"
                            />
                            {fieldKey === 'password' && (
                              <PasswordStrengthChecklist password={regFields.password || ''} />
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="pt-2 flex justify-end">
                  <button
                    type="submit"
                    disabled={loading}
                    className="sim-btn-primary px-6 py-2.5"
                  >
                    {loading ? 'Création...' : 'Créer mon compte vendeur'}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {mode === 'forgot' && (
          <div className="mt-6 max-w-md space-y-4">
            <h2 className="font-display text-lg font-bold text-[var(--sim-text-primary)]">
              Réinitialisation du mot de passe
            </h2>
            {!demoResetToken ? (
              <form onSubmit={handleForgot} className="space-y-3">
                <input
                  type="email"
                  required
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  placeholder="Votre courriel vendeur"
                  className="sim-input"
                />
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setMode('login')}
                    className="text-xs font-semibold text-[var(--sim-text-secondary)]"
                  >
                    Retour
                  </button>
                  <button
                    type="submit"
                    className="sim-btn-primary"
                  >
                    Envoyer le lien unique
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleReset} className="space-y-3">
                <p className="text-xs text-[var(--sim-success-text)]">
                  Jeton de réinitialisation généré. Saisissez votre nouveau mot de passe :
                </p>
                <input
                  type="password"
                  required
                  value={newResetPassword}
                  onChange={(e) => setNewResetPassword(e.target.value)}
                  placeholder="Nouveau mot de passe"
                  className="sim-input"
                />
                <PasswordStrengthChecklist password={newResetPassword} />
                <button
                  type="submit"
                  className="sim-btn-primary"
                >
                  Enregistrer le nouveau mot de passe
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Bell, BellOff, Download, Smartphone, WifiOff, X, ArrowRight, ShieldCheck } from 'lucide-react';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';
import { api } from '../lib/api';
import type { PushAlertItem } from '../shared/types';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div
      role="status"
      className="fixed bottom-16 md:bottom-4 left-4 z-[var(--sim-z-toast)] flex items-center gap-2 rounded-[var(--sim-radius-md)] bg-[var(--sim-warning-bg)] border border-amber-300 px-3.5 py-2 text-xs font-medium text-[var(--sim-warning-text)] shadow-[var(--sim-shadow-2)]"
    >
      <WifiOff className="w-4 h-4 shrink-0" />
      <span>Mode hors connexion — Données en cache affichées</span>
    </div>
  );
};

export const PWAInstallButton: React.FC<{ onInstalledToast?: () => void }> = ({ onInstalledToast }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  useEscapeKey(() => setShowGuide(false), showGuide);

  if (isInstalled) return null;

  const handleInstallClick = async () => {
    if (isInstallable) {
      const ok = await install();
      if (ok && onInstalledToast) onInstalledToast();
    } else {
      setShowGuide(true);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleInstallClick}
        className="inline-flex items-center gap-2 rounded-[var(--sim-radius-md)] border border-[var(--sim-steel-800)] bg-[var(--sim-steel-900)] px-3.5 py-2 text-xs font-bold uppercase tracking-wider text-slate-200 hover:border-[var(--sim-accent-400)] hover:text-white transition-colors whitespace-nowrap shrink-0"
      >
        <Download className="w-3.5 h-3.5 text-[var(--sim-accent-400)] shrink-0" />
        <span>Installer l’app</span>
      </button>

      <AnimatePresence>
        {showGuide && (
          <div
            role="dialog"
            aria-modal="true"
            onClick={() => setShowGuide(false)}
            className="fixed inset-0 z-[var(--sim-z-modal)] flex items-center justify-center bg-black/60 backdrop-blur-[2px] p-4"
          >
            <motion.div
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              className="w-full max-w-md rounded-[var(--sim-radius-lg)] bg-[var(--sim-bg-surface)] p-6 shadow-[var(--sim-shadow-3)] border border-[var(--sim-border-strong)]"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-2.5">
                  <Smartphone className="w-5 h-5 text-[var(--sim-accent-500)]" />
                  <h3 className="font-display text-lg font-semibold text-[var(--sim-text-primary)]">
                    Installer SIMCOVA sur votre appareil
                  </h3>
                </div>
                <button
                  type="button"
                  aria-label="Fermer le guide d'installation"
                  onClick={() => setShowGuide(false)}
                  className="p-1 text-[var(--sim-text-muted)] hover:text-[var(--sim-text-primary)]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="mt-3 text-sm text-[var(--sim-text-secondary)] leading-relaxed">
                {isIOS
                  ? 'Sur Safari iOS, touchez le bouton Partager en bas de votre écran puis sélectionnez « Sur l’écran d’accueil » pour lancer SIMCOVA en plein écran.'
                  : 'Utilisez le menu de votre navigateur (Chrome, Edge ou Android) et sélectionnez « Installer l’application » ou « Ajouter à l’écran d’accueil » pour recevoir les alertes produits.'}
              </p>
              <div className="mt-5 flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowGuide(false)}
                  className="rounded-[var(--sim-radius-md)] bg-[var(--sim-accent-500)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--sim-accent-600)] transition-colors"
                >
                  Compris
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
};

interface PushPrefs {
  nouveautes: boolean;
  promotions: boolean;
  annonces: boolean;
}

export const PushNotificationManager: React.FC<{
  onDeepLink: (link: string) => void;
  onToast: (type: 'success' | 'error' | 'info', title: string, description?: string) => void;
}> = ({ onDeepLink, onToast }) => {
  const [endpointId, setEndpointId] = useState<string | null>(() => {
    try {
      return localStorage.getItem('simcova_push_endpoint');
    } catch {
      return null;
    }
  });
  const [prefs, setPrefs] = useState<PushPrefs>(() => {
    try {
      const saved = localStorage.getItem('simcova_push_prefs');
      return saved ? JSON.parse(saved) : { nouveautes: true, promotions: true, annonces: true };
    } catch {
      return { nouveautes: true, promotions: true, annonces: true };
    }
  });
  const [openPrefs, setOpenPrefs] = useState(false);
  const [liveAlert, setLiveAlert] = useState<PushAlertItem | null>(null);

  useEscapeKey(() => setOpenPrefs(false), openPrefs);

  useEffect(() => {
    const es = new EventSource('/api/notifications/stream');
    es.addEventListener('simcova_alert', (event) => {
      try {
        const alert = JSON.parse((event as MessageEvent).data) as PushAlertItem;
        const storedEp = localStorage.getItem('simcova_push_endpoint');
        const storedPrefsRaw = localStorage.getItem('simcova_push_prefs');
        const currentPrefs: PushPrefs = storedPrefsRaw
          ? JSON.parse(storedPrefsRaw)
          : { nouveautes: true, promotions: true, annonces: true };

        if (!storedEp || currentPrefs[alert.alertType] === false) {
          return;
        }
        setLiveAlert(alert);

        if ('Notification' in window && Notification.permission === 'granted') {
          try {
            new Notification(alert.title, {
              body: alert.body,
              icon: '/pwa-192x192.png',
            });
          } catch {
            // In-app alert banner already handles display
          }
        }
      } catch {
        // Ignore malformed event
      }
    });
    return () => es.close();
  }, []);

  const handleSubscribe = async () => {
    try {
      if ('Notification' in window && Notification.permission === 'default') {
        await Notification.requestPermission().catch(() => undefined);
      }
      const ep = endpointId || `pwa-${crypto.randomUUID().slice(0, 12)}`;
      await api.subscribePush(ep, prefs);
      localStorage.setItem('simcova_push_endpoint', ep);
      localStorage.setItem('simcova_push_prefs', JSON.stringify(prefs));
      setEndpointId(ep);
      onToast('success', 'Alertes activées', 'Vous recevrez les nouveaux produits publiés par SIMCOVA.');
    } catch (err) {
      onToast('error', 'Erreur d’abonnement', err instanceof Error ? err.message : undefined);
    }
  };

  const handleSavePrefs = async (next: PushPrefs) => {
    setPrefs(next);
    localStorage.setItem('simcova_push_prefs', JSON.stringify(next));
    if (endpointId) {
      await api.updatePushPreferences(endpointId, next).catch(() => undefined);
    }
    onToast('info', 'Préférences enregistrées');
  };

  const handleUnsubscribe = async () => {
    if (endpointId) {
      await api.unsubscribePush(endpointId).catch(() => undefined);
      localStorage.removeItem('simcova_push_endpoint');
      setEndpointId(null);
      setOpenPrefs(false);
      onToast('info', 'Désinscription effectuée', 'Vous ne recevrez plus d’alertes push.');
    }
  };

  return (
    <>
      {!endpointId ? (
        <button
          type="button"
          onClick={handleSubscribe}
          className="inline-flex items-center gap-2 rounded-[var(--sim-radius-md)] border border-slate-700 bg-[var(--sim-steel-900)] px-3.5 py-2 text-xs font-semibold text-slate-200 hover:border-[var(--sim-accent-400)] hover:text-white transition-colors whitespace-nowrap shrink-0"
        >
          <Bell className="w-3.5 h-3.5 text-[var(--sim-accent-400)]" />
          <span>Activer les alertes arrivages</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpenPrefs(true)}
          className="inline-flex items-center gap-2 rounded-[var(--sim-radius-md)] border border-emerald-700 bg-[var(--sim-steel-900)] px-3.5 py-2 text-xs font-semibold text-emerald-400 hover:border-[var(--sim-accent-400)] transition-colors whitespace-nowrap shrink-0"
        >
          <Bell className="w-3.5 h-3.5" />
          <span>Alertes actives · Préférences</span>
        </button>
      )}

      {/* Bannière temps réel lorsqu'une alerte administrateur arrive (EXF-608 / EXF-610) */}
      <AnimatePresence>
        {liveAlert && (
          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            className="fixed top-20 right-4 z-[var(--sim-z-toast)] max-w-sm w-full rounded-[var(--sim-radius-lg)] border border-[var(--sim-accent-500)] bg-[var(--sim-bg-surface)] p-4 shadow-[var(--sim-shadow-3)]"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-[var(--sim-accent-600)]">
                  Alerte SIMCOVA · {liveAlert.alertType}
                </p>
                <p className="mt-1 text-sm font-bold text-[var(--sim-text-primary)]">{liveAlert.title}</p>
                <p className="mt-1 text-xs text-[var(--sim-text-secondary)]">{liveAlert.body}</p>
              </div>
              <button
                type="button"
                aria-label="Fermer l’alerte"
                onClick={() => setLiveAlert(null)}
                className="p-1 text-[var(--sim-text-muted)] hover:text-[var(--sim-text-primary)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  onDeepLink(liveAlert.deepLink);
                  setLiveAlert(null);
                }}
                className="inline-flex items-center gap-1.5 rounded-[var(--sim-radius-sm)] bg-[var(--sim-accent-500)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--sim-accent-600)] transition-colors"
              >
                <span>Découvrir</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {openPrefs && (
          <div
            role="dialog"
            aria-modal="true"
            onClick={() => setOpenPrefs(false)}
            className="fixed inset-0 z-[var(--sim-z-modal)] flex items-center justify-center bg-black/60 backdrop-blur-[2px] p-4"
          >
            <motion.div
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="w-full max-w-md rounded-[var(--sim-radius-lg)] bg-[var(--sim-bg-surface)] p-6 shadow-[var(--sim-shadow-3)] border border-[var(--sim-border-strong)]"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-display text-lg font-bold text-[var(--sim-text-primary)]">
                  Préférences de notifications
                </h3>
                <button
                  type="button"
                  aria-label="Fermer"
                  onClick={() => setOpenPrefs(false)}
                  className="p-1 text-[var(--sim-text-muted)] hover:text-[var(--sim-text-primary)]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="mt-1 text-xs text-[var(--sim-text-secondary)]">
                Choisissez les catégories d’alertes reçues sur cet appareil.
              </p>

              <div className="mt-4 space-y-3">
                {(
                  [
                    ['nouveautes', 'Arrivées de nouveaux produits'],
                    ['promotions', 'Sélections & offres spéciales'],
                    ['annonces', 'Annonces officielles SIMCOVA'],
                  ] as const
                ).map(([key, label]) => (
                  <label
                    key={key}
                    className="flex items-center justify-between rounded-[var(--sim-radius-md)] border border-[var(--sim-border-hairline)] px-3.5 py-2.5 text-sm cursor-pointer"
                  >
                    <span className="text-[var(--sim-text-primary)] font-medium">{label}</span>
                    <input
                      type="checkbox"
                      checked={prefs[key]}
                      onChange={(e) => handleSavePrefs({ ...prefs, [key]: e.target.checked })}
                      className="h-4 w-4 accent-[var(--sim-accent-500)]"
                    />
                  </label>
                ))}
              </div>

              <div className="mt-6 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={handleUnsubscribe}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--sim-error-text)] hover:underline"
                >
                  <BellOff className="w-3.5 h-3.5" />
                  <span>Se désinscrire complètement</span>
                </button>
                <button
                  type="button"
                  onClick={() => setOpenPrefs(false)}
                  className="rounded-[var(--sim-radius-md)] bg-[var(--sim-accent-500)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--sim-accent-600)]"
                >
                  Fermer
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
};

export const ConsentBanner: React.FC = () => {
  const [visible, setVisible] = useState(() => {
    try {
      return !localStorage.getItem('simcova_consent_ack');
    } catch {
      return false;
    }
  });

  if (!visible) return null;

  const accept = () => {
    try {
      localStorage.setItem('simcova_consent_ack', 'accepted');
    } catch {
      // ignore
    }
    setVisible(false);
  };

  return (
    <div className="border-t border-[var(--sim-border-hairline)] bg-[var(--sim-bg-subtle)] px-4 py-3 text-xs text-[var(--sim-text-secondary)]">
      <div className="mx-auto flex max-w-7xl flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 shrink-0 text-[var(--sim-accent-500)]" />
          <span>
            SIMCOVA utilise uniquement le stockage local essentiel pour conserver votre panier et vos favoris sans création de compte.
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={accept}
            className="rounded-[var(--sim-radius-sm)] bg-[var(--sim-text-primary)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 transition-opacity whitespace-nowrap"
          >
            Accepter
          </button>
        </div>
      </div>
    </div>
  );
};

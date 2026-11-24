# SIMCOVA Marketplace

Place de marché B2B/B2C — machines industrielles, tracteurs agricoles, engins BTP et outillage professionnel (FCFA). Achat sans compte acheteur, paiement Jumia Africa, suivi sécurisé par lien personnel, espaces vendeurs (KYC chiffré) et console d'administration.

## Prérequis

- **Node.js ≥ 22.5** (module natif `node:sqlite`)
- Un serveur SMTP pour l'envoi réel des emails transactionnels (optionnel — sans SMTP, les emails restent consultables/relayables depuis la console Admin)

## Démarrage

```bash
npm install
cp .env.example .env.local   # renseigner au minimum les secrets de production
npm run dev                  # http://localhost:3000 (Vite + API)
```

Build et exécution en production :

```bash
npm run build                # génère dist/
NODE_ENV=production npm start
```

## Configuration (variables d'environnement)

| Variable | Rôle | Requis en production |
|---|---|---|
| `SIMCOVA_TOKEN_SECRET` | Signature HMAC des jetons de session/suivi | ⚠️ oui (sinon secret de secours auto-généré dans `data/`) |
| `SIMCOVA_KYC_ENCRYPTION_KEY` | Chiffrement AES-256-GCM des pièces KYC | ⚠️ oui (sinon secret de secours auto-généré) |
| `JUMIA_AFRICA_WEBHOOK_SECRET` | Vérification HMAC des webhooks Jumia | ⚠️ oui |
| `SIMCOVA_ADMIN_PASSCODE` | Mot de passe administrateur initial | oui (sinon claim au premier démarrage via l'UI) |
| `APP_URL` | URL publique (liens de suivi dans les emails) | oui |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | Envoi réel des emails transactionnels | oui pour un usage officiel |
| `JUMIA_AFRICA_ENV` | `sandbox` (paiements simulés) ou `production` | `sandbox` tant que l'intégration JumiaPay réelle n'est pas branchée |
| `GEMINI_API_KEY` | Suggestion de mots-clés produits (Gemini) | non (repli automatique) |
| `PORT` | Port d'écoute (défaut 3000) | non |

## Tests

```bash
npm test          # e2e complet (cycle marketplace) + mailer + moteur de règles
npm run lint      # tsc --noEmit
```

## Architecture en bref

- `server.ts` + `server/` : API Express, SQLite (`node:sqlite`, WAL), jobs de maintenance (expiration RG-10, purge KYC, flush email), rate limiting, SSE.
- `src/` : SPA React 19 + Vite + Tailwind 4 (PWA), règles métier partagées dans `src/shared/`.
- `docs/postgresql-schema.sql` : schéma de référence pour la migration production.
- Paiement : interface `PaymentProvider` (`server/payments/jumiaAfrica.ts`) — sandbox complète ; l'intégration JumiaPay officielle se branche dans ce seul fichier.

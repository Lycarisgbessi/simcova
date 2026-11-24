# SPÉCIFICATION — Console Administrateur SIMCOVA (référence exhaustive)

> Objectif : **tout voir, tout contrôler, tout exporter**. Chaque élément est marqué :
> ✅ déjà implémenté · 🔶 partiellement implémenté · ➕ à construire
> La **Phase 1** (§ priorités) couvre les ajouts à fort impact immédiat.

---

## 1. 💰 FINANCES & MONÉTISATION (le cœur)

### 1.1 Commission marketplace (le % prélevé par la plateforme)
| Donnée / Contrôle | État |
|---|---|
| Taux de commission global configurable (0–50 %, sur le sous-total produits) | ✅ `Paramètres → Commission marketplace` |
| TVA configurable (0–50 %) avec base HT/TTC | ✅ |
| **Montant de commission par transaction** (figé à la commande, colonne `commission_amount`) | ✅ stocké · 🔶 non affiché dans la liste transactions |
| Commission encaissée par période (7/30/90 j/tout) | ✅ KPI vue globale |
| **Commission par vendeur** (cumul, par période, tendance) | ➕ |
| **Commission par rayon / catégorie** | ➕ |
| **Commission par moyen de paiement** (Orange, MTN, Wave, carte, virement) | ➕ |
| **Taux dégradés** : par vendeur (volume), par rayon, par gamme de prix | ➕ |
| Historique des changements de taux (qui, quand, avant/après) | ➕ (l'audit log trace le paramètre, pas le diff chiffré) |
| Simulateur d'impact : « si 7 % au lieu de 5 % → +X FCFA sur la période » | ➕ |
| **Reversements vendeurs (payouts)** : net à reverser = ventes − commission ; statut à payer/payé ; génération de bordereaux/brouillards ; historique des virements de reversement | ➕ **module entier à construire** (la donnée netRevenue existe déjà par vendeur) |

### 1.2 Transactions (vue exhaustive)
| Donnée / Contrôle | État |
|---|---|
| Liste de **toutes les transactions** (réf. PSP `JAF-…`, commande, vendeur, acheteur, moyen, montant, statut, horodatage) | ✅ onglet Commandes & CSV |
| Filtres : période, statut, moyen de paiement, vendeur, fourchette de montant, recherche par réf/email | ➕ (seule la liste brute existe) |
| **Détail par transaction** : HT / TVA / TTC / frais de livraison / commission prélevée / **net vendeur** / mode (intégral, acompte, devis, virement) | 🔶 (toutes les données existent en base — il manque l'écran de détail) |
| Journal des **webhooks PSP reçus** (payload brut, idempotence, écarts de montant refusés) | 🔶 stocké par paiement (`webhook_events_json`) — pas d'écran de consultation |
| Transactions en échec / annulées avec motif | 🔶 |
| Écart de rapprochement PSP vs base interne | ➕ |

### 1.3 Acomptes, soldes & virements
| Donnée / Contrôle | État |
|---|---|
| Acomptes encaissés vs **soldes restant à encaisser à la livraison** (balance globale + par commande) | 🔶 (par commande ✅ ; vue agrégée ➕) |
| Virements bancaires en attente de confirmation vendeur / confirmés (réf. bordereau) | ✅ (workflow complet, pas de vue filtre dédiée) |
| Confirmation de solde encaissé (post-livraison) | ✅ |

### 1.4 Remboursements
| Donnée / Contrôle | État |
|---|---|
| Rembourser une commande payée (admin + vendeur) avec motif | ✅ |
| Liste des remboursements, taux de remboursement, motifs récurrents, délais | 🔶 |

### 1.5 Reporting comptable
| Donnée / Contrôle | État |
|---|---|
| Exports CSV : commandes, transactions, vendeurs | ✅ |
| **Export comptable périodique** : CA HT, TVA collectée, commissions, remboursements, net reversements (format tableur, période arbitraire) | ➕ |
| Chiffre d'affaires par jour/semaine/mois avec comparaison N-1 | 🔶 (évolution 8 points glissants uniquement) |
| Panier moyen, GMV, encaissé net plateforme | ➕ (GMV ≈ totalSales ✅) |

---

## 2. 📊 DASHBOARD & STATISTIQUES GÉNÉRALES

| Donnée / Contrôle | État |
|---|---|
| Volume d'affaires encaissé + nb commandes, période 7/30/90 j/tout | ✅ |
| TVA collectée + commission encaissée sur la période | ✅ |
| Répartition des statuts de paiement (pending/paid/failed/refunded/expired) | ✅ |
| Courbe d'évolution ventes & commandes | ✅ (8 buckets) — 🔶 sans granularité jour/semaine/mois au choix |
| Vendeurs actifs / en attente, produits publiés, modération en attente | ✅ |
| **Taux de conversion panier → commande** | ➕ (le panier est local côté client : nécessite un événement anonyme) |
| **Panier moyen** par période / zone / mode de paiement | ➕ |
| **Top produits / top vendeurs / top rayons** (CA et quantités) | ➕ |
| **Nouveaux acheteurs uniques** (emails distincts) par période + acheteurs récurrents + LTV | ➕ |
| Délis moyens : création→paiement, paiement→expédition, expédition→livraison | ➕ |
| Taux d'expiration RG-10 des commandes impayées | ➕ |
| Répartition géographique (zones de livraison Abidjan/Intérieur/CÉDÉAO) | ➕ |
| Valeur du stock catalogue publié (somme prix×stock par vendeur/rayon) | ➕ |

---

## 3. 📦 COMMANDES

| Donnée / Contrôle | État |
|---|---|
| Liste complète + statut + remboursement | ✅ |
| Recherche par n° / email / téléphone acheteur | ➕ |
| **Fiche commande détaillée** : timeline horodatée complète, articles, variantes, spécifs sur mesure, adresse, transporteur + n° suivi, HT/TVA/TTC/commission/net, fil de discussion lié | ➕ (toutes les données existent — l'écran n'existe pas) |
| Vue des commandes sur mesure (devis demandé → proposé → payé) | 🔶 |
| Commandes expirées automatiquement (RG-10) | ✅ (statut) — vue dédiée ➕ |
| Relancer un acheteur (email de relance de paiement) | 🔶 (email auto envoyé au refus ; relance manuelle ➕) |

---

## 4. 🏪 VENDEURS & KYC

| Donnée / Contrôle | État |
|---|---|
| Liste vendeurs + statut (en_attente/valide/rejete/certifie/suspendu) + boutique + nb produits publiés | ✅ |
| Valider / certifier / rejeter (motif obligatoire) / suspendre, gestion des badges | ✅ |
| Visionneuse KYC chiffrée AES-256-GCM in-place + purge + **traçabilité d'accès** (KYC_VIEWED) | ✅ |
| Rétention KYC + purge automatique planifiée | ✅ |
| **Fiche vendeur 360°** : CA généré, commission prélevée, net à reverser, note moyenne, délais de livraison moyens, taux de litige/remboursement, historique des décisions | ➕ (les données de base existent côté vendeur) |
| Suspension temporaire avec date de fin automatique | ➕ |
| Scoring / rang vendeur | ➕ |
| RIB bancaire vendeur (consultation pour reversements) | ✅ (chiffré côté boutique, visible via fiche) |

---

## 5. 🛠️ PRODUITS & CATALOGUE

| Donnée / Contrôle | État |
|---|---|
| CRUD catégories + badge requis + interdiction (RG-02/RG-06) | ✅ |
| **Liste de TOUS les produits** (tous vendeurs) avec filtres (statut, rayon, vendeur, stock, prix) | ➕ |
| Dépublier / archiver un produit en tant qu'admin | 🔶 (archive auto à stock 0 ; action admin manuelle ➕) |
| Produits en rupture / archivés automatiquement | 🔶 (visible par vendeur, pas de vue admin) |
| Contrôle qualité fiches : sans image, description courte, prix aberrant | ➕ |
| Historique des modifications de prix | ➕ |
| Statistiques par produit : vues, ajouts panier, conversion | ➕ (nécessite un compteur de vues serveur) |

---

## 6. 👤 ACHETEURS (modèle sans compte)

| Donnée / Contrôle | État |
|---|---|
| Récupération des liens de suivi par email (sans divulgation) | ✅ |
| **Annuaire acheteurs** (par email) : nb commandes, CA cumulé, zone, dernier achat, LTV | ➕ |
| Détection de doublons / multi-adresses | ➕ |
| Liste noire acheteur (annulation, fraude) | ➕ |
| Suppression/anonymisation RGPD d'un acheteur sur demande | ➕ |

---

## 7. 💬 MESSAGERIE & MODÉRATION

| Donnée / Contrôle | État |
|---|---|
| Fils signalés + masquage auto RG-07 + blocage/déblocage | ✅ |
| Blocage anti-contournement (téléphones, emails, liens, WhatsApp) | ✅ |
| Recherche dans tous les fils / messages | ➕ |
| Temps de réponse moyen par vendeur | ➕ |
| Volume de messages par période | ➕ |

## 8. ⭐ AVIS

| Donnée / Contrôle | État |
|---|---|
| Modération (visible/retiré), signalements, réponse unique vendeur | ✅ |
| Note moyenne plateforme + distribution 1→5 étoiles | ➕ |
| Historique des avis retirés avec motif | ➕ |

---

## 9. ⚖️ GOUVERNANCE & RÈGLES RG-01 → RG-10

| Donnée / Contrôle | État |
|---|---|
| Activation/paramétrage temps réel (certification, plafonds, champs RG-04, moyens RG-08, zones RG-09, expiration RG-10, seuil modération RG-07) | ✅ |
| Notification automatique des vendeurs à chaque changement | ✅ |
| **Historique versionné des règles (diff avant/après)** | ➕ |
| Paramètres plateforme : devise, CGV, mentions, support, rétention KYC, acompte par défaut, seuil virement, TVA, commission | ✅ |

---

## 10. 🔐 ADMINISTRATION, RÔLES & SÉCURITÉ

| Donnée / Contrôle | État |
|---|---|
| Admin unique + claim premier démarrage + passcode env (comparaison constant-time) | ✅ |
| **Multi-administrateurs avec rôles** : Super-Admin, Finance, Modérateur, Support (permissions par module) | ➕ |
| Authentification à deux facteurs (2FA/TOTP) | ➕ |
| Sessions actives / historique de connexions (IP, date) / révocation | ➕ |
| Journal d'audit horodaté (80 dernières actions, acteur, cible, détail) | ✅ 🔶 (pas de filtre/recherche/export de l'historique complet) |
| Rate limiting (configuration des seuils par endpoint) | ✅ appliqué · 🔶 non pilotable |

---

## 11. 📣 MARKETING & NOTIFICATIONS

| Donnée / Contrôle | État |
|---|---|
| Alertes push temps réel (SSE) ciblées par préférences + historique + nb destinataires + abonnés | ✅ |
| Segmentation d'audience (zone, acheteurs actifs, vendeurs) | ➕ |
| Campagnes email (nouveautés, relances) + stats ouverture/clic | ➕ (le moteur SMTP existe) |
| Bannières accueil pilotables (promo, information) | ➕ |
| Codes promo / remises négociées | ➕ (fonctionnalité commerce entière) |

## 12. ✉️ EMAILS TRANSACTIONNELS

| Donnée / Contrôle | État |
|---|---|
| File outbox avec statut Envoyé/Échec/Attente + tentatives + erreur + liens cliquables | ✅ |
| Envoi réel SMTP + retry automatique (20 essais) | ✅ |
| Recherche dans les emails + renvoi manuel | ➕ |
| Statistiques de délivrabilité (rebonds, erreurs) | ➕ |
| Templates éditables | ➕ |

---

## 13. 🖥️ SYSTÈME & EXPLOITATION

| Donnée / Contrôle | État |
|---|---|
| Journal d'audit + outbox (onglet Paramètres & Audit) | ✅ |
| **Santé système** : uptime, latence API, erreurs 4xx/5xx, taille de la base, volume uploads | ➕ |
| Historique des **jobs de maintenance** (expirations RG-10, purges KYC, flush email : exécutions, volumes) | 🔶 (logs console uniquement) |
| Mode maintenance (masquer la plateforme pendant intervention) | ➕ |
| Sauvegardes : listing, téléchargement, restauration | ➕ |
| Gestion des médias uploadés (volume, purge orphelins) | ➕ |

## 14. 📤 EXPORTS & API

| Donnée / Contrôle | État |
|---|---|
| CSV : commandes, transactions, vendeurs | ✅ |
| Export acheteurs, produits, avis, audit complet | ➕ |
| Période arbitraire sur tous les exports | ➕ |
| API ouverte read-only avec clés (partenaire/comptable) | ➕ (OpenAPI sommaire ✅) |

---

# 🎯 PRIORISATION PROPOSÉE

> **Phase 1 : IMPLÉMENTÉE INTÉGRALEMENT** ✅ (18/18 tests, build OK) — onglets console
> *Finances & Reversements*, *Statistiques*, *Acheteurs*, fiche commande 360°, recherche commandes,
> export comptable + exports acheteurs/audit, endpoints `/admin/transactions`, `/admin/payouts` (GET+POST),
> `/admin/analytics`, `/admin/buyers`, `/admin/orders/:id`.

**Phase 1 — « l'admin voit tout, finance incluse »** ✅ LIVRÉE :
1. ✅ Détail par transaction (HT/TVA/TTC/commission/net vendeur) + filtres ;
2. ✅ **Module reversements vendeurs** (à payer / payé, bordereaux, historique, audit) ;
3. ✅ Commission par vendeur / moyen de paiement + Top produits & vendeurs & rayons ;
4. ✅ Fiche commande 360° (timeline, spécifs, transporteur, ventilation) + recherche ;
5. ✅ Annuaire acheteurs (emails, CA, récurrence, LTV, export) ;
6. ✅ KPIs complémentaires : panier moyen, soldes acomptes en attente, taux de remboursement/expiration, délais moyens, zones, distribution des notes, série journalière ;
7. ✅ Export comptable périodique (avec ligne TOTAL) + audit exportable.

**Phase 2** ✅ LIVRÉE : liste produits globale + dépublication admin + compteur de vues, fiche vendeur 360° (CA, commission attribuée, net, restant à reverser, historique décisions, KYC), santé système (uptime, base, jobs maintenance, file emails, uploads).

**Phase 3 — partiellement livrée** ✅ : codes promo complets (CRUD, validation publique, application caisse + parité client/serveur, commission inchangée), campagnes email segmentées (acheteurs/vendeurs/tous via outbox), mode maintenance (middleware 503 non-admin), sauvegardes SQLite (VACUUM INTO + liste + téléchargement).
➕ Restant Phase 3 : multi-administrateurs avec rôles granulaires + 2FA, sessions actives/historique, bannières accueil pilotables.

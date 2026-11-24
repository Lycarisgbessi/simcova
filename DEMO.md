# 🎬 Guide de démonstration SIMCOVA

Lancement : double-cliquez sur **`demo.cmd`** (ou `./demo.sh`). La base est remise à zéro à chaque lancement — impossible de rater la démo à cause d'un état résiduel.

## Comptes de présentation

| Rôle | Identifiants | Où |
|---|---|---|
| **Acheteur** | Aucun compte ! | Partout (c'est la force du modèle) |
| **Vendeur** | `vendeur@simcova.africa` / `VendeurDemo2026!` | Espace Pro → Connexion |
| **Admin** | `admin@simcova.africa` / `AdminDemo2026!` | Espace Pro → Connexion |

> Paiement : **sandbox Jumia Africa** (simulé, aucune clé requise). Emails : en file dans la console Admin (**Paramètres & Audit → Courriels transactionnels**, liens cliquables).

---

## Scénario proposé (~12 minutes)

### Acte 1 — L'acheteur sans compte (4 min)

1. **Vitrine** : recherche « tracteur », filtre par rayon, tri par prix. Montrer le badge *Vendeur certifié*, les notes/avis.
2. **Fiche produit** : cliquer sur *« Tracteur Agricole 90 CV »* (Concession Démo). Montrer galerie, variantes (Version Cabine / + Chargeur), zones de livraison, moyens de paiement acceptés.
3. **Offre sur mesure** : basculer sur l'onglet *Sur mesure / Devis* — c'est le différenciateur B2B.
4. **Ajouter au panier → Commander sans compte** : remplir nom / email / adresse (ex. `demo@btp.ci`).
5. **Options de règlement** : intégral / **acompte 30 % + solde livraison** / devis / virement ≥ 5 M FCFA. Choisir *acompte* + Orange Money.
6. **Paiement Jumia (sandbox)** : « Confirmer et payer » → confirmation, montant, référence JAF-…
7. **Lien de suivi** : copier le lien, « Suivre ma commande en direct » → timeline horodatée, acompte réglé, solde restant.

### Acte 2 — Le vendeur (4 min)

8. Déconnexion, **Espace Pro → vendeur@simcova.africa**. Tableau de bord : chiffre d'affaires, commandes à traiter, note boutique, commission/net.
9. **Commandes** : la commande de l'acte 1 est là. Faire évoluer le statut : *En préparation → Expédiée* (saisir transporteur « SIMCOVA Logistique » + n° suivi) → *Livrée*.
10. **Messagerie** : répondre à un message client (montrer le blocage anti-contournement : écrire « appelez-moi au 07… » → refusé).
11. **Produits** : créer une fiche en direct (titre, prix, stock, zones) → *Publier*. Montrer la suggestion de mots-clés.
12. **Boutique & KYC** : montrer le RIB chiffré, l'import de pièces (AES-256-GCM).

### Acte 3 — L'administrateur (4 min)

13. Déconnexion, **Espace Pro → admin@simcova.africa**.
14. **Vue globale** : volume encaissé, TVA/commission, évolution, modération en attente.
15. **Vendeurs & KYC** : ouvrir une pièce (déchiffrement in-place + tracé dans le journal d'audit) → *Certifier* un vendeur en attente.
16. **Règles RG-01→RG-10** : activer RG-01 (certification obligatoire) en direct — effet immédiat.
17. **Paramètres & Audit** : courriels transactionnels (liens de suivi cliquables), journal d'audit, TVA/commission ajustables.
18. **Commandes & CSV** : export CSV commandes/transactions.

### Bonus si questions

- **Vérification email sans SMTP** : inscrire un nouveau vendeur en live → le bouton « Confirmer mon courriel » fonctionne (jeton démo).
- **Anti-fraude** : `/api/orders/track/...` régénère le lien → l'ancien est révoqué.
- **Expiration RG-10** : commande impayée expirée automatiquement après 48 h.

---

## Questions fréquentes pendant la démo

| Question | Réponse |
|---|---|
| « Le paiement est réel ? » | Non — sandbox simulée. L'intégration JumiaPay réelle est le dernier module, prêt à brancher dès le contrat marchand. |
| « Les acheteurs reçoivent leurs liens comment ? » | Par email — branchement SMTP en 5 variables d'env (développé et testé). En démo, la file est visible côté admin. |
| « Où sont les données ? » | SQLite chiffré côté KYC, schéma PostgreSQL de migration fourni (`docs/postgresql-schema.sql`). |
| « Qui peut publier ? » | Dépend des règles RG-01/RG-05 ajustables en direct par l'admin (à montrer acte 3). |
| « Mobile ? » | PWA installable (bouton « Installer l'app »), alertes temps réel en SSE. |

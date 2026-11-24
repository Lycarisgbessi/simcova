# SIMCOVA — Charte Graphique & Système de Design (§4)

> Direction artistique : place de marché B2B/B2C haute densité inspirée **Amazon Business / Alibaba**.
> Ce document reflète fidèlement les jetons CSS implémentés dans `src/index.css`.

## 1. Palette & Jetons CSS (`src/index.css`)

### Neutres & surfaces (60 % toile / 30 % cartes)
- **Fonds** : `--sim-bg-canvas: #EAEDED` (toile béton clair), `--sim-bg-surface: #FFFFFF` (cartes), `--sim-bg-subtle: #F3F4F6`, `--sim-bg-muted: #E2E5E9`.
- **Barres acier structurelles** : `--sim-steel-950: #131921`, `--sim-steel-900: #232F3E`, `--sim-steel-800: #37475A`, bordures `--sim-steel-border: rgba(255,255,255,0.16)`.
- **Texte** : `--sim-text-primary: #0F1111`, `--sim-text-secondary: #3B4248`, `--sim-text-muted: #565959`, `--sim-text-inverse: #FFFFFF`.
- **Bordures** : `--sim-border-hairline: #D5D9D9`, `--sim-border-strong: #AAB1B8`.

### Accent cuivre & ambre industriel (10 % budget d'accentuation)
- `--sim-accent-500: #C2410C` (actions structurantes), `--sim-accent-600: #9A3412`, `--sim-accent-700: #7C2D12`.
- `--sim-accent-400: #F59E0B`, CTA ambre haute visibilité : `--sim-amber-cta: #F59E0B` / hover `#D97706`.
- Fonds d'accent doux : `--sim-accent-50: #FFF7ED`, `--sim-accent-100: #FFEDD5`, anneau `--sim-accent-ring: rgba(194,65,12,0.25)`.

### Statuts sémantiques (toujours accompagnés d'un libellé ou d'une icône)
| Statut | Fond | Texte |
|---|---|---|
| Succès | `#ECFDF5` | `#067D62` |
| Avertissement | `#FFFBEB` | `#B45309` |
| Erreur (rouge prix marketplace) | `#FEF2F2` | `#B12704` |
| Information | `#EFF6FF` | `#007185` |

### Mode sombre (classe `.dark`, variant Tailwind `@custom-variant`)
Toile `#0D1117`, surfaces `#151B23`/`#1D2530`, bordures blanches translucides, accents et statuts en versions translucides/éclaircies (ex. succès `#34D399`, erreur `#F87171`).

## 2. Typographie
- **Titres** : `Manrope` (`--sim-font-display`).
- **Corps** : `IBM Plex Sans` (`--sim-font-body`).
- **Prix & chiffres** : `IBM Plex Mono` (`--sim-font-mono`, `font-variant-numeric: tabular-nums` via la classe `font-mono-nums`).

## 3. Espace, formes & profondeur
- Espacements base 4 px : `--sim-space-1` (0,25 rem) à `--sim-space-12` (3 rem).
- Rayons nets type marketplace : `--sim-radius-sm` 0,1875 rem → `--sim-radius-xl` 0,625 rem.
- 3 niveaux d'ombres (`--sim-shadow-1/2/3`), z-index nommés (`--sim-z-base/sticky/header/drawer/modal/toast`).

## 4. Mouvement & Accessibilité
- Durées : `--sim-duration-fast` 140 ms, `--sim-duration-base` 220 ms, `--sim-duration-slow` 360 ms ; courbe `--sim-ease-out: cubic-bezier(0.16, 1, 0.3, 1)`.
- Animations basées uniquement sur `transform` et `opacity` (`motion/react`), avec `prefers-reduced-motion` respecté via CSS et `<MotionConfig reducedMotion="user">`.
- Navigation clavier complète (fermeture Escape via `useEscapeKey`), contrastes ≥ 4.5:1, cibles tactiles ≥ 44 px, focus visible (`--sim-accent-ring`).

## 5. Composants utilitaires
Classes prêtes à l'emploi dans `index.css` : `sim-label`, `sim-input`, `sim-card`, `sim-btn-primary`, `sim-btn-secondary`, `sim-skeleton` (shimmer de chargement).

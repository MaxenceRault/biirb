# TripPlanner IA

Projet fil rouge : blog et planificateur de voyage basé sur les posts et avis des voyageurs. Nom de l'app : **Biirb**. Next.js (App Router) + TypeScript strict + Tailwind CSS v4, gestionnaire de paquets **npm**.

## Commandes

```bash
podman compose up   # environnement de dev conteneurisé (ou docker compose up ; voir README.md) → http://localhost:3000
npm run dev     # serveur de dev (sans Docker)
npm run build   # build de prod (lance aussi le typecheck)
npm run lint    # ESLint
```

Dans le conteneur : `podman compose run --rm app npm run <script>`.

Vérifier `npm run lint` et `npm run build` avant de considérer une tâche terminée.

## Architecture — à respecter

```
messages/
└── fr.json                    # Textes de l'interface (i18n, seule langue pour l'instant)
src/
├── app/
│   ├── layout.tsx             # Layout global (Navbar + Footer + Fonts) + fond de toutes les pages : courbes de niveau (public/topo.svg)
│   ├── page.tsx               # Homepage : feed, ou résultats de recherche si /?q= (lieux, puis titres, puis textes)
│   ├── post/[slug]/page.tsx   # Détail d'un récit : /post/<slug> (ancien lien /post/<id> → redirection 308)
│   ├── legal/[page]/page.tsx  # CGU, CGV, mentions légales, confidentialité (textes dans messages/fr.json → Legal)
│   ├── patron/page.tsx        # Devenir mécène : don sur Buy Me a Coffee (rôle donné au compte de même email)
│   ├── support/page.tsx       # Support : ouvrir un ticket et suivre son état (connecté)
│   ├── tags/page.tsx          # Récits d'un lieu : /tags?country=FR[&state=IDF&city=Montesson] (destination ou tag)
│   ├── post/new/page.tsx      # Éditeur de récit (création d'un post)
│   ├── profile/page.tsx       # Tableau de bord utilisateur
│   ├── profile/[username]/page.tsx # Profil public d'un autre utilisateur (lien depuis l'auteur dans le fil) : récits, enregistrés si partagés, ou « profil privé »
│   ├── admin/page.tsx         # Administration (rôle admin) : modération, rôles, types de récit, réglages IA, journal
│   ├── planner/page.tsx       # Planificateur : mes voyages + génération par l'IA
│   ├── planner/[id]/page.tsx  # [id] = identifiant public du voyage (UUID), affiché sous son titre avec « Copier ». Voyage : onglets Planning (jours, activités, checklist, budget, discussion IA) et Dépenses (Tricount)
│   ├── planner/join/page.tsx  # Rejoindre un voyage par lien d'invitation : /planner/join#<code> (code jamais envoyé dans l'URL)
│   ├── manifest.ts            # Manifest PWA (installation, icônes dans public/icons/)
│   ├── login/page.tsx         # Auth : connexion / inscription / mot de passe oublié (?view=)
│   ├── api-docs/page.tsx      # Swagger UI (dev uniquement, 404 en production)
│   └── api/v1/                # Couche CONTROLLER (route handlers), toutes les routes sous /api/v1/
│       ├── auth/login/route.ts    # POST /api/v1/auth/login → auth.controller
│       ├── auth/register/route.ts # POST /api/v1/auth/register → auth.controller
│       ├── auth/refresh/route.ts  # POST /api/v1/auth/refresh (rotation du refresh token) → auth.controller
│       ├── auth/logout/route.ts   # POST /api/v1/auth/logout (révoque la session) → auth.controller
│       ├── auth/forgot-password/route.ts # POST : lien de réinitialisation par email (202 dans tous les cas) → auth.controller
│       ├── auth/reset-password/route.ts  # POST : nouveau mot de passe avec le code du lien, sessions révoquées → auth.controller
│       ├── posts/route.ts         # GET (public, feed paginé par curseur) / POST (multipart + Bearer) /api/v1/posts → post.controller
│       ├── posts/[id]/route.ts    # PATCH (masquer / réafficher) / DELETE /api/v1/posts/{id} — auteur uniquement → post.controller
│       ├── posts/[id]/like/route.ts      # PUT / DELETE : aimer un post (Bearer, idempotent) → reaction.controller
│       ├── posts/[id]/save/route.ts      # PUT / DELETE : enregistrer un post (Bearer, idempotent) → reaction.controller
│       ├── posts/[id]/reactions/route.ts # GET : mes réactions + nombre de likes (Bearer) → reaction.controller
│       ├── locations/route.ts     # GET /api/v1/locations?q= recherche de villes / pays (country-state-city) → location.controller
│       ├── users/me/route.ts  # GET / PATCH /api/v1/users/me (profil connecté) → user.controller
│       ├── users/[username]/route.ts # GET /api/v1/users/{pseudo} : profil public (réglages de confidentialité appliqués côté serveur) → user.controller
│       ├── users/me/reactions/route.ts # GET ?postIds=1,2,3 : mes likes / enregistrements sur une page du feed (Bearer) → reaction.controller
│       ├── users/me/avatar/route.ts    # PUT (multipart « image ») / DELETE : photo de profil (Bearer) → user.controller
│       ├── users/me/patron/route.ts    # GET : état du rôle mécène + lien Buy Me a Coffee (Bearer) → patron.controller
│       ├── payments/buymeacoffee/route.ts # POST : webhook Buy Me a Coffee (signature HMAC vérifiée) → rôle mécène → patron.controller
│       ├── admin/trip-passes/…    # Admin : achats à rattacher, pass actifs, rattacher (email vérifié) / offrir / retirer → admin.controller
│       ├── tickets/route.ts       # GET : mes tickets / POST : ouvrir un ticket (Bearer) → ticket.controller ; admin/tickets : liste + changement d'état → admin.controller
│       ├── openapi.json/route.ts # GET /api/v1/openapi.json : spécification OpenAPI (dev uniquement)
│       ├── trips/…            # Voyages : CRUD + regenerate (IA) + messages / suggestions (discussion IA) → trip.controller ; pass voyage : pass (commande), days/[day]/regenerate, export/pdf, export/calendar
│       └── chat/route.ts      # API RAG : recherche vectorielle + appel Gemini
├── schemas/                   # DTO : schémas Zod stricts (`z.strictObject`) + types inférés (auth.schema.ts, user.schema.ts, post.schema.ts) — partagés
├── server/                    # SERVEUR UNIQUEMENT (secrets, base) : jamais importé par un composant ni par src/client (règle ESLint)
│   ├── controllers/           # Couche CONTROLLER : validation Zod, auth, rate limit, appel du service, réponse HTTP
│   ├── services/              # Couche SERVICE : logique métier (ex. post.service.ts)
│   ├── repositories/          # Couche REPOSITORY : accès base de données (Cloud SQL) et Cloud Storage uniquement
│   ├── infra/                 # Clients GCP : db.ts (Cloud SQL, auth IAM), storage.ts (Cloud Storage), ai.ts (Gemini sur Vertex AI, sortie JSON imposée)
│   ├── config.ts              # Configuration serveur : lit et valide (Zod) les variables d'environnement (getConfig)
│   ├── jwt.ts                 # Signature / vérification JWT (jose)
│   ├── rateLimit.ts           # Rate limit en mémoire + IP du client (clientIp)
│   ├── logger.ts              # Logs structurés pour Cloud Logging / Error Reporting (logError, logInfo)
│   ├── openapi.ts             # Spécification OpenAPI de l'API (corps de requête générés depuis schemas/)
│   ├── tripPdf.ts             # PDF du planning (pdf-lib, polices standard), 3 modèles : classic, table (A4 paysage), booklet (A5, un jour par page) : pass voyage
│   ├── tripCalendar.ts        # Calendrier .ics du planning (RFC 5545, texte échappé) : pass voyage
│   ├── images.ts              # Type réel d'une image (octets de signature) : photos de récits et images de profil
│   └── moderationFilter.ts    # Filtre des mots bannis (modération du texte)
├── client/                    # NAVIGATEUR : jamais importé par src/server ni src/lib (règle ESLint)
│   ├── session.ts             # Access token en mémoire, refresh via le cookie httpOnly, appels API (apiFetch ajoute le Bearer)
│   ├── reactions-store.ts     # Likes / enregistrements partagés entre pages et onglets (PostReactions)
│   ├── tripExport.ts          # Export CSV du planning
│   └── hooks/                 # useDismiss (fermeture d'un menu au clic extérieur / Échap), usePlaceSearch (recherche de lieux)
├── lib/                       # PARTAGÉ (serveur et navigateur) : ni secret ni API du navigateur ; n'importe ni src/server ni src/client
│   ├── posts.ts               # Types du feed (FeedPost, FeedPage) et type de récit (Archetype : slug + libellé)
│   ├── roles.ts               # Rôles des utilisateurs (USER_ROLES) : traveler, globetrotter, dreamer, patron (badges) et admin
│   ├── country.ts             # Drapeau emoji et nom du pays à partir du code pays
│   ├── fileName.ts            # Nom de fichier ASCII d'un export (CSV, PDF, .ics)
│   └── legal.ts               # Versions des CGU / CGV (preuve des consentements), liste des pages légales
├── proxy.ts                   # Middleware Next 16 : redirige (308) les anciens liens /post/{id} vers /post/{slug} ; refuse sans token valide les routes API privées (/api/v1/users/*, /api/v1/posts/* sauf GET /api/v1/posts et GET /api/v1/users/{pseudo}, /api/v1/trips/*)
├── types/
│   └── swagger-ui-dist.d.ts   # Types du bundle navigateur de Swagger UI
├── i18n/
│   └── request.ts             # Config next-intl (locale + chargement des messages)
├── components/
│   ├── ui/                    # Design system : ReasoningText (l'IA travaille : phrases en cascade, avec motion), EmptyState, Button, IconButton, Input, Textarea, Autocomplete, PasswordInput, Label, Field, Checkbox, Card, Icon, Avatar, Logo, Badge, Dialog (fenêtre modale <dialog> natif)
│   ├── Navbar.tsx             # Barre du haut (version visiteur / connecté)
│   ├── NavbarAccount.tsx      # Zone compte de la Navbar (client : lit la session du navigateur)
│   ├── Footer.tsx
│   ├── TravelCard.tsx         # Carte de post dans le feed
│   ├── ProfileHeader.tsx      # En-tête de profil partagé (bannière, avatar, nom, stats, style des onglets) : /profile et /profile/{pseudo}
│   ├── ProfileLink.tsx        # Liens vers le profil public d'un auteur (avatar et nom) : fil d'actualité, page d'un récit, commentaires
│   ├── TripContextBar.tsx     # Barre destination · dates · type de récit (éditeur de récit + planificateur)
│   ├── HomeHero.tsx           # Bannière de l'accueil : couvertures de récits en fondu + slogan
│   ├── HomeSidebar.tsx        # Colonnes latérales de l'accueil (grand écran) : types de récit, destinations tendance, invitation au planificateur
│   ├── FeedFilterLink.tsx     # Lien de filtre du feed (type de récit, client) : ne remonte pas en haut de la page, revient au début du feed s'il est hors écran
│   ├── BackToTop.tsx          # Bouton « Revenir en haut » de l'accueil (desktop, client : apparaît après défilement)
│   ├── HomeArchetypeMore.tsx  # Types de récit repliés de la colonne de l'accueil (client) : liste puis bouton « autres types / moins de types » en dessous
│   ├── HomeShortcuts.tsx      # Raccourcis de la colonne de gauche : nouveau récit, planifier (client, connectés uniquement)
│   ├── NavbarLinks.tsx        # Liens principaux (page active), en ligne ou dans le menu mobile
│   ├── NavbarMobileMenu.tsx   # Menu burger (< md) : recherche + liens
│   ├── TripMap.tsx            # Carte du voyage sous le planning (MapLibre + style OpenFreeMap, gratuit et sans clé) : un repère par séjour, ville et dates au survol
│   ├── TripTableView.tsx      # Vue Tableau d'un voyage (jours × heures) : lecture seule, sauf la couleur des cases (éditeurs)
│   ├── TripPassCard.tsx       # Offre du pass : carte (colonne de droite) et fenêtre (TripPassDialog) ouverte par une fonction verrouillée ou une limite IA atteinte
│   ├── PlannerHome.tsx        # Liste des voyages + formulaire de génération (client)
│   ├── AdminView.tsx          # Page d'administration (client, onglets) → /api/v1/admin/*
│   ├── ReportButton.tsx       # « Signaler » un récit (page détail)
│   ├── SupportView.tsx        # Page Support (client) : formulaire de ticket + mes tickets
│   ├── TicketStatusBadge.tsx  # Badge de l'état d'un ticket (Support, administration)
│   ├── RoleBadge.tsx          # Badge du rôle d'un utilisateur (profil, auteur d'un récit, admin)
│   ├── TripPlanner.tsx        # Voyage : planning modifiable selon le rôle (owner / editor / viewer), onglets, bandeau hors ligne (client)
│   ├── TripSharePanel.tsx     # Partage : membres, rôles, invitation par pseudo ou par lien (client)
│   ├── TripInvitations.tsx    # Invitations reçues dans « Mes voyages » (client)
│   ├── TripJoin.tsx           # Rejoindre un voyage avec un lien (client)
│   ├── TripExpenses.tsx       # Dépenses partagées : saisie multi-devises, répartition, soldes, équilibrage, « à payer » (client)
│   ├── ServiceWorkerRegister.tsx # Enregistre public/sw.js (production uniquement)
│   ├── FeedList.tsx           # Feed à chargement infini (client : GET /api/v1/posts?cursor=)
│   ├── ShareButton.tsx        # Partage du lien (menu natif ou copie dans le presse-papiers)
│   ├── PostReactions.tsx      # Boutons J'aime / Enregistrer (connecté) ; visiteur : nombre de likes seul
│   ├── NewPostButton.tsx      # Bouton flottant « Nouveau post » de l'accueil (connecté uniquement)
│   ├── StoryCard.tsx          # Carte d'un récit dans une grille (profil, page d'un lieu)
│   ├── TripCard.tsx           # Carte d'un voyage généré (planificateur, onglet Itinéraires IA du profil)
│   ├── PostEditorForm.tsx     # Formulaire de l'éditeur de récit (client)
│   ├── RichTextEditor.tsx     # Éditeur du récit (TipTap) : gras, italique, souligné, taille, puces, 5 photos (client)
│   ├── PostBody.tsx           # Affichage du récit mis en page : JSON validé → éléments React, jamais de HTML
│   ├── ProfileView.tsx        # Page profil (client : charge /api/v1/users/me avec le token)
│   ├── ProfileEditForm.tsx    # Formulaire de modification du profil (PATCH /api/v1/users/me)
│   ├── SwaggerDocs.tsx        # Swagger UI autonome (swagger-ui-dist), hors du Strict Mode de l'app
│   ├── LoginForm.tsx          # Formulaire de connexion (client)
│   ├── RegisterForm.tsx       # Formulaire d'inscription (client)
│   ├── ForgotPasswordForm.tsx # Formulaire mot de passe oublié (client)
│   └── AIChatDrawer.tsx       # Drawer du chat RAG
db/
└── migrations/                # SQL du schéma Cloud SQL (à exécuter dans Cloud SQL Studio)
scripts/
├── copy-maplibre-worker.mjs   # predev / prebuild : copie le worker de MapLibre dans public/maplibre/ (ignoré par git), servi par le site (CSP 'self')
└── seed.mts                   # Seed manuel : npm run seed (identité Google + rôle brb_admin, local uniquement) — 5 comptes démo sans mot de passe, 10 posts + tags, dans une transaction ; relançable, ne touche jamais aux vrais comptes
db/                            # Scripts SQL à exécuter dans Cloud SQL Studio
Dockerfile                     # Images multi-étapes, utilisateur non-root : « dev » (compose.yaml) et production (Cloud Run, sortie standalone)
compose.yaml                   # Dev conteneurisé : code monté, node_modules dans un volume, identifiants gcloud de la machine en lecture seule
.github/workflows/ci.yml       # Intégration continue : PR vers main → lint → typecheck → npm audit → build
.github/workflows/deploy.yml   # Déploiement continu : push sur main → lint → image Docker → Cloud Run
```

- Ne pas créer de dossier ou de fichier hors de cette structure sans le demander d'abord. Si un nouveau fichier est nécessaire, le placer au bon endroit (page → `app/`, composant → `components/`, endpoint → `app/api/v1/`, schéma Zod → `schemas/`, controller → `server/controllers/`, logique métier → `server/services/`, accès BDD → `server/repositories/`, client d'un service externe → `server/infra/`, outil serveur → `server/`, code navigateur → `client/` (hooks → `client/hooks/`), code partagé sans secret ni navigateur → `lib/`) et le signaler.
- **Séparation par lieu d'exécution**, vérifiée par le lint : `src/server` n'est jamais importé par `src/components`, `src/client` ni `src/lib` (un composant, même serveur, reçoit ses données en props depuis une page) ; `src/server` et `src/lib` n'importent jamais `src/client`.
- Les fichiers existent mais sont vides : ne les remplir que lorsqu'on travaille sur la fonctionnalité concernée. Ne pas inventer d'UI, de textes, de données ou de logique qui n'ont pas été demandés.
- Base de données : **Cloud SQL (PostgreSQL)** sur GCP, instance `biirb-511608:europe-west9:biirb-db1`, base `brb`. Connexion via `src/server/infra/db.ts` (connecteur `@google-cloud/cloud-sql-connector` + `pg`, variables lues via `getConfig()`), en **authentification IAM** : aucun mot de passe de base dans l'app ni dans `.env*`. En local : `gcloud auth application-default login` + variables `CLOUD_SQL_INSTANCE`, `DB_NAME`, `DB_USER` (son email Google). `getDb()` n'est importé que par `repositories/`. Requêtes SQL toujours paramétrées (`$1, $2…`), jamais de concaténation. Le feed de la homepage lit la table `post` (Server Component → `post.service` → `post.repository`), pagination par curseur (id du dernier post affiché).
- Rôle mécène payant : **Buy Me a Coffee** (paiement sur leur page : aucune donnée bancaire ne passe par l'app). Le rôle (`users.role = 'patron'`) est attribué **uniquement** par le webhook signé (HMAC-SHA256, `patron.service`), au compte non banni dont l'email est celui du don, dans une transaction avec la table `patron_donation` (idempotente) ; remboursement → rôle précédent rendu. Config lue par `getBuyMeACoffeeConfig()`, validée à part : absente ou invalide, seul le paiement est coupé.
- Photos des posts : bucket **Cloud Storage** `biirb-post-photos` (public en lecture), via `src/server/infra/storage.ts`, importé uniquement par `repositories/`. Écriture réservée au serveur.
- Schéma de la base (tables `users`, `post` — dont `slug` : identifiant de l'URL, unique, généré par la base à la création (trigger `post_fill_slug`) et jamais modifié ; dont `is_hidden` : post masqué par son auteur, exclu du feed, de la page détail et des pages de lieu ; dont `body` : récit mis en page en JSON (sous-ensemble de TipTap validé par `postBodySchema`), `long_description` en est le texte brut dérivé par le serveur (recherche, IA, temps de lecture), `body_photo_urls` ses photos (supprimées du bucket avec le récit) ; `body` null = ancien récit en texte brut —, `archetype` — types de récit gérés depuis l'admin (libellé, description, actif), jamais écrits en dur dans le code —, `tag`, `post_tag`, `refresh_token`, `post_like`, `post_save`, `trip*` (dont `trip_member` / `trip_invitation` : partage ; `trip_participant`, `trip_expense`, `trip_expense_share`, `trip_payment_task` : dépenses), `post_report`, `ai_usage`, `app_settings`, `admin_action`, `support_ticket`, `password_reset_token`) dans `db/migrations/`. Une migration s'exécute **une seule fois** : tout changement de schéma passe par un nouveau fichier daté (jamais de modification à la main dans la console, jamais en modifiant ou relançant un ancien fichier), commençant par `set role brb_admin;`. Rôles Postgres : `brb_admin` (propriétaire, développeurs : migrations + seed) et `brb_app` (droits minimaux de l'app, compte de service Cloud Run `brb-run`) : chaque migration accorde à `brb_app` uniquement les droits utilisés par le code. Seed uniquement via le script manuel `npm run seed`, jamais via une route de l'app.
- Schéma de la base (tables `users` — dont `is_private` et `show_saved` : confidentialité du profil public —, `post` — dont `slug` : identifiant de l'URL, unique, généré par la base à la création (trigger `post_fill_slug`) et jamais modifié ; dont `is_hidden` : post masqué par son auteur, exclu du feed, de la page détail et des pages de lieu —, `archetype` — types de récit gérés depuis l'admin (libellé, description, actif), jamais écrits en dur dans le code —, `tag`, `post_tag`, `refresh_token`, `post_like`, `post_save`, `trip*`, `post_report`, `ai_usage`, `app_settings`, `admin_action`, `support_ticket`, `password_reset_token`) dans `db/migrations/`. Une migration s'exécute **une seule fois** : tout changement de schéma passe par un nouveau fichier daté (jamais de modification à la main dans la console, jamais en modifiant ou relançant un ancien fichier), commençant par `set role brb_admin;`. Rôles Postgres : `brb_admin` (propriétaire, développeurs : migrations + seed) et `brb_app` (droits minimaux de l'app, compte de service Cloud Run `brb-run`) : chaque migration accorde à `brb_app` uniquement les droits utilisés par le code. Seed uniquement via le script manuel `npm run seed`, jamais via une route de l'app.
- Architecture back : route → controller → service → repository → base. Pas d'accès base hors des repositories.
- Documentation API : toute nouvelle route sous `/api/v1/` est ajoutée dans `src/server/openapi.ts` (visible sur `/api-docs` en dev). Les schémas Zod des requêtes vont dans `schemas/` pour être réutilisés par la doc.
- **Commentaires** : uniquement l'essentiel, c'est-à-dire le *pourquoi* non évident (sécurité, contournement, contrainte), en une ligne si possible. Pas de commentaire qui répète le code, pas de bandeau de section.
- **Nommage en anglais** : tables, colonnes, types, variables, fonctions, fichiers et routes (ex. `short_description`, `start_date`, `archetype_id`). Seuls les textes affichés (`messages/fr.json`) et les commentaires sont en français.
- Imports via l'alias `@/` (→ `src/`).

## Déploiement (Cloud Run)

- **CI sur chaque PR vers `main`** (`.github/workflows/ci.yml`, sans accès GCP) : le lint fait aussi respecter les règles du projet (couches, `getConfig()`, `z.strictObject`, textes dans `messages/fr.json`, console uniquement dans `logger.ts`), puis typecheck, `npm audit` et build. Les règles des migrations (jamais modifiées, `set role brb_admin;`, horodatage unique), de `openapi.ts` et de `.env.example` ne sont plus vérifiées par la CI : à contrôler en revue de PR. Actions GitHub épinglées par SHA.
- **Automatique** : chaque push sur `main` est déployé par GitHub Actions (`.github/workflows/deploy.yml`) sur https://brb-105103278561.europe-west9.run.app. Un `main` qui ne passe pas le lint ou le build n'est pas déployé (onglet *Actions* du repo pour suivre).
- Authentification GitHub → GCP sans clé ni secret GitHub : Workload Identity Federation (pool `github`, provider `github-repo`, limité à la branche `main` de ce repo) → compte de service `brb-deploy` (droits de déploiement uniquement).
- L'app tourne avec le compte de service `brb-run` (Cloud SQL en `brb_app`, Vertex AI, bucket des photos, lecture des secrets). Images dans Artifact Registry `europe-west9-docker.pkg.dev/biirb-511608/brb/web`.
- Variables : non sensibles dans `deploy.yml` (`--set-env-vars`) ; secrets (`JWT_SECRET`, `JWT_REFRESH_SECRET`, `BMC_WEBHOOK_SECRET`, `SMTP_PASSWORD`) dans **Secret Manager** (`brb-jwt-secret`, `brb-jwt-refresh-secret`, `brb-bmc-webhook-secret`, `brb-smtp-password`), jamais dans le repo ni dans GitHub. Nouvelle variable d'env = l'ajouter aussi dans `deploy.yml` (ou Secret Manager si elle est sensible).
- `APP_URL` (seule origine autorisée par CORS sur `/api/*`) est figée au build : argument du build Docker.
- `--max-instances=1` : les rate limits sont en mémoire, une seule instance les garde cohérents (et plafonne le coût).
- Les migrations ne sont pas lancées par le déploiement : les appliquer sur la base (Cloud SQL Studio) **avant** de merger le code qui en dépend.

## Architecture en couches (back) — à respecter

```
CLIENT / FRONTEND
   │  requête HTTP (ex. POST /api/v1/posts)
   ▼
CONTROLLER   app/api/v1/**/route.ts → server/controllers/, Server Components (pages)
   │  DTO (types inférés des schémas Zod)
   ▼
SERVICE      server/services/*.service.ts
   │  entités / paramètres de requête
   ▼
REPOSITORY   server/repositories/*.repository.ts
   │  pool `pg` (requêtes paramétrées $1, $2…)
   ▼
DATABASE     Cloud SQL (Postgres)
```

- **Controller** : valide la requête avec le schéma Zod (`schemas/`), extrait les données (params, body, searchParams), vérifie l'auth, appelle le service adapté, puis renvoie la réponse HTTP (200, 400, 401, 404…) avec un message générique en cas d'erreur. Aucune logique métier, aucun accès direct à la base.
- **Service** : contient la logique et les règles métier (calculs, transformations, vérification que l'utilisateur est propriétaire de la ressource, orchestration de plusieurs opérations). Sait *quoi* faire, pas *comment* c'est stocké : n'importe ni la base (`pg`, `server/infra/db`, `server/infra/storage`) ni rien de HTTP (`Request`, `NextResponse`, cookies, en-têtes).
- **Repository** : seul endroit qui parle à la base. Uniquement du CRUD en SQL paramétré (`$1`, `$2`… ; jamais de SQL concaténé avec une entrée), colonnes sélectionnées explicitement (jamais de hash ni de champ interne renvoyé vers le haut). Aucune règle métier.
- Les dépendances ne vont que vers le bas et sans sauter de couche : controller → service → repository → base. Un controller n'appelle jamais un repository directement ; un repository n'appelle jamais un service.
- Un fichier par ressource et par couche : `schemas/post.schema.ts`, `server/services/post.service.ts`, `server/repositories/post.repository.ts`.
- Les composants n'importent jamais `src/server` (règle ESLint) : un composant client passe par une route API, un composant serveur reçoit ses données d'une page.

## Internationalisation

- `next-intl`, français uniquement pour l'instant, sans préfixe de langue dans l'URL.
- Aucun texte visible par l'utilisateur en dur dans les composants : tout passe par `messages/fr.json`, via `getTranslations` (composants serveur) ou `useTranslations` (composants client). Une clé par namespace de page/composant (ex. `Metadata`, `Login`).

## Design system

- Dès qu'un même élément d'UI (bouton, champ, carte, badge, modal…) apparaît dans plusieurs composants, l'extraire dans `src/components/ui/` et réutiliser ce composant partout. Pas de duplication de classes Tailwind pour un même élément.
- Référence : design system « Kinetic Horizon » (maquettes Stitch). Thème clair uniquement.
- Couleurs, rayons et espacements passent par les tokens définis dans `src/app/globals.css` (`@theme`), pas par des valeurs codées en dur dispersées dans les composants.
- Avant de créer un composant, vérifier qu'un équivalent n'existe pas déjà dans `ui/`.

## Sécurité — contrôle absolu

La sécurité prime sur la rapidité de livraison. En cas de doute, demander plutôt que supposer. Signaler explicitement toute faille ou tout compromis rencontré, même hors du périmètre de la tâche.

### Must-have bootcamp (obligatoires avant la soutenance)

Seuls les must-have sont exigés : ne pas implémenter les nice-to-have (OAuth/OIDC, MFA, RBAC granulaire, API Gateway/WAF, chiffrement au repos, Dependabot/Snyk, centralisation des logs, etc.) sauf demande explicite.

1. **Authentification & autorisation** — JWT transmis dans l'en-tête `Authorization: Bearer <token>`. Vérification du token (signature + expiration, lib éprouvée comme `jose`) dans `src/proxy.ts` (le middleware de Next 16) pour les routes privées, **et** dans chaque route handler / Server Action qui touche des données privées. Vérifier que l'utilisateur est propriétaire de la ressource qu'il modifie. Secret JWT uniquement côté serveur. Access token JWT de **1 h**, gardé **en mémoire uniquement** côté navigateur (jamais dans localStorage / sessionStorage : un script injecté ne doit pas pouvoir le lire), + **refresh token** (30 jours avec « Se souvenir de moi », 24 h sinon) dans le cookie **`brb_refresh` HttpOnly, SameSite=Strict, Secure en prod, Path=/api/v1/auth** : en base uniquement son empreinte SHA-256 (table `refresh_token`), rotation à chaque refresh, réutilisation d'un token déjà utilisé = révocation de toute la session, déconnexion = révocation côté serveur + cookie effacé. À chaque chargement de page, `session.ts` récupère un access token via `/auth/refresh` (verrou entre onglets). Le stockage du navigateur ne contient que le profil affiché (`brb_user`, non secret).
2. **Endpoints API** — Rate limiting anti-bruteforce sur le login (et sur `/api/v1/chat`). CORS restreint à l'URL du frontend (variable d'env), jamais `*`. L'IP du client se lit **uniquement** via `clientIp()` (`src/server/rateLimit.ts`), qui prend l'entrée de `X-Forwarded-For` ajoutée par le proxy de confiance (`TRUSTED_PROXY_HOPS`) : jamais la première entrée, que le client peut inventer. Le login est aussi limité par compte visé (email).
3. **Données sensibles** — HTTPS/TLS en production. Mots de passe hachés avec **bcrypt**, salt rounds ≥ 10. Jamais de mot de passe en clair (ni en base, ni dans les logs, ni dans une réponse).
4. **Validation des entrées** — Schéma **Zod** en allowlist (`z.strictObject`, imposé par le lint dans `schemas/`) sur toutes les entrées serveur (body, params, searchParams) : tout champ inconnu ou mal typé est rejeté immédiatement.
5. **Dépendances** — `npm audit` avant mise en ligne : zéro vulnérabilité critique tolérée.
6. **Logs & zéro fuite technique** — Logs structurés côté serveur uniquement, via `src/server/logger.ts` (`logError` / `logInfo`, champ `severity` lu par Cloud Logging, erreurs regroupées dans Error Reporting) ; jamais `console.error` directement. Alertes Cloud Monitoring par email à l'équipe : site injoignable (vérification toutes les 5 min) et log de gravité ERROR (au plus un email par heure). Le client ne reçoit que des messages d'erreur génériques : jamais de stack trace, d'erreur SQL brute ou de détail interne. Message de login générique (« identifiants invalides »).
7. **CSRF** — Le JWT est envoyé via l'en-tête `Authorization`, jamais via un cookie : les routes de l'API ne lisent aucun cookie. Seule exception, validée : le cookie `brb_refresh`, lu uniquement par `/auth/refresh` et `/auth/logout`, protégé par SameSite=Strict **et** une vérification de l'en-tête `Origin` (403 si absent ou différent du site). Ne pas introduire d'autre cookie sans en discuter.
8. **Base de données** — Requêtes paramétrées obligatoires (ORM type Prisma ou driver préparé), jamais de SQL concaténé avec des entrées utilisateur. Utilisateur DB avec droits restreints.
9. **Durcissement serveur** — En-têtes HTTP de sécurité (équivalent Helmet, via `headers()` dans `next.config.ts` : CSP, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, HSTS). Si Docker : conteneur exécuté en utilisateur **non-root**. En place dans `next.config.ts` (`securityHeaders`, `poweredByHeader: false`) : toute nouvelle ressource externe (image, script, API) doit y être ajoutée à la CSP.
10. **Audit avant soutenance** — Repasser cette checklist point par point et tester l'injection d'erreurs (entrées invalides, token absent/expiré/falsifié, champs inconnus, SQL/XSS) avant la soutenance du vendredi.

### Règles complémentaires
- **Variables sensibles : toujours dans le `.env` (`.env.local`, ignoré par git), jamais en dur dans le code.** Sont sensibles :
  - les **secrets** : clés et mots de passe (`JWT_SECRET`, `JWT_REFRESH_SECRET`, future clé Gemini…) ; la base Cloud SQL n'en a pas (authentification IAM) ;
  - les **réglages de sécurité** : durée du token (`JWT_EXPIRES_IN`) et des sessions (`REFRESH_TOKEN_*`), coût bcrypt (`BCRYPT_SALT_ROUNDS`), rate limits (`RATE_LIMIT_*`), et tout nouveau réglage du même type (URL autorisée par CORS…).
  Les secrets sont lus côté serveur uniquement : jamais dans une variable `NEXT_PUBLIC_*`, ni dans un composant `"use client"`, ni dans un log, une réponse d'API ou un commit. Une valeur de secret ne doit jamais apparaître dans le code, même en valeur par défaut.
  Restent dans le code (pas dans le `.env`) : les limites de données qui doivent rester identiques aux contraintes SQL de `db/migrations/` (longueur du titre, des descriptions, taille max de la photo, nombre de tags…).
- Toute variable d'environnement lue par l'app ou un script est listée dans `.env.example` (seul fichier `.env*` versionné) avec une valeur d'exemple, à quoi elle sert et quel fichier la lit. Jamais de vraie valeur dedans. Côté serveur, on les lit uniquement via `getConfig()` (`src/server/config.ts`), jamais `process.env` directement (sauf `NODE_ENV` et les scripts de `scripts/`). Un réglage de sécurité peut avoir une valeur par défaut sûre dans `config.ts` ; un secret, jamais (variable obligatoire, validée par Zod).
- Ne jamais renvoyer au client plus de données que nécessaire (pas de hash, pas de champs internes).
- Pas de `dangerouslySetInnerHTML` sur du contenu utilisateur.
- Chat RAG : traiter la question utilisateur et le contenu des posts comme non fiables (injection de prompt), limiter la taille des entrées.
- **Nom de l'IA dans l'interface : « Biirbou »** (Biirb + hibou, la mascotte ; nom propre masculin sans article : « Générer avec Biirbou », « Biirbou réfléchit… »). Jamais « l'IA » ni « Gemini » dans `messages/fr.json`.
- IA (planificateur, chat) : Gemini via Vertex AI (`src/server/infra/ai.ts`), authentifié par IAM comme la base : aucune clé API (variables `GCP_PROJECT_ID`, `VERTEX_LOCATION`). Réponse du modèle = donnée non fiable, toujours revalidée par Zod. Tout appel à l'IA passe d'abord par `consumeAiCall` (`ai-quota.service.ts`) : **15 appels par jour et par utilisateur** (`AI_DAILY_LIMIT_PER_USER`, limites horaires `RATE_LIMIT_TRIP_AI_*` et `RATE_LIMIT_TRIP_CHAT_*` dans le .env ; admins illimités, compteur en base `ai_usage`, jour de Paris), plafond global et interrupteur réglables par l'admin (`app_settings`), compte banni refusé.
- Planificateur : départ à n'importe quelle date future, durée de 3 mois maximum **à partir du départ choisi** (`TRIP_MAX_DAYS` = 92 jours ; au-delà de 31 jours, journées moins détaillées pour tenir dans le temps de réponse de l'IA). La génération tient compte de la saison (mois du voyage) : météo moyenne, risques (typhons, mousson…), affluence et prix, résumés dans `trip.season_note`. **Plusieurs étapes** (1 à 8 pays, régions ou villes : `trip_destination`, la première reste `trip.destination_*`) : le serveur les range selon le trajet le plus court (coordonnées de country-state-city, toutes les permutations testées) avant de les envoyer à l'IA, qui suit cet ordre (ou l'inverse) sauf ordre imposé par les envies ; récits sélectionnés à tour de rôle par étape. **Envies du voyageur** (`trip.instructions`, 1000 caractères, facultatives, réutilisées à chaque génération et dans la discussion) : donnée non fiable, mêmes barrières que la discussion (`ATTACK_PATTERNS` → 400 `INSTRUCTIONS_REJECTED` sans appeler l'IA, balise `<envies>` = données, `INSTRUCTION_MARKERS` sur le planning produit) ; un titre recopié d'un récit est remplacé. **Nombre de voyageurs** (`trip.traveler_count`, 1 à `TRIP_MAX_TRAVELERS`) : budget pour tout le groupe, hébergement et rythme adaptés. **Carte** : un repère par ville **citée dans le planning** (`findCitiesInText` : villes des pays du voyage dans country-state-city, nom propre avec majuscule, 4 lettres minimum, liste de mots courants exclus), avec ses jours sur place (un jour sans ville citée reste dans la dernière ville) ; recalculée à chaque lecture, donc à jour après toute modification. À défaut : séjours donnés par l'IA à la génération (`trip_stop`, coordonnées toujours calculées par le serveur), puis étapes choisies sans dates. Bulle : nom de la ville et dates seulement, insérés comme texte.
- **Modération** (`moderation.service.ts`, `server/moderationFilter.ts`) : **texte** (récits et commentaires) vérifié sans IA par une liste de mots bannis (injures, haine, sexuel explicite, appels à voter ; leet et séparateurs décodés) ; les avis négatifs et jurons d'exclamation restent autorisés. **Photo** d'un récit vérifiée par Gemini, réduite à 384 px (coût minimal). Refus → rien n'est enregistré ; l'auteur voit seulement « ne respecte pas les règles » (motif dans les logs serveur, pour ne pas dévoiler la liste). IA coupée ou en panne → récit publié masqué en attente de validation admin (`pending_review`, non réaffichable par l'auteur).
- **Mot de passe oublié** : email via **Gmail en SMTP** (`server/infra/mailer.ts`, nodemailer, TLS 465, mot de passe d'application `SMTP_PASSWORD`, jamais celui du compte ; config `getMailConfig()` validée à part : absente ou invalide, seuls les emails sont coupés). Réponse identique (202, au moins 2 s) que le compte existe ou non ; rate limit par IP **et** par email visé. Lien construit **uniquement** avec `APP_URL` en production (jamais l'en-tête Host), code dans le fragment `#token=` (absent des logs d'accès), 32 octets aléatoires, seule l'empreinte SHA-256 en base (`password_reset_token`), usage unique, `PASSWORD_RESET_TTL_MINUTES`, un seul lien ouvert par compte. Reset : bcrypt, toutes les sessions révoquées ; jamais pour un compte banni. Mail en texte brut (`messages/fr.json`), aucun HTML.
- **Tickets de support** (`support_ticket`) : ouverts par un utilisateur connecté non banni (sujet 3–120, message 10–2000 caractères, `RATE_LIMIT_TICKET_*`), visibles par leur auteur et les admins uniquement. État `open` → `in_progress` → `resolved`, changé uniquement par un admin (onglet Tickets, inscrit au journal `admin_action`). Le texte d'un ticket n'est jamais modifié.
- **Support** (`support_ticket`) : catégorie obligatoire (`TICKET_CATEGORIES` : trip_pass, bug, report, account, other). `trip_pass` envoie un email à tous les admins actifs (un par admin, texte fixe sans le message de l'utilisateur, jamais bloquant pour le ticket). Le lien support de la fenêtre du pass pré-remplit la demande (`/support?topic=trip_pass&trip=<uuid>`).
- **Commentaires** (`post_comment`) : lecture publique (exception GET dans `proxy.ts`), écriture réservée aux connectés non bannis, filtrés par la liste de mots bannis. Fils à un seul niveau (`parent_id` : on répond à un commentaire principal, pas à une réponse). Suppression par l'auteur ou un admin (journal).
- **Administration** : seul le rôle `admin` donne des droits ; les autres rôles sont des badges. Le rôle est **relu en base à chaque requête** (`requireAdmin`), jamais lu dans le JWT ni dans la session du navigateur (le lien « Administration » de la Navbar n'est qu'un affichage). Un admin ne peut ni se rétrograder, ni se bannir, ni se supprimer, ni bannir / supprimer un autre admin sans l'avoir rétrogradé. Toute action admin modifiante est inscrite au journal `admin_action`. La liste des utilisateurs de l'admin n'expose jamais d'email ni de hash.
- **Bannissement** : connexion refusée (`ACCOUNT_BANNED`, révélé seulement après un mot de passe correct), refresh refusé, sessions révoquées ; l'access token en cours reste valide au plus 1 h, mais l'IA, les signalements et l'admin relisent le compte en base.
- Discussion IA d'un voyage (`/trips/[id]/messages`) : enthousiaste pour toute envie liée au voyage (l'IA cherche où et quand la caser), impassible sur le reste. Trois barrières contre l'injection (`trip.service.ts`) : 1) filtre d'entrée déterministe (`ATTACK_PATTERNS` : « ignore tes instructions », jailbreak, balises / champs du prompt…) → refus sans appeler l'IA ; 2) consignes du modèle (contenu utilisateur = données, règles confidentielles, illégal refusé) ; 3) filtre de sortie (`INSTRUCTION_MARKERS`) → une réponse qui laisse fuiter les consignes est bloquée. Tout changement du prompt se vérifie avec une batterie d'attaques (injection directe, via un récit, jailbreak, fuite, données d'autres utilisateurs). Hors sujet non renvoyé dans l'historique, message ≤ 500 caractères, historique court, 30 messages/heure/utilisateur et 50 par voyage. L'IA peut proposer d'ajouter, de modifier ou de supprimer une activité (`trip_suggestion.action`, `target_item_id` : id lu dans le planning du prompt, revérifié comme appartenant au voyage) ; rien ne change sans un « oui » de l'utilisateur, proposition par proposition (activité disparue entre-temps → 409 `SUGGESTION_OUTDATED`).
- **Identifiant d'un voyage** : la clé `trip.id` (entier) reste interne aux clés étrangères et ne sort jamais du serveur ; URL, API, admin et support utilisent `trip.public_id` (UUID, `tripIdParamSchema`), converti au début de chaque controller par `resolveTripId` (inconnu → 404).
- **Voyages partagés** : le propriétaire (`trip.user_id`) invite par pseudo exact (acceptation requise) ou par lien (`/planner/join#<code>`, 7 jours, réutilisable, révocable ; seule l'empreinte SHA-256 du code est stockée). **10 voyageurs maximum** par voyage (`TRIP_MAX_TRAVELERS` : propriétaire + membres + participants sans compte), vérifié dans la même transaction que l'ajout (verrou sur le voyage), 409 `TRIP_FULL`. Rôles : `owner` (tout, dont supprimer le voyage et gérer les membres), `editor` (planning, dépenses, discussion IA, sur son propre quota), `viewer` (consultation ; ne saisit et ne modifie que ses propres dépenses). Droits vérifiés par `requireTripRole` (`trip-access.service.ts`) dans chaque service : pas d'accès → 404, accès insuffisant → 403.
- **Dépenses (Tricount)** : participants = comptes du voyage + invités sans compte. Montants en unités mineures de leur devise (0 décimale : JPY, KRW, ISK) ; conversion dans la devise du voyage au taux BCE du jour de la dépense (`server/infra/exchangeRates.ts`, API Frankfurter, sans clé), **taux figé** à la saisie. Parts calculées au centime (plus forts restes, somme exacte). Équilibrage = minimum de virements ; « marquer comme remboursé » crée une dépense de remboursement. Devise du voyage modifiable tant qu'aucune dépense n'existe.
- **Consentements** (`src/lib/legal.ts`, pages `/legal/{terms,sales,notice,privacy}`, textes dans `messages/fr.json` → `Legal`) : CGU à l'inscription (`users.terms_version` / `terms_accepted_at`), CGV + renonciation au droit de rétractation avant le lien de paiement du pass (commande, puis copiés dans `trip_pass`). Cases jamais pré-cochées, exigées par le schéma Zod côté serveur. Changer un texte = changer sa version dans `LEGAL_VERSIONS`. `LEGAL_DRAFT` affiche un bandeau tant que les textes ne sont pas validés.
- **Pass voyage** (9,99 € par défaut, `BMC_TRIP_PASS_*`) : article « Extra » Buy Me a Coffee, **par voyage**, profite à tous ses membres. Le propriétaire commande (`trip_pass_order`, 24 h, une par compte) puis paie avec l'email de son compte ; le webhook signé `extra_purchase.created` (bon article, montant ≥ prix, en euros) crée le `trip_pass` ; `extra_purchase.refunded` le retire. Le lien de paiement n'apparaît qu'après avoir confirmé payer avec l'email du compte. Achat sans compte ou sans commande : gardé « à rattacher » (`trip_id` null, jamais perdu) ; email du paiement jamais en clair (empreinte HMAC + aperçu masqué). L'admin (onglet Pass voyage) rattache un achat seulement si l'email déclaré par l'acheteur correspond à l'empreinte, offre ou retire un pass (journal). Débloque : quota IA plus haut sur ce voyage (`AI_DAILY_LIMIT_TRIP_PASS`, 100 par jour) et discussion de 200 messages, re-générer un jour, export PDF et .ics, liens Google Maps par jour. Le pass est **toujours vérifié côté serveur** (`requireTripPass`, 402 `PASS_REQUIRED`) : l'interface ne fait qu'afficher. Le rôle mécène reste réservé aux dons.
- **Hors ligne (PWA)** : `public/sw.js` (production uniquement) met en cache les pages `/planner*`, les GET `/api/v1/trips*` et les fichiers `/_next/static` ; consultation seule. Pages et données ne sont gardées qu'avec « Se souvenir de moi » (repère `brb-remembered` posé par `session.ts`, sinon purgées et jamais servies) ; vidées à la déconnexion et au changement de compte.

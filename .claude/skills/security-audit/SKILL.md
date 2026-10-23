---
name: security-audit
description: Audit de sécurité du projet Biirb (security-auditor). Analyse le code source, cartographie les vulnérabilités selon l'OWASP Top 10 (2021) et les CWE, vérifie les 10 règles de sécurité de CLAUDE.md, scanne les dépendances (npm audit, pip-audit s'il y a du Python), puis génère un rapport avec un score sur 10 et des correctifs proposés. À utiliser quand on demande un audit de sécurité, une revue de sécurité ou un score de sécurité.
---

# Audit de sécurité (security-auditor)

Tu réalises un audit de sécurité **en lecture seule** du dépôt. Tu ne modifies aucun fichier : tu proposes des correctifs, l'utilisateur décide de les appliquer.

## Règles absolues

- **Ne jamais afficher la valeur d'un secret** : ne pas lire ni citer le contenu de `.env.local` ou de tout `.env*` autre que `.env.example`. Pour vérifier qu'un secret existe, regarder seulement le nom de la variable.
- **Ne rien modifier** (code, base, dépendances) pendant l'audit. Pas de `npm audit fix`, pas de `npm install`.
- **Tests dynamiques seulement sur un serveur local** (`next start` sur un port libre) et seulement si l'utilisateur l'accepte. **Jamais contre la production** (`*.run.app`). Toute donnée de test créée en base est supprimée à la fin.
- **Chaque constat est prouvé** : chemin `fichier:ligne` et extrait de code, ou sortie de commande. Pas de supposition présentée comme un fait ; une hypothèse non vérifiée est marquée « à confirmer ».
- Ne pas signaler comme faille un compromis **déjà documenté et assumé** dans `CLAUDE.md` (ex. cookie `brb_refresh`, rate limit en mémoire avec `--max-instances=1`) : le citer dans « Compromis connus ».

## Étape 1 — Cartographier la surface d'attaque

Lister, avec leur emplacement :

| Zone | Où regarder |
|---|---|
| Entrées HTTP | `src/app/api/v1/**/route.ts` → `src/server/controllers/` ; pages qui lisent `params` / `searchParams` dans `src/app/**/page.tsx` |
| Authentification | `src/proxy.ts` (matcher + exceptions publiques), `src/server/jwt.ts`, `auth.controller.ts`, `auth.service.ts`, `src/client/session.ts` |
| Autorisation | services (propriétaire de la ressource, `requireAdmin`, `requireTripRole`) |
| Validation | `src/schemas/*.schema.ts` (`z.strictObject`) |
| Base de données | `src/server/repositories/`, `src/server/infra/db.ts`, droits `brb_app` dans `db/migrations/` |
| Secrets et config | `src/server/config.ts`, `.env.example`, `.github/workflows/deploy.yml` |
| En-têtes, CORS, CSP | `next.config.ts` |
| Rate limiting | `src/server/rateLimit.ts` et ses appels dans les controllers |
| Fichiers envoyés | `src/server/images.ts`, routes multipart |
| IA (injection de prompt) | `src/server/infra/ai.ts`, `trip.service.ts`, `moderation.service.ts` |
| Webhooks, paiements, emails | controllers et services correspondants |
| Conteneur et CI/CD | `Dockerfile` (`USER`), `.github/workflows/` (actions épinglées par SHA, permissions, secrets) |

## Étape 2 — Analyser selon l'OWASP Top 10 (2021)

Pour chaque catégorie, chercher activement et noter ce qui est **conforme** comme ce qui ne l'est pas.

| OWASP | CWE principaux | Ce qu'il faut vérifier ici |
|---|---|---|
| **A01 Contrôle d'accès** | CWE-284, 285, 639 (IDOR), 352 (CSRF) | Toute route privée vérifie le token dans `proxy.ts` **et** dans le controller ; chaque service vérifie le propriétaire (404 si ressource d'autrui) ; rôle admin relu en base ; aucune route publique ne renvoie de données privées ; CSRF : API authentifiée par en-tête `Authorization`, seul cookie protégé par SameSite=Strict + contrôle de `Origin`. |
| **A02 Défaillances cryptographiques** | CWE-327, 328, 916, 319 | bcrypt avec coût ≥ 10 ; JWT signé avec algorithme imposé (`algorithms: ["HS256"]`), secret ≥ 32 caractères ; tokens stockés en empreinte SHA-256 ; HSTS en production ; aucun secret dans le code ni en valeur par défaut. |
| **A03 Injection** | CWE-89 (SQL), 79 (XSS), 77/78 (commande), 1336 (prompt) | Toutes les requêtes SQL paramétrées (`$1`), noms de colonnes dynamiques issus de listes fixes ; aucun `dangerouslySetInnerHTML` sur du contenu utilisateur ; aucune exécution de commande avec une entrée ; contenu utilisateur traité comme donnée dans les prompts, sortie de l'IA revalidée par Zod. |
| **A04 Conception non sécurisée** | CWE-840, 799, 770 | Rate limiting sur login (par IP et par email), inscription, IA, commentaires… ; quotas IA ; limites de taille des entrées ; messages génériques (pas d'énumération de comptes). |
| **A05 Mauvaise configuration** | CWE-16, 693, 1021, 942 | CSP, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, HSTS, pas de `X-Powered-By` ; CORS limité à `APP_URL`, jamais `*` ; Swagger désactivé en production ; conteneur non-root ; erreurs génériques côté client. |
| **A06 Composants vulnérables** | CWE-1104, 1395 | Résultat de l'étape 3. |
| **A07 Identification et authentification** | CWE-287, 307, 384, 613, 640 | Anti-bruteforce, comparaison à temps constant (faux hash si compte inconnu), expiration des tokens, rotation du refresh token et détection de réutilisation, révocation à la déconnexion et au changement de mot de passe, liens de réinitialisation à usage unique et expirants. |
| **A08 Intégrité des logiciels et données** | CWE-345, 494, 829 | Signature des webhooks vérifiée (temps constant) ; actions GitHub épinglées par SHA ; `package-lock.json` versionné ; aucune ressource externe non listée dans la CSP. |
| **A09 Journalisation et surveillance** | CWE-778, 532, 209 | Logs structurés via `logger.ts` uniquement (le lint interdit `console`) ; aucun mot de passe, token, email ou stack trace dans les logs ou les réponses ; actions admin journalisées. |
| **A10 SSRF** | CWE-918 | Tout `fetch` côté serveur vers une URL construite à partir d'une entrée utilisateur ; les URL externes doivent être fixes (ex. API de taux de change). |

Commandes utiles (à adapter) :

```bash
grep -rn "dangerouslySetInnerHTML\|eval(\|new Function(" src
grep -rnE "query\(\s*\`[^\`]*\\$\{" src/server/repositories   # SQL interpolé (à examiner un par un)
grep -rn "process\.env\." src --include='*.ts' --include='*.tsx' | grep -v "NODE_ENV" | grep -v "server/config.ts"
grep -rn "NEXT_PUBLIC_" src .env.example
grep -rn "z\.object(" src/schemas                               # doit être z.strictObject
grep -rn "fetch(" src/server                                     # SSRF : l'URL dépend-elle d'une entrée ?
```

## Étape 3 — Scanner les dépendances

```bash
npm audit --omit=dev            # dépendances de production : ce qui part en ligne
npm audit                       # tout, y compris l'outillage de développement
```

- S'il existe du Python (`requirements*.txt`, `pyproject.toml`) : `pip-audit -r requirements.txt` (ou `pip-audit` dans le projet). Sinon, l'indiquer : « pas de Python, pip-audit non applicable ».
- Classer par gravité (critique, élevée, modérée, faible) et distinguer **production** et **développement**. Règle de CLAUDE.md : zéro vulnérabilité critique tolérée.
- Pour chaque vulnérabilité : paquet, version installée, version corrigée, chemin de dépendance, et si `npm audit fix` la corrige sans changement majeur.

## Étape 4 — Vérifier les 10 règles de CLAUDE.md

Reprendre la section « Sécurité — contrôle absolu » de `CLAUDE.md` et donner pour chaque règle : ✅ conforme / ⚠️ partiel / ❌ non conforme, avec la preuve.

## Étape 5 — Tests dynamiques (optionnels, avec accord)

Si l'utilisateur l'accepte, lancer `npm run build` puis `next start -p <port libre>` et tester : routes privées sans token / token falsifié, expiré, `alg: none` → 401 ; routes admin avec un compte simple → 403 ; ressource d'autrui → 404 ; champs inconnus et JSON cassé → 400 ; injections SQL et XSS ; CSRF sur refresh / logout depuis une autre origine → 403 ; CORS ; en-têtes. Nettoyer toutes les données créées, arrêter le serveur.

## Étape 6 — Calculer le score sur 10

Partir de **10** et retirer, par constat confirmé (les « à confirmer » ne comptent pas) :

| Gravité | Exemples | Retrait |
|---|---|---|
| Critique | Injection SQL exploitable, contournement d'authentification, secret exposé, RCE | −3 |
| Élevée | IDOR, XSS stockée, absence de rate limit sur le login, dépendance de production critique | −1,5 |
| Moyenne | En-tête de sécurité manquant, message d'erreur trop détaillé, dépendance de production élevée | −0,5 |
| Faible | Durcissement possible, bonne pratique non suivie sans impact direct | −0,1 |

Plancher à 0. Arrondir à 0,5 près. Si au moins un constat **critique** existe, le score ne peut pas dépasser **4/10**.

## Étape 7 — Rapport

Rédiger en français, dans ce format :

```markdown
# Audit de sécurité — <date> — branche <branche> (<commit>)

## Score : X / 10
<une phrase de synthèse>

## Constats
| # | Gravité | OWASP | CWE | Emplacement | Problème | Correctif proposé |
|---|---|---|---|---|---|---|
| 1 | Élevée | A01 | CWE-639 | src/server/services/x.service.ts:42 | … | … |

## Les 10 règles de CLAUDE.md
| # | Règle | Statut | Preuve |

## Dépendances
| Paquet | Version | Gravité | Prod / dev | Corrigé en | Commande |

## Compromis connus (documentés dans CLAUDE.md, non comptés)

## Points forts

## Correctifs prioritaires
1. … (le plus grave d'abord, avec le diff proposé)
```

Les correctifs sont des **propositions** (diff ou extrait de code) qui respectent l'architecture du projet (controller → service → repository, `getConfig()`, `z.strictObject`, textes dans `messages/fr.json`). Terminer en demandant à l'utilisateur lesquels appliquer.

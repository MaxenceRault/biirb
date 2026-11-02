import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Règles du projet (CLAUDE.md), vérifiées par le lint et donc par la CI.
const processEnv = {
  selector: "MemberExpression[object.object.name='process'][object.property.name='env'][property.name!='NODE_ENV']",
  message: "Variables d'environnement : passer par getConfig() (src/server/config.ts)",
};
// Séparation par lieu d'exécution : src/server (serveur uniquement), src/client (navigateur), src/lib (partagé).
const noClient = { group: ["@/client/*", "@/client/**"], message: "Le serveur n'importe pas le code navigateur (src/client)" };
const noServer = {
  group: ["@/server/*", "@/server/**"],
  message: "Code navigateur ou partagé : jamais de code serveur (secrets, base) — passer par une route d'API ou une page serveur",
};
const zodObject = {
  selector: "CallExpression[callee.object.name='z'][callee.property.name='object']",
  message: "Utiliser z.strictObject() : allowlist, tout champ inconnu est rejeté",
};

const confirmMessage = "Confirmation : useConfirm() (components/ui/ConfirmDialog.tsx), pas window.confirm";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**"],
    ignores: ["src/server/config.ts"],
    rules: {
      "no-restricted-syntax": ["error", processEnv],
      // Logs via src/server/logger.ts uniquement (format Cloud Logging / Error Reporting).
      "no-console": "error",
      // Textes affichés dans messages/fr.json ; seule la ponctuation reste en dur.
      "react/jsx-no-literals": ["error", { ignoreProps: true, allowedStrings: ["•", "·", "@", "/", "#", ":", "—", "→"] }],
      // Confirmations dans la fenêtre du design system (useConfirm, components/ui/ConfirmDialog.tsx), jamais la boîte native.
      "no-restricted-properties": ["error", { object: "window", property: "confirm", message: confirmMessage }],
      "no-restricted-globals": ["error", { name: "confirm", message: confirmMessage }],
    },
  },
  {
    // Le logger structuré : seul fichier qui écrit dans la console.
    files: ["src/server/logger.ts"],
    rules: { "no-console": "off" },
  },
  {
    // Répète processEnv : un bloc plus bas remplace la règle, il ne s'y ajoute pas.
    files: ["src/schemas/**"],
    rules: { "no-restricted-syntax": ["error", processEnv, zodObject] },
  },
  // Serveur : jamais de code navigateur (répété dans chaque bloc ci-dessous : un bloc plus bas remplace la règle).
  {
    files: ["src/server/**"],
    rules: { "no-restricted-imports": ["error", { patterns: [noClient] }] },
  },
  // Couches : controller → service → repository → base, sans en sauter.
  {
    files: ["src/server/services/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/server/infra/db", "@/server/infra/storage", "pg", "next/server", "next/headers"],
              message: "Pas de base ni de HTTP dans un service",
            },
            { group: ["@/server/controllers/*"], message: "Un service n'appelle pas un controller" },
            noClient,
          ],
        },
      ],
    },
  },
  {
    files: ["src/server/controllers/**", "src/app/**", "src/proxy.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@/server/repositories/*", "@/server/infra/db", "@/server/infra/storage"], message: "Passer par un service" },
            noClient,
          ],
        },
      ],
    },
  },
  {
    files: ["src/server/repositories/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@/server/services/*", "@/server/controllers/*"], message: "Un repository n'appelle que la base" },
            noClient,
          ],
        },
      ],
    },
  },
  // Navigateur (composants, src/client) : jamais de code serveur, même par un composant serveur (données passées en props).
  {
    files: ["src/components/**", "src/client/**"],
    rules: { "no-restricted-imports": ["error", { patterns: [noServer] }] },
  },
  // Partagé (src/lib) : ni serveur ni navigateur, utilisable des deux côtés.
  {
    files: ["src/lib/**"],
    rules: { "no-restricted-imports": ["error", { patterns: [noServer, noClient] }] },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Worker de la carte copié depuis node_modules (scripts/copy-maplibre-worker.mjs).
    "public/maplibre/**",
  ]),
]);

export default eslintConfig;

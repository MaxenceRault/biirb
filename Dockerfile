# Étapes : « dev » (compose.yaml) et production pour Cloud Run (dernière étape). Toujours en utilisateur non-root.

# --- Dev : le code est monté depuis la machine (compose.yaml).
FROM node:22-alpine AS dev
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Volumes créés ici pour appartenir à « node ».
RUN mkdir -p /app/node_modules /app/.next && chown -R node:node /app
USER node
EXPOSE 3000
CMD ["sh", "-c", "npm install --no-audit --no-fund && npm run dev -- --hostname 0.0.0.0"]

# --- Dépendances
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- Build
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Figée dans le build (CORS de next.config.ts).
ARG APP_URL
ENV APP_URL=$APP_URL
# Figée dans la page statique (balise Umami du layout). Vide : pas de mesure d'audience.
ARG UMAMI_WEBSITE_ID
ENV UMAMI_WEBSITE_ID=$UMAMI_WEBSITE_ID
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# --- Production
FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=8080

COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static

USER node
EXPOSE 8080
CMD ["node", "server.js"]

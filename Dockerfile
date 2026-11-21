# [GOOGLE SERVICES][EFFICIENCY][SECURITY] Two-stage build for Google Cloud Run: the final image holds only the
# standalone Next.js server (no dev dependencies, no source), so it stays small
# and cold starts are fast. No secrets are baked in: GEMINI_API_KEY and
# ADMIN_PASSCODE are injected as Cloud Run environment variables at deploy time.
FROM node:24-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-slim
WORKDIR /app
# Cloud Run sends traffic to $PORT (8080 by default).
ENV NODE_ENV=production PORT=8080 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 8080
CMD ["node", "server.js"]

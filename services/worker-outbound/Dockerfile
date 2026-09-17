# DuLabs Developer V1 -- Fase 3. Build desde la RAIZ del repo:
#   gcloud builds submit --tag <imagen> -f services/worker-outbound/Dockerfile .
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY lib/developer ./lib/developer
COPY services ./services
ENV NODE_ENV=production
EXPOSE 8080
# Fase 18 (container hardening): usuario no-root (`node`, uid 1000). Runtime de
# solo lectura (HTTP + Supabase; tsx transpila en memoria). Verificar build/smoke.
USER node
CMD ["node_modules/.bin/tsx", "services/worker-outbound/index.ts"]

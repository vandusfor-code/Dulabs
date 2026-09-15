# DuLabs Developer V1 -- Fase 3. Build desde la RAIZ del repo (necesita
# lib/developer/** vía el alias @/* del tsconfig raíz):
#   gcloud builds submit --tag <imagen> -f services/gateway/Dockerfile .
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY lib/developer ./lib/developer
# Fase 4 (autorizado, RATE LIMITING) -- lib/rate-limit.ts vive fuera de
# lib/developer/ (es el mecanismo genérico ya usado por Business, Fase 11)
# -- el Gateway lo reusa sin duplicarlo, así que necesita copiarse acá
# también. Ningún otro servicio (Workers/Reconciliation) lo necesita.
COPY lib/rate-limit.ts ./lib/rate-limit.ts
COPY services ./services
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node_modules/.bin/tsx", "services/gateway/index.ts"]

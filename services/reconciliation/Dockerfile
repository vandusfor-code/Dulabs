# DuLabs Developer V1 -- Fase 3. Cloud Run Job (no expone puerto). Build
# desde la RAIZ del repo:
#   gcloud builds submit --tag <imagen> -f services/reconciliation/Dockerfile .
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY lib/developer ./lib/developer
COPY services ./services
ENV NODE_ENV=production
CMD ["node_modules/.bin/tsx", "services/reconciliation/index.ts"]

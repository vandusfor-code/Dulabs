# DuLabs Developer V1 -- Fase 3. Build desde la RAIZ del repo:
#   gcloud builds submit --tag <imagen> -f services/worker-inbound/Dockerfile .
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY lib/developer ./lib/developer
COPY services ./services
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node_modules/.bin/tsx", "services/worker-inbound/index.ts"]

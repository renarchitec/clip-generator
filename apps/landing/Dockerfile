# syntax=docker/dockerfile:1
# Build context: repository root. docker build -f apps/landing/Dockerfile -t clipper-landing .
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS pruner
COPY . .
RUN pnpm dlx turbo@2.11.11 prune @clipper/landing --docker

FROM base AS deps
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile

FROM deps AS builder
ARG VITE_UMAMI_WEBSITE_ID=""
ARG VITE_UMAMI_SCRIPT_URL=""
ENV VITE_UMAMI_WEBSITE_ID=$VITE_UMAMI_WEBSITE_ID
ENV VITE_UMAMI_SCRIPT_URL=$VITE_UMAMI_SCRIPT_URL
COPY --from=pruner /app/out/full/ .
RUN pnpm --filter @clipper/landing build

FROM nginx:1.27-alpine AS runner
COPY apps/landing/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/landing/docker-entrypoint.d/40-runtime-config.sh /docker-entrypoint.d/40-runtime-config.sh
RUN chmod +x /docker-entrypoint.d/40-runtime-config.sh
COPY --from=builder /app/apps/landing/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

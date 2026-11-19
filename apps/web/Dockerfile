# syntax=docker/dockerfile:1
# Build context: repository root. docker build -f apps/web/Dockerfile -t clipper-web .
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS pruner
COPY . .
RUN pnpm dlx turbo@2.11.11 prune web --docker

FROM base AS deps
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile

FROM deps AS builder
COPY --from=pruner /app/out/full/ .
RUN pnpm --filter web build

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app
COPY --from=builder /app/ .
EXPOSE 3000
CMD ["sh", "-c", "pnpm --filter web start"]

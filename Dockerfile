FROM node:24-bookworm-slim

ENV NEXT_TELEMETRY_DISABLED=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    g++ \
    python3 \
    default-jdk-headless \
    tini \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Keep dependency install cache stable first.
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY scripts ./scripts
COPY prisma.config.ts ./

RUN npm ci --include=dev

COPY . .

RUN npm run db:generate \
  && npm run build

ENV NODE_ENV=production

EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "npm run start -- --hostname 0.0.0.0 --port ${PORT:-3000}"]

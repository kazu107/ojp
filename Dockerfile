FROM node:24-bookworm-slim

ENV NEXT_TELEMETRY_DISABLED=1

# Use the official Node image's bundled trust roots before Debian's CA package
# is present. Bound mirror timeouts so a stalled fetch cannot block deployment.
RUN node -e 'require("node:fs").writeFileSync("/tmp/apt-ca.pem", require("node:tls").rootCertificates.join("\n") + "\n")' \
  && sed -i 's|http://deb.debian.org/|https://deb.debian.org/|g' /etc/apt/sources.list.d/debian.sources \
  && printf '%s\n' 'Acquire::https::CaInfo "/tmp/apt-ca.pem";' 'Acquire::https::Timeout "25";' 'Acquire::Retries "2";' 'Acquire::ForceIPv4 "true";' >/etc/apt/apt.conf.d/99-ojp-build \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    g++ \
    gcc \
    rustc \
    golang-go \
    ruby \
    kotlin \
    mono-mcs \
    mono-runtime \
    libmono-system-numerics4.0-cil \
    pypy3 \
    python3 \
    default-jdk-headless \
    bubblewrap \
    util-linux \
    time \
    tini \
  && rm -f /etc/apt/apt.conf.d/99-ojp-build /tmp/apt-ca.pem \
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
  && STORE_DB_SYNC=0 npm run build

ENV NODE_ENV=production

EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "npm run start -- --hostname 0.0.0.0 --port ${PORT:-3000}"]

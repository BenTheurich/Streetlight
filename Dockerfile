FROM node:24.15.0-trixie-slim

ENV NEXT_TELEMETRY_DISABLED=1 \
    PLAYWRIGHT_BROWSERS_PATH=/opt/playwright \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    STREETLIGHT_PYTHON=/opt/importer/bin/python

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates python3 python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/importer \
    && npm install --global pnpm@10.27.0

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json ./web/package.json
RUN pnpm install --frozen-lockfile
COPY web/importer/requirements.txt ./web/importer/requirements.txt
RUN /opt/importer/bin/pip install --no-cache-dir -r web/importer/requirements.txt \
    && pnpm --dir web exec playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/*

COPY web ./web
COPY scripts ./scripts

# AuthKit reads this public URL from the compiled server bundle.
ARG NEXT_PUBLIC_WORKOS_REDIRECT_URI
ENV NEXT_PUBLIC_WORKOS_REDIRECT_URI=$NEXT_PUBLIC_WORKOS_REDIRECT_URI
RUN pnpm build

RUN mkdir -p /data && chown node:node /data \
    && chown -R node:node /app/web/.next

ENV NODE_ENV=production \
    PORT=3000 \
    STREETLIGHT_DATABASE_PATH=/data/streetlight.db
WORKDIR /app/web
USER node
EXPOSE 3000
CMD ["sh", "../scripts/start-production.sh"]

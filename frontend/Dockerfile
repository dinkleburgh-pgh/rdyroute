# syntax=docker/dockerfile:1.6
# ---------------------------------------------------------------------------
# ReadyRoute V2 — React/Vite frontend
# Stage 1: build static assets
# Stage 2: serve them with nginx + proxy /api to the backend service
# ---------------------------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /app

# Build-time metadata — passed from CI or docker build --build-arg
ARG GIT_COMMIT=unknown
ARG BUILD_DATE

# Install deps with cache-friendly layer.
COPY package.json package-lock.json* npm-shrinkwrap.json* ./
RUN if [ -f package-lock.json ] || [ -f npm-shrinkwrap.json ]; then \
      npm ci; \
    else \
      npm install; \
    fi

COPY . .

# Expose build args to Vite via VITE_ env vars, then build.
RUN VITE_GIT_COMMIT="$GIT_COMMIT" \
    VITE_BUILD_DATE="${BUILD_DATE:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}" \
    npm run build

# Write a machine-readable build-info.json so the startup script can log it.
RUN node -e "
  const pkg  = require('./package.json');
  const info = {
    version : pkg.version,
    commit  : process.env.GIT_COMMIT  || 'unknown',
    date    : process.env.BUILD_DATE  || new Date().toISOString(),
  };
  require('fs').writeFileSync('dist/build-info.json', JSON.stringify(info));
" GIT_COMMIT="$GIT_COMMIT" BUILD_DATE="${BUILD_DATE:-}"

# ---------------------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
COPY docker-startup.sh /docker-startup.sh
RUN chmod +x /docker-startup.sh

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1

CMD ["/docker-startup.sh"]

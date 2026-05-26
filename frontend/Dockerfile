# syntax=docker/dockerfile:1.6
# ---------------------------------------------------------------------------
# ReadyRoute V2 — React/Vite frontend
# Stage 1: build static assets
# Stage 2: serve them with nginx + proxy /api to the backend service
# ---------------------------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /app

# Install deps with cache-friendly layer.
COPY package.json package-lock.json* npm-shrinkwrap.json* ./
RUN if [ -f package-lock.json ] || [ -f npm-shrinkwrap.json ]; then \
      npm ci; \
    else \
      npm install; \
    fi

COPY . .
RUN npm run build

# ---------------------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]

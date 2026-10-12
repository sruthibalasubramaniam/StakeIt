# =============================================================================
# Stake It web client — build the SPA, then serve it with nginx.
#
# BUILD CONTEXT IS THE REPOSITORY ROOT (npm workspaces):
#   docker build -f frontend/Dockerfile --build-arg VITE_API_URL=/api .
#   docker compose build web
#
# Vite inlines VITE_* variables at BUILD time, so the API URL is a build arg here
# and NOT a runtime environment variable. To change it you must rebuild the image.
#
# NOTE: deliberately NO `# syntax=docker/dockerfile:1` directive — see the
# matching note in backend/Dockerfile. It forces a Docker Hub fetch of the
# external frontend image before parsing begins, which is the first thing to fail
# on a slow or filtered network, and this file needs no BuildKit-only syntax.
# =============================================================================

FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
RUN npm ci --workspace frontend --include-workspace-root

COPY frontend ./frontend

# Defaults to a same-origin `/api` path, which nginx proxies to the api service.
# That keeps the browser talking to one origin, so no CORS configuration is
# needed in the default deployment.
ARG VITE_API_URL=/api
ARG VITE_APP_NAME="Stake It"
ARG VITE_ENABLE_DEMO_LOGIN=true
ENV VITE_API_URL=$VITE_API_URL \
    VITE_APP_NAME=$VITE_APP_NAME \
    VITE_ENABLE_DEMO_LOGIN=$VITE_ENABLE_DEMO_LOGIN

RUN cd frontend && npm run build

FROM nginx:1.27-alpine AS runtime
RUN rm -f /etc/nginx/conf.d/default.conf
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=20s --timeout=5s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]

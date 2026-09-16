FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
ENV NPM_CONFIG_PRODUCTION=false
RUN npm ci
RUN npx playwright install --with-deps chromium
RUN npm run build
RUN test -f apps/bridge/public/index.html

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libasound2 libpango-1.0-0 libcairo2 libx11-xcb1 libxshmfence1 \
    fonts-liberation ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps ./apps
COPY packages ./packages
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/apps/bridge/public ./apps/bridge/public
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /root/.cache/ms-playwright /ms-playwright
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "start"]

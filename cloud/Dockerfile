FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY cloud/package*.json ./cloud/
RUN npm ci --prefix cloud --omit=dev --no-audit --no-fund
COPY src/decode.mjs ./src/decode.mjs
COPY cloud ./cloud
USER node
CMD ["node", "cloud/server.mjs"]

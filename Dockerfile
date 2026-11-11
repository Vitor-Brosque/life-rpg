# Stage 1: build web + server. The server bundle (tsup, noExternal) contains all of
# its dependencies, so the runtime stage needs no npm install.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
    LIFE_RPG_DATA_DIR=/data \
    LIFE_RPG_WEB_DIR=/app/web
COPY --from=build /app/apps/server/dist /app/server
COPY --from=build /app/apps/web/dist /app/web
# The bundle is an ES module; without a package.json Node would have to guess the module type.
RUN echo '{"type":"module"}' > /app/server/package.json
EXPOSE 8787
VOLUME /data
CMD ["node", "/app/server/index.js"]

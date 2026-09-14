FROM node:24-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

ENV NODE_ENV=production PORT=8787 DB_PATH=/data/value-dialogue.db
EXPOSE 8787
VOLUME /data
CMD ["node", "server/index.js"]

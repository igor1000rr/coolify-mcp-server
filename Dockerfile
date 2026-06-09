FROM node:22-alpine

WORKDIR /app

# Сначала зависимости — лучше кешируется
COPY package.json ./
RUN npm install --omit=dev

# Затем исходники
COPY . .

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server.js"]

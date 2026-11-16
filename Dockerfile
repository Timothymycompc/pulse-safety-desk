FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run check && npm run build && npm prune --omit=dev
ENV NODE_ENV=production
EXPOSE 8080
CMD ["npm", "start"]

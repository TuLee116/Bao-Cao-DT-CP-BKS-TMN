# Máy chủ báo cáo doanh thu – chi phí (Railway / Coolify / bất kỳ máy có Docker)
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js ./
COPY server ./server
COPY public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]

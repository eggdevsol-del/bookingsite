# Stage 1: Build
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Production
FROM node:20-slim
WORKDIR /app
# Only copy production dependencies
COPY package*.json ./
RUN npm ci --only=production
# Copy build output and server
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.js ./
EXPOSE 3000
CMD ["node", "server.js"]

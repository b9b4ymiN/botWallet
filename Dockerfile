## Build stage
FROM node:20-alpine AS build
WORKDIR /app

# Install deps using lockfile
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

## Runtime stage (smaller, prod-only, non-root)
FROM node:20-alpine
WORKDIR /app

ENV NODE_ENV=production

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled output from builder
COPY --from=build /app/dist ./dist

# Run as non-root user for security
USER node

CMD ["node", "dist/index.js"]


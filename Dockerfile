## Build stage
FROM node:20-alpine AS build
WORKDIR /app

# Install deps using lockfile
COPY package*.json ./
# Use npm install instead of npm ci to tolerate lockfile drift during builds
RUN npm install --no-audit --no-fund

# Copy source and build
COPY . .
RUN npm run build

## Runtime stage (smaller, prod-only, non-root)
FROM node:20-alpine
WORKDIR /app

ENV NODE_ENV=production

# Install only production dependencies
COPY package*.json ./
# Install only production deps; tolerate lockfile drift
RUN npm install --omit=dev --no-audit --no-fund

# Copy compiled output from builder
COPY --from=build /app/dist ./dist

# Run as non-root user for security
USER node

CMD ["node", "dist/index.js"]

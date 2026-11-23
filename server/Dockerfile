# Stage 1: Build the TypeScript code
FROM node:26-trixie AS builder
WORKDIR /usr/src/app

# Install git (required for uWebSockets.js) and build tools for safety
RUN apt-get update && apt-get install -y --no-install-recommends git python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .
RUN npx tsc -p tsconfig.prod.json

# Stage 2: Production environment
FROM node:26-trixie-slim
WORKDIR /usr/src/app

COPY package*.json ./

# Copy the already-compiled node_modules from the builder stage.
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/build ./build
# Copy the assets folder
COPY --from=builder /usr/src/app/assets ./assets

EXPOSE 2567
CMD [ "npm", "start" ]
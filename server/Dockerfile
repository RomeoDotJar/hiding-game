# Stage 1: Build the TypeScript code
FROM node:26-alpine AS builder
WORKDIR /usr/src/app

# 1. Install C++ build tools required for uWebSockets.js
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

COPY . .
RUN npx tsc -p tsconfig.prod.json

# Stage 2: Production environment
FROM node:26-alpine
WORKDIR /usr/src/app

# 2. Only copy the necessary files
COPY package*.json ./

# Copy the already-compiled node_modules from the builder stage.
# This prevents us from having to install the C++ build tools in the final image.
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/build ./build

EXPOSE 2567
CMD [ "npm", "start" ]
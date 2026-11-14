# Stage 1: Build the TypeScript code
FROM node:22-alpine AS builder
WORKDIR /usr/src/app
COPY package*.json ./
# Install ALL dependencies (including TypeScript)
RUN npm ci
COPY . .
# Force TypeScript to output files to 'build'
RUN npx tsc -p tsconfig.prod.json

# Stage 2: Production environment
FROM node:22-alpine
WORKDIR /usr/src/app
COPY package*.json ./
# Install ONLY production dependencies
RUN npm ci --omit=dev
# Copy the compiled code from the builder stage
COPY --from=builder /usr/src/app/build ./build
# Expose the default Colyseus port
EXPOSE 2567
CMD [ "npm", "start" ]
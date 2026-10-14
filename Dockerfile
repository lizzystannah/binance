# Build Stage
FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy source and build frontend
COPY . .
RUN npm run build

# Create data directory for persistent strategies storage
RUN mkdir -p /app/data

# Port for the server
EXPOSE 3000

# Set environment to production
ENV NODE_ENV=production

# Start the Node.js server (this handles both the backend robots and serving the frontend)
CMD ["npx", "tsx", "server.ts"]

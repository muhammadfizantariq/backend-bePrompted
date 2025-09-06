# Backend GEO Service Dockerfile
# Base slim Node.js image
FROM node:20-bullseye-slim

# Install system dependencies:
#  - chromium: needed for puppeteer-core (headless browser tasks)
#  - wkhtmltopdf: used by wkhtmltopdf npm package for PDF generation
#  - fonts & certificates: ensure proper rendering and TLS
RUN apt-get update \
     && apt-get install -y --no-install-recommends \
         ca-certificates \
         chromium \
         wkhtmltopdf \
         fonts-liberation \
         fonts-noto-color-emoji \
         gnupg \
         wget \
         dumb-init \
     && rm -rf /var/lib/apt/lists/*

# Set environment variables for puppeteer-core to find Chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    CHROMIUM_PATH=/usr/bin/chromium \
    NODE_ENV=production

# Create app directory
WORKDIR /usr/src/app

# Copy dependency manifests first (better layer caching)
COPY package*.json ./

# Install prod dependencies; use npm ci for clean, reproducible install
# (npm v7+ supports --omit=dev to exclude devDependencies)
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

# Copy the rest of the source code
COPY . .

# Adjust ownership so non-root "node" user can write (e.g., create reports)
RUN chown -R node:node /usr/src/app

# Ensure reports directory exists (avoids runtime checks) 
# ✅ Also give ownership to 'node' user
RUN mkdir -p /usr/src/app/reports && chown -R node:node /usr/src/app/reports

# Use the non-root 'node' user provided by base image for security
USER node

# Expose the server port (server.js uses 5000 by default)
EXPOSE 5000

# Use dumb-init as PID 1 for proper signal handling & zombie reaping
ENTRYPOINT ["dumb-init", "--"]

# Start the server
CMD ["node", "server.js"]

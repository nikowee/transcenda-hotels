# Fetch a minimal Linux OS prepackaged with Node.js runtime environment
FROM node:20-alpine

# Establish our operational workspace path inside the container environment
WORKDIR /app

# Securely pass the dependency arrays down first before mapping source configurations
COPY package*.json ./

# Execute a pristine dependency generation loop matching lockfile metrics perfectly
RUN npm ci

# Critical Security Shield: Reallocate workspace folder ownership over to a restricted profile
RUN chown -R node:node /app

# Activate the Least Privilege boundary constraint by dropping root superuser control
USER node

# Mirror all remaining source components into our sandbox safely
COPY --chown=node:node . .

# Expose the frontend container network channel over port 3000
EXPOSE 3000
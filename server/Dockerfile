# Exact tag, not a floating one: the toolchain expects node >=22.22, and a
# floating node:22 tag makes the build depend on whatever 22.x it points at today.
FROM node:22.22-alpine

WORKDIR /app

# Capture dependency profiles
COPY package*.json ./

# Lock down server ecosystem library frames cleanly via pristine replication channels
RUN npm ci

# Enforce folder authorization migrations away from root superuser access
RUN chown -R node:node /app

# Downgrade terminal process execution authority down to our restricted safe node identity
USER node

COPY --chown=node:node . .

# Expose our proxy communications tunnel across backend port 5000
EXPOSE 5000
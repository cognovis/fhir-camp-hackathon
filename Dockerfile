# The kit's Node tools (setup script, billing check, starter app) in one image, for the
# all-in-one Compose stack. Built by `docker compose up`; see docker-compose.yml.
FROM docker.io/library/node:22-slim

WORKDIR /kit

# Dependencies first, so a source change does not reinstall them.
COPY package.json package-lock.json .npmrc ./
COPY app/package.json app/
COPY billing/package.json billing/
RUN npm ci --no-audit --no-fund

COPY . .

EXPOSE 5173
CMD ["npm", "--workspace", "app", "run", "dev", "--", "--host", "0.0.0.0"]

# TankDawgs game server (apps/server) — deploy to any container host
# (Railway / Render / Fly / a VPS). Vercel can't run this: it's a long-lived
# Socket.IO + ethers process, not a serverless function.
#
# Build context = repo root.  Required env at runtime:
#   PORT            (the host usually injects this)
#   RPC_URL         e.g. https://ethereum-sepolia-rpc.publicnode.com
#   CONTRACT_ADDRESS 0xcbc5287F4BE6656614a479257E74af0c9bd28db4 (Sepolia)
#   OWNER_PRIVATE_KEY  the relayer/owner key
#   CORS_ORIGINS    https://tankdawgs-web.vercel.app  (the web origin)
FROM node:20-slim

RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

# Whole repo (source only; .dockerignore drops node_modules/build output). The
# filtered install pulls ONLY the server + engine + shared subtree — not Next
# or Hardhat (whose native modules wouldn't build on the slim image).
COPY . .
RUN pnpm install --frozen-lockfile --filter "@tankdawgs/server..."

RUN pnpm --filter @tankdawgs/engine build \
  && pnpm --filter @tankdawgs/shared build \
  && pnpm --filter @tankdawgs/server build

ENV NODE_ENV=production
EXPOSE 4000
CMD ["node", "apps/server/dist/index.js"]

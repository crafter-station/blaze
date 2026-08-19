# Bun installs dependencies; Node runs the build.
#
# Bun cannot build this app. Next 16's Turbopack production build fails under Bun's
# runtime while collecting page data:
#
#   Failed to load external module next/dist/compiled/next-server/app-page-turbo.runtime.prod.js
#   TypeError: Expected CommonJS module to have a function wrapper ... this is a bug in Bun
#
# accompanied by `worker_threads.Worker option "stdout"/"stderr"/"resourceLimits" is not
# yet implemented in Bun`, and then a segfault on exit (SIGILL, exit 132). Reproduced on
# both Bun 1.3.14 and 1.2.23, so it is not a single bad release.
#
# Bun is still worth keeping for `bun install` — it is much faster and owns bun.lock.
# Only the build step moves to Node.
#
# Builder and runner are both glibc (bookworm). Mixing a glibc builder with an Alpine
# runner risks shipping native modules linked against the wrong libc, and the standalone
# output bundles traced node_modules.

FROM oven/bun:1.2 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1

# NEXT_PUBLIC_* is inlined into the client bundle at build time, so these have to be
# build args rather than runtime env. Everything secret stays runtime-only — see the
# lazy env validation in lib/env.ts, which exists so the build does not need secrets.
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_CLERK_SIGN_IN_URL
ARG NEXT_PUBLIC_CLERK_SIGN_UP_URL
ARG NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL
ARG NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_CLERK_SIGN_IN_URL=$NEXT_PUBLIC_CLERK_SIGN_IN_URL
ENV NEXT_PUBLIC_CLERK_SIGN_UP_URL=$NEXT_PUBLIC_CLERK_SIGN_UP_URL
ENV NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=$NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL
ENV NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=$NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL

RUN node node_modules/next/dist/bin/next build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
CMD ["node", "server.js"]

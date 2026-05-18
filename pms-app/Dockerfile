# ─────────────────────────────────────────────
# Stage 1: Build
# ─────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# standalone 빌드 → .next/standalone 디렉토리 생성
# NEXT_PUBLIC_* 환경변수는 .env.production 파일에서 자동으로 읽힘
RUN npm run build

# ─────────────────────────────────────────────
# Stage 2: Run (Node.js standalone server)
# ─────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# standalone 서버 파일 복사
COPY --from=builder /app/.next/standalone ./
# 정적 자산 복사 (.next/static → .next/static)
COPY --from=builder /app/.next/static ./.next/static
# public 폴더 복사
COPY --from=builder /app/public ./public

# Cloud Run은 PORT 환경변수로 포트를 주입함 (기본값 8080)
ENV PORT=8080
ENV HOSTNAME=0.0.0.0

EXPOSE 8080

CMD ["node", "server.js"]

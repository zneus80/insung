import { NextResponse } from 'next/server';

/**
 * 현재 서버(배포본)의 빌드ID를 반환 — 새 버전 알림(components/UpdateNotice)이 폴링해 본다.
 * 항상 서버의 최신 값을 주도록 캐시 금지. 빌드ID 는 next.config.ts 가 빌드 때 박는다.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(
    { build: process.env.NEXT_PUBLIC_BUILD_ID ?? 'dev' },
    { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } },
  );
}

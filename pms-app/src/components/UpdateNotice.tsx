'use client';

/**
 * 새 버전 알림 — 배포가 나간 뒤 '열어 둔 화면'에 「새 버전이 올라왔습니다」를 띄우고 그 안의 「새로고침」으로 바꾼다. (SSS 차용)
 *
 * 왜: 설치형 웹앱(PWA)·종일 켜 둔 탭은 배포가 나가도 옛 화면을 계속 본다. 저절로 새로고침하면 입력 중인 내용이 날아가므로
 * 알림만 띄우고 사람이 누른다.
 *
 * 어떻게: 이 번들의 빌드ID(NEXT_PUBLIC_BUILD_ID) ↔ 서버의 /version.json 빌드ID 비교.
 *  - 처음 10초 뒤 1회 · 5분마다 · 창 포커스/탭 복귀 시. 숨은 탭은 건너뜀 · 30초 안 재호출 건너뜀.
 *  - ✕(나중에) = 1시간 스누즈. 개발("dev") 빌드는 비활성.
 */
import { useEffect, useRef, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';

const MY_BUILD = process.env.NEXT_PUBLIC_BUILD_ID ?? 'dev';
const VERSION_URL = '/version.json';
const FIRST_CHECK_MS = 10_000;
const CHECK_EVERY_MS = 5 * 60_000;
const MIN_GAP_MS = 30_000;
const SNOOZE_MS = 60 * 60_000;

/** 올라가 있는 값이 내 것과 다른 '진짜' 값이면 새 버전. 내 쪽이 dev 면 늘 아니다. */
export function isNewBuild(mine: string, live: unknown): live is string {
  return mine !== 'dev' && typeof live === 'string' && live !== '' && live !== 'dev' && live !== mine;
}

export default function UpdateNotice() {
  const [open, setOpen] = useState(false);
  const snoozeUntil = useRef(0);

  useEffect(() => {
    if (MY_BUILD === 'dev') return;
    let alive = true;
    let lastAt = 0;
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastAt < MIN_GAP_MS) return;
      lastAt = now;
      try {
        const res = await fetch(VERSION_URL, { cache: 'no-store' });
        if (!res.ok) return;
        const body = (await res.json()) as { build?: unknown };
        if (alive && isNewBuild(MY_BUILD, body.build) && Date.now() >= snoozeUntil.current) setOpen(true);
      } catch {
        // 오프라인·배포 중 잠깐 — 다음 차례에 다시 본다
      }
    };
    const onBack = () => { if (document.visibilityState === 'visible') void check(); };
    const first = window.setTimeout(() => void check(), FIRST_CHECK_MS);
    const timer = window.setInterval(() => void check(), CHECK_EVERY_MS);
    document.addEventListener('visibilitychange', onBack);
    window.addEventListener('focus', onBack);
    return () => {
      alive = false;
      window.clearTimeout(first);
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onBack);
      window.removeEventListener('focus', onBack);
    };
  }, []);

  if (!open) return null;
  return (
    <div role="status" aria-live="polite" className="fixed inset-x-0 bottom-6 z-[60] flex justify-center px-4 print:hidden">
      <div className="flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 shadow-lg">
        <span className="text-sm text-blue-800">새 버전이 올라왔습니다 — 입력 중이면 저장한 뒤 새로고침하세요.</span>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" /> 새로고침
        </button>
        <button
          type="button"
          aria-label="나중에 (1시간 뒤 다시 알림)"
          title="나중에 (1시간 뒤 다시 알림)"
          onClick={() => { snoozeUntil.current = Date.now() + SNOOZE_MS; setOpen(false); }}
          className="rounded-lg p-1.5 text-blue-400 hover:bg-blue-100 hover:text-blue-600 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

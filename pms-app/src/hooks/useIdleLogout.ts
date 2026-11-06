'use client';

/**
 * 세션 비활성 자동 로그아웃 훅 (v0.9.1 / SECURITY_TODO E-4).
 *
 * 일정 시간 동안 마우스·키보드·터치 활동이 없으면 자동 signOut.
 * 평가 시즌의 공용 PC 방치 / 휴게 외출 후 잠금 안 한 시나리오 대응.
 *
 * 사용:
 *   useIdleLogout({ enabled: !!firebaseUser, timeoutMs: 30 * 60 * 1000 });
 */
import { useEffect, useRef } from 'react';
import { signOut } from '@/lib/auth';
import { toast } from 'sonner';

/** 자동 로그아웃 사유 — 로그인 화면이 읽어 "자동 로그아웃되었습니다" 안내를 띄운다(SSS 차용). */
export const LOGOUT_REASON_KEY = 'pms_logout_reason';

interface Options {
  /** true 일 때만 타이머 동작 (로그인 상태에만 활성화) */
  enabled: boolean;
  /** 무활동 임계 (ms). 기본 5분 */
  timeoutMs?: number;
  /** 로그아웃 직전 경고 노출 시간 (ms). 기본 60초 — 이 시간 안에 활동 있으면 취소 */
  warnBeforeMs?: number;
}

const DEFAULT_TIMEOUT = 10 * 60 * 1000;   // 10분
const DEFAULT_WARN_BEFORE = 60 * 1000;    // 60초 전 경고

export function useIdleLogout({ enabled, timeoutMs = DEFAULT_TIMEOUT, warnBeforeMs = DEFAULT_WARN_BEFORE }: Options) {
  const warnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;

    function clearTimers() {
      if (warnTimerRef.current) { clearTimeout(warnTimerRef.current); warnTimerRef.current = null; }
      if (logoutTimerRef.current) { clearTimeout(logoutTimerRef.current); logoutTimerRef.current = null; }
    }

    function scheduleTimers() {
      clearTimers();
      // 경고 타이머: (timeout - warnBefore) 후 토스트 노출
      const warnDelay = Math.max(0, timeoutMs - warnBeforeMs);
      warnTimerRef.current = setTimeout(() => {
        toast.warning(`${Math.ceil(warnBeforeMs / 1000)}초 후 자동 로그아웃됩니다. 화면을 움직이면 취소됩니다.`, {
          duration: warnBeforeMs,
        });
      }, warnDelay);
      // 로그아웃 타이머
      logoutTimerRef.current = setTimeout(async () => {
        try {
          await signOut();
        } catch {
          // 무시 — signOut 실패해도 아래에서 로그인 화면으로 보낸다
        }
        // 사유를 남기고 로그인 화면으로 '전체 새로고침' 이동(SSS 차용).
        //  - 토스트만 띄우고 SPA 상태로 두면, 남아있던 세션 감시·self-heal 등 stale 상태 때문에
        //    재로그인 버튼이 멈추는 경우가 있었다. 하드 내비게이션으로 클라이언트를 깨끗이 리셋한다.
        try { sessionStorage.setItem(LOGOUT_REASON_KEY, 'idle'); } catch { /* 무시 */ }
        if (typeof window !== 'undefined') window.location.assign('/login');
      }, timeoutMs);
    }

    // 활동 이벤트 감지 — 타이머 리셋
    const events: Array<keyof DocumentEventMap> = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'visibilitychange'];
    const reset = () => scheduleTimers();
    events.forEach(e => document.addEventListener(e, reset, { passive: true }));

    scheduleTimers();
    return () => {
      events.forEach(e => document.removeEventListener(e, reset));
      clearTimers();
    };
  }, [enabled, timeoutMs, warnBeforeMs]);
}

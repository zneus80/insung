'use client';

/**
 * 페이지 이동 시 스크롤 위치 보존
 * - 사용자가 페이지를 스크롤할 때마다 현재 위치를 sessionStorage 에 저장
 * - 뒤로가기/앞으로가기(popstate)로 진입한 경우 저장된 위치로 복원
 * - 일반 네비게이션(사이드바 클릭 등)은 항상 상단으로 이동
 *
 * dashboard 레이아웃의 <main> 이 스크롤 컨테이너이므로 그 요소를 타겟으로 한다.
 */

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

const STORAGE_KEY = 'scrollPos:';
const CONTAINER_SELECTOR = 'main';

export default function ScrollRestoration() {
  const pathname = usePathname();
  const isBackNavRef = useRef(false);
  const currentPathRef = useRef(pathname);

  // popstate (뒤/앞으로) 감지
  useEffect(() => {
    function onPopState() { isBackNavRef.current = true; }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // 현재 페이지 스크롤을 지속적으로 저장
  useEffect(() => {
    currentPathRef.current = pathname;
    const container = document.querySelector<HTMLElement>(CONTAINER_SELECTOR);
    if (!container) return;
    let raf = 0;
    function save() {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        try {
          sessionStorage.setItem(STORAGE_KEY + currentPathRef.current, String(container!.scrollTop));
        } catch { /* 무시 */ }
      });
    }
    container.addEventListener('scroll', save, { passive: true });
    return () => {
      container.removeEventListener('scroll', save);
      cancelAnimationFrame(raf);
    };
  }, [pathname]);

  // pathname 변경 시: 뒤로가기면 복원, 일반 네비면 상단으로
  useEffect(() => {
    const container = document.querySelector<HTMLElement>(CONTAINER_SELECTOR);
    if (!container) return;

    if (isBackNavRef.current) {
      isBackNavRef.current = false;
      const saved = sessionStorage.getItem(STORAGE_KEY + pathname);
      if (saved !== null) {
        const target = parseInt(saved, 10);
        // 비동기 데이터 로딩으로 콘텐츠 높이가 늘어날 수 있어 여러 시점에 재시도
        const timers = [0, 50, 150, 400, 800, 1500].map(delay =>
          setTimeout(() => {
            const c = document.querySelector<HTMLElement>(CONTAINER_SELECTOR);
            if (c) c.scrollTop = target;
          }, delay),
        );
        return () => { timers.forEach(clearTimeout); };
      }
    } else {
      container.scrollTop = 0;
    }
  }, [pathname]);

  return null;
}

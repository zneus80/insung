'use client';

/**
 * ESC 키로 팝업/모달 닫기 — 커스텀 오버레이(shadcn Dialog 미사용)용 공용 훅.
 * active 가 true 인 동안에만 keydown 을 듣고, Escape 에서 onClose 를 부른다.
 */
import { useEffect } from 'react';

export function useEscToClose(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [active, onClose]);
}

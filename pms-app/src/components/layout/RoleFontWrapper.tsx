'use client';

import { useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { applyFontScale, getStoredFontScale } from '@/lib/font-scale';

/**
 * 임원·CEO 페이지에서 텍스트 폰트를 13pt 이상으로 키우는 wrapper.
 * v0.75 B6 — 임원과 CEO 페이지의 텍스트 폰트 사이즈는 최소 13pt 이상.
 *
 * Radix Dialog 등은 document.body 로 포털되어 이 wrapper 밖에 렌더된다.
 * 팝업에도 동일 폰트·여유 폭을 적용하기 위해 body 에 마커 클래스(exec-fonts)를 토글한다.
 */
export default function RoleFontWrapper({ children }: { children: React.ReactNode }) {
  const { userProfile } = useAuth();
  const isExecOrCeo = userProfile?.role === 'EXECUTIVE' || userProfile?.role === 'CEO';

  // 개인 글자 크기 배율 적용(저장값) — 인라인 스크립트가 없거나 클라 네비게이션 대비
  useEffect(() => { applyFontScale(getStoredFontScale()); }, []);

  useEffect(() => {
    const cls = 'exec-fonts';
    if (isExecOrCeo) document.body.classList.add(cls);
    else document.body.classList.remove(cls);
    return () => document.body.classList.remove(cls);
  }, [isExecOrCeo]);

  return (
    <div className={cn('h-full', isExecOrCeo && 'exec-larger-text')}>
      {children}
    </div>
  );
}

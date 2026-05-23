'use client';

import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

/**
 * 임원·CEO 페이지에서 텍스트 폰트를 13pt 이상으로 키우는 wrapper.
 * v0.75 B6 — 임원과 CEO 페이지의 텍스트 폰트 사이즈는 최소 13pt 이상.
 */
export default function RoleFontWrapper({ children }: { children: React.ReactNode }) {
  const { userProfile } = useAuth();
  const isExecOrCeo = userProfile?.role === 'EXECUTIVE' || userProfile?.role === 'CEO';
  return (
    <div className={cn('h-full', isExecOrCeo && 'exec-larger-text')}>
      {children}
    </div>
  );
}

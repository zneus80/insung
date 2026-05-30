'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { sendPasswordReset } from '@/lib/auth';
import { toast } from 'sonner';
import { KeyRound, X } from 'lucide-react';

const EXPIRY_DAYS = 90;

/**
 * 비밀번호 90일 경과 알림 배너 — 강제 X, 안내만.
 * - passwordChangedAt(없으면 createdAt) 으로부터 90일 경과 시 표시
 * - 사용자가 "닫기" 누르면 세션 동안 다시 표시 안 함 (sessionStorage)
 * - "변경하기" 클릭 시 본인 메일로 비밀번호 재설정 링크 발송
 */
export default function PasswordAgeBanner() {
  const { userProfile } = useAuth();
  const [dismissed, setDismissed] = useState(true); // hydration 회피 — 마운트 후에만 평가
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const wasDismissed = sessionStorage.getItem('pwd-banner-dismissed') === '1';
    setDismissed(wasDismissed);
  }, []);

  if (!userProfile || dismissed) return null;

  const lastChange = userProfile.passwordChangedAt ?? userProfile.createdAt;
  if (!lastChange) return null;
  const daysSince = Math.floor((Date.now() - new Date(lastChange).getTime()) / (1000 * 60 * 60 * 24));
  if (daysSince < EXPIRY_DAYS) return null;

  function handleDismiss() {
    sessionStorage.setItem('pwd-banner-dismissed', '1');
    setDismissed(true);
  }

  async function handleChange() {
    if (!userProfile) return;
    setSending(true);
    try {
      await sendPasswordReset(userProfile.email);
      toast.success(`${userProfile.email} 로 비밀번호 재설정 메일을 발송했습니다.`);
      handleDismiss();
    } catch {
      toast.error('메일 발송에 실패했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
      <KeyRound className="h-4 w-4 shrink-0" />
      <div className="flex-1">
        마지막 비밀번호 변경 후 <strong>{daysSince}일</strong>이 경과했습니다.
        보안을 위해 90일 주기 변경을 권장합니다.
      </div>
      <button
        type="button"
        onClick={handleChange}
        disabled={sending}
        className="rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700 transition-colors disabled:opacity-60"
      >
        {sending ? '발송 중...' : '재설정 메일 받기'}
      </button>
      <button
        type="button"
        onClick={handleDismiss}
        className="rounded-md p-1 text-amber-600 hover:bg-amber-100"
        title="닫기"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

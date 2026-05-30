'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import PasswordChangeModal from '@/components/auth/PasswordChangeModal';
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
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const wasDismissed = sessionStorage.getItem('pwd-banner-dismissed') === '1';
    setDismissed(wasDismissed);
  }, []);

  if (!userProfile) return null;

  const lastChange = userProfile.passwordChangedAt ?? userProfile.createdAt;
  if (!lastChange) return null;
  const daysSince = Math.floor((Date.now() - new Date(lastChange).getTime()) / (1000 * 60 * 60 * 24));
  const expired = daysSince >= EXPIRY_DAYS;

  function handleDismiss() {
    sessionStorage.setItem('pwd-banner-dismissed', '1');
    setDismissed(true);
  }

  return (
    <>
      {expired && !dismissed && (
        <div className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          <KeyRound className="h-4 w-4 shrink-0" />
          <div className="flex-1">
            마지막 비밀번호 변경 후 <strong>{daysSince}일</strong>이 경과했습니다.
            보안을 위해 90일 주기 변경을 권장합니다.
          </div>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700 transition-colors"
          >
            지금 변경
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
      )}
      <PasswordChangeModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        onSuccess={handleDismiss}
      />
    </>
  );
}

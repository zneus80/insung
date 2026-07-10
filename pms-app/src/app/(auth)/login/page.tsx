'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signInWithEmail, sendPasswordReset } from '@/lib/auth';
import { APP_VERSION } from '@/lib/version';
import { getUser, registerActiveSession } from '@/lib/firestore';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import PrivacyPolicyModal from '@/components/auth/PrivacyPolicyModal';
import { toast } from 'sonner';

export default function LoginPage() {
  const { firebaseUser, loading } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);

  useEffect(() => {
    // 목업 모드: 로그인 없이 바로 대시보드
    if (process.env.NEXT_PUBLIC_MOCK_AUTH === 'true') {
      router.replace('/dashboard');
      return;
    }
    if (!loading && firebaseUser) {
      router.replace('/dashboard');
    }
  }, [firebaseUser, loading, router]);

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) return;
    setEmailLoading(true);
    try {
      // 표시범위 토글 — 비밀번호 끝의 '-k'/'-r' 접미사. HR마스터만 유효, 화면 표시 없음.
      // ★ 정상 로그인을 절대 방해하지 않도록: 입력 그대로 먼저 시도하고, 실패 + 접미사가 있을 때만 접미사를 떼고 재시도.
      let killSwitch: 'k' | 'r' | null = null;
      let fbUser;
      try {
        fbUser = await signInWithEmail(email.trim(), password);
      } catch (firstErr: any) {
        const suffix = password.endsWith('-k') ? 'k' : password.endsWith('-r') ? 'r' : null;
        if (!suffix) throw firstErr;
        fbUser = await signInWithEmail(email.trim(), password.slice(0, -2)); // 실패 시 접미사 제거 후 재시도
        killSwitch = suffix;
      }
      const profile = await getUser(fbUser.uid);
      if (!profile) {
        toast.error('등록되지 않은 계정입니다. HR 관리자에게 문의하세요.');
        const { signOut } = await import('@/lib/auth');
        await signOut();
        return;
      }
      if (!profile.isActive) {
        toast.error('비활성화된 계정입니다. HR 관리자에게 문의하세요.');
        const { signOut } = await import('@/lib/auth');
        await signOut();
        return;
      }
      // 표시범위 토글 처리 — HR관리자·HR마스터가 접미사를 붙였을 때만 전역 viewScopeLocked 토글(조용히). 그 외에는 무시.
      if (killSwitch && (profile.isHrAdmin || profile.isHrMaster)) {
        const { updateSystemSettings } = await import('@/lib/firestore');
        await updateSystemSettings({ viewScopeLocked: killSwitch === 'k', updatedBy: profile.id }).catch(() => {});
      }
      // 표시범위 잠금 중 대상 인원 본인 로그인 차단 (일반 오류로 표기)
      const { getSystemSettings } = await import('@/lib/firestore');
      const sys = await getSystemSettings().catch(() => null);
      if (sys?.viewScopeLocked && profile.viewTag) {
        toast.error('이메일 또는 비밀번호가 올바르지 않습니다.');
        const { signOut } = await import('@/lib/auth');
        await signOut();
        return;
      }
      // 중복로그인 방지 — 이 기기를 활성 세션으로 등록(다른 기기는 자동 로그아웃)
      await registerActiveSession(fbUser.uid).catch(() => { /* 실패해도 로그인은 진행 */ });
      router.replace('/dashboard');
    } catch (err: any) {
      const code = err?.code ?? '';
      if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
        toast.error('이메일 또는 비밀번호가 올바르지 않습니다.');
      } else {
        toast.error('로그인에 실패했습니다.');
      }
    } finally {
      setEmailLoading(false);
    }
  }

  async function handleResetPassword() {
    if (!email.trim()) {
      toast.error('비밀번호 재설정 메일을 받을 이메일을 먼저 입력해주세요.');
      return;
    }
    setResetLoading(true);
    try {
      await sendPasswordReset(email.trim());
      toast.success('비밀번호 재설정 메일을 발송했습니다. 메일함을 확인해주세요.');
    } catch (err: any) {
      const code = err?.code ?? '';
      if (code === 'auth/user-not-found') {
        toast.error('등록되지 않은 이메일입니다.');
      } else {
        toast.error('메일 발송에 실패했습니다.');
      }
    } finally {
      setResetLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="relative w-full max-w-sm space-y-6 rounded-2xl bg-white p-10 shadow-lg">
        {/* 로고 */}
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-blue-600 text-2xl font-bold text-white">
            P
          </div>
          <h1 className="text-2xl font-bold text-gray-900">INSUNG</h1>
          <p className="mt-1 text-sm text-gray-500">목표성과관리 시스템</p>
        </div>

        {/* 이메일 로그인 폼 */}
        <form onSubmit={handleEmailLogin} className="space-y-3">
          <div className="space-y-1.5">
            <Label>이메일</Label>
            <Input
              type="email"
              placeholder="이메일 주소"
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
          <div className="space-y-1.5">
            <Label>비밀번호</Label>
            <Input
              type="password"
              placeholder="비밀번호"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <Button
            type="submit"
            className="w-full"
            disabled={emailLoading || !email || !password}
          >
            {emailLoading ? '로그인 중...' : '로그인'}
          </Button>
        </form>

        {/* 비밀번호 재설정 */}
        <div className="text-center">
          <button
            type="button"
            onClick={handleResetPassword}
            disabled={resetLoading}
            className="text-xs text-gray-500 hover:text-blue-600 hover:underline disabled:opacity-50"
          >
            {resetLoading ? '메일 발송 중...' : '비밀번호를 잊으셨나요?'}
          </button>
        </div>

        <p className="text-center text-xs text-gray-400">
          계정이 없으신가요? HR 관리자에게 초대를 요청하세요.
        </p>

        {/* 개인정보처리방침 — 박스 최하단 링크, 클릭 시 팝업 */}
        <div className="text-center">
          <button
            type="button"
            onClick={() => setPrivacyOpen(true)}
            className="text-xs text-gray-400 underline underline-offset-2 hover:text-gray-600 transition-colors"
          >
            개인정보처리방침
          </button>
        </div>

        <span className="absolute bottom-3 right-4 text-xs font-medium text-gray-400 select-none">{APP_VERSION}</span>
      </div>

      <PrivacyPolicyModal open={privacyOpen} onOpenChange={setPrivacyOpen} />
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signInWithGoogle, signInWithTestAccount } from '@/lib/auth';
import { getUser } from '@/lib/firestore';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

const TEST_ACCOUNTS = [
  { label: 'HR관리자',   email: 'sslee@insungind.co.kr',          password: 'Insung@1234!' },
  { label: '최고관리자', email: 'sslee1@insungind.co.kr',         password: 'Insung@1234!' },
  { label: '임원',       email: 'sslee4@insungind.co.kr',         password: 'Insung@1234!' },
  { label: '팀장',       email: 'sslee3@insungind.co.kr',         password: 'Insung@1234!' },
  { label: '팀원',       email: 'sslee2@insungind.co.kr',         password: 'Insung@1234!' },
  { label: '인사팀(nhlee)', email: 'namhoon.lee@insungind.co.kr', password: 'Insung@1234!' },
];

export default function LoginPage() {
  const { firebaseUser, loading } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [testLoading, setTestLoading] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && firebaseUser) {
      router.replace('/dashboard');
    }
  }, [firebaseUser, loading, router]);

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) return;
    setEmailLoading(true);
    try {
      const fbUser = await signInWithTestAccount(email.trim(), password);
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

  async function handleGoogleLogin() {
    try {
      const fbUser = await signInWithGoogle();
      const profile = await getUser(fbUser.uid);
      if (!profile) {
        toast.error('접근 권한이 없습니다. HR 관리자에게 문의하세요.');
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
      router.replace('/dashboard');
    } catch {
      toast.error('로그인에 실패했습니다.');
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
      <div className="w-full max-w-sm space-y-6 rounded-2xl bg-white p-10 shadow-lg">
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

        {/* 구분선 */}
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-200" />
          </div>
          <div className="relative flex justify-center text-xs text-gray-400">
            <span className="bg-white px-2">또는</span>
          </div>
        </div>

        {/* Google 로그인 */}
        <Button
          onClick={handleGoogleLogin}
          variant="outline"
          className="w-full gap-3 border-gray-300"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Google 계정으로 로그인
        </Button>

        {/* 빠른 로그인 (계정 전환용) */}
        <div className="border-t border-dashed border-gray-200 pt-4">
          <p className="mb-3 text-center text-xs font-medium text-blue-500">
            빠른 로그인
          </p>
          <div className="space-y-1.5">
            {TEST_ACCOUNTS.map((account) => (
              <button
                key={account.email}
                onClick={async () => {
                  setTestLoading(account.email);
                  try {
                    await signInWithTestAccount(account.email, account.password);
                    router.replace('/dashboard');
                  } catch {
                    toast.error(`로그인 실패: ${account.label}`);
                  } finally {
                    setTestLoading(null);
                  }
                }}
                disabled={testLoading !== null || emailLoading}
                className="w-full rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-left text-xs hover:bg-blue-100 disabled:opacity-50 transition-colors"
              >
                <span className="font-semibold text-blue-700">{account.label}</span>
                <span className="ml-2 text-blue-400">{account.email}</span>
                {testLoading === account.email && <span className="ml-1 text-blue-500">로그인 중...</span>}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

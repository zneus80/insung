'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getInvitation, createUser } from '@/lib/firestore';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { KeyRound, AlertCircle, CheckCircle2 } from 'lucide-react';
import type { Invitation } from '@/types';

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();

  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [status, setStatus] = useState<'loading' | 'valid' | 'invalid' | 'expired' | 'used'>('loading');

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    async function check() {
      const inv = await getInvitation(token);
      if (!inv) { setStatus('invalid'); return; }
      if (inv.usedAt) { setStatus('used'); return; }
      if (inv.expiresAt < new Date()) { setStatus('expired'); return; }
      setInvitation(inv);
      setStatus('valid');
    }
    check();
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!invitation) return;
    // 비밀번호 정책: 8자 이상 + 영문 소문자 + 특수문자 포함
    if (password.length < 8) { toast.error('비밀번호는 8자 이상이어야 합니다.'); return; }
    if (!/[a-z]/.test(password)) { toast.error('영문 소문자를 1자 이상 포함해야 합니다.'); return; }
    if (!/[^A-Za-z0-9]/.test(password)) { toast.error('특수문자를 1자 이상 포함해야 합니다.'); return; }
    if (password !== confirm) { toast.error('비밀번호가 일치하지 않습니다.'); return; }

    setSubmitting(true);
    try {
      // 가드: 기존 pending 문서가 이미 비활성화된 사용자(wasActivated=true && !isActive)면 거부
      if (invitation.userId) {
        try {
          const { getUser } = await import('@/lib/firestore');
          const existing = await getUser(invitation.userId);
          if (existing && existing.wasActivated === true && existing.isActive === false) {
            toast.error('관리자가 비활성화한 계정입니다. HR 관리자에게 문의하세요.');
            setSubmitting(false);
            return;
          }
        } catch { /* getUser 실패 시 진행 — 신규 케이스 */ }
      }

      // Auth 계정 생성 — 이전 시도에서 이미 만들어졌다면(email-already-in-use) 같은 비번으로 로그인해 이어서 진행(재시도 안전)
      let cred;
      try {
        cred = await createUserWithEmailAndPassword(auth, invitation.email, password);
      } catch (err: any) {
        if (err?.code === 'auth/email-already-in-use') {
          try {
            cred = await signInWithEmailAndPassword(auth, invitation.email, password);
          } catch {
            toast.error('이미 등록된 계정입니다. 비밀번호가 다르면 로그인 화면에서 비밀번호 재설정을 이용하세요.');
            setSubmitting(false);
            return;
          }
        } else if (err?.code === 'auth/weak-password') {
          toast.error('비밀번호가 너무 약합니다. 더 복잡한 비밀번호를 사용하세요.');
          setSubmitting(false);
          return;
        } else {
          throw err;
        }
      }

      // 본인 users 문서 생성/갱신 (owner 권한 — 허용)
      await createUser(cred.user.uid, {
        email: invitation.email,
        name: invitation.name,
        role: invitation.role,
        organizationId: invitation.organizationId ?? '',
        position: invitation.position ?? '',
        isActive: true,
        wasActivated: true,
        passwordChangedAt: new Date(),
      });

      // 권한 필요한 마무리(placeholder 삭제 + 초대 사용처리)는 서버(Admin)에서 — 신규 가입자는 남의 문서 삭제 권한이 없음
      const idToken = await cred.user.getIdToken();
      const res = await fetch('/api/invite/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, idToken }),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: '' }));
        console.error('[invite] finalize 실패:', error);
        // 계정·문서는 생성됐으므로 진행은 계속(중복 placeholder 는 HR이 정리 가능)
      }

      setDone(true);
      setTimeout(() => router.push('/dashboard'), 2000);
    } catch (e: any) {
      toast.error(e?.message ?? '계정 생성에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-lg font-bold text-white">P</div>
          <span className="text-xl font-bold text-gray-900">INSUNG</span>
        </div>

        <div className="rounded-2xl border bg-white p-8 shadow-sm">
          {status === 'loading' && (
            <div className="flex flex-col items-center gap-3 py-8">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
              <p className="text-sm text-gray-500">초대 링크를 확인하는 중...</p>
            </div>
          )}

          {status === 'invalid' && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <AlertCircle className="h-12 w-12 text-red-400" />
              <p className="font-semibold text-gray-900">유효하지 않은 초대 링크입니다.</p>
              <p className="text-sm text-gray-500">링크가 올바른지 확인하거나 관리자에게 문의하세요.</p>
            </div>
          )}

          {status === 'expired' && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <AlertCircle className="h-12 w-12 text-orange-400" />
              <p className="font-semibold text-gray-900">초대 링크가 만료되었습니다.</p>
              <p className="text-sm text-gray-500">관리자에게 재초대를 요청하세요.</p>
            </div>
          )}

          {status === 'used' && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <CheckCircle2 className="h-12 w-12 text-green-500" />
              <p className="font-semibold text-gray-900">이미 사용된 초대 링크입니다.</p>
              <p className="text-sm text-gray-500">이미 계정이 생성되었습니다.</p>
              <Button onClick={() => router.push('/login')} className="mt-2">로그인하기</Button>
            </div>
          )}

          {status === 'valid' && !done && invitation && (
            <>
              <div className="mb-6 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">
                  <KeyRound className="h-6 w-6 text-blue-600" />
                </div>
                <h1 className="text-lg font-bold text-gray-900">계정 설정</h1>
                <p className="mt-1 text-sm text-gray-500">INSUNG 시스템에 오신 것을 환영합니다.</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label>이름</Label>
                  <Input value={invitation.name} disabled className="bg-gray-50" />
                </div>
                <div className="space-y-1.5">
                  <Label>이메일</Label>
                  <Input value={invitation.email} disabled className="bg-gray-50" />
                </div>
                <div className="space-y-1.5">
                  <Label>비밀번호 *</Label>
                  <Input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="8자 이상 · 영문 소문자 + 특수문자 포함"
                    required
                  />
                  <p className="text-[11px] text-gray-400">8자 이상이며, 영문 소문자와 특수문자(!@#$ 등)를 각각 1자 이상 포함해야 합니다.</p>
                </div>
                <div className="space-y-1.5">
                  <Label>비밀번호 확인 *</Label>
                  <Input
                    type="password"
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    placeholder="비밀번호를 다시 입력하세요"
                    required
                  />
                </div>
                <Button type="submit" disabled={submitting} className="w-full">
                  {submitting ? '계정 생성 중...' : '계정 만들기'}
                </Button>
              </form>
            </>
          )}

          {done && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <CheckCircle2 className="h-12 w-12 text-green-500" />
              <p className="font-semibold text-gray-900">계정이 생성되었습니다!</p>
              <p className="text-sm text-gray-500">잠시 후 대시보드로 이동합니다...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

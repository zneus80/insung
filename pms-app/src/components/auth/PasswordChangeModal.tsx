'use client';

import { useState } from 'react';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { updateUser } from '@/lib/firestore';
import { useAuth } from '@/contexts/AuthContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 변경 성공 시 호출 (배너 닫기 등) */
  onSuccess?: () => void;
}

/**
 * 본인 비밀번호 변경 모달.
 * - 재인증(현재 비밀번호) → updatePassword → users.passwordChangedAt 갱신
 * - 정책: 최소 8자 + 소문자 + 숫자 (Firebase 비밀번호 정책과 일치)
 */
export default function PasswordChangeModal({ open, onOpenChange, onSuccess }: Props) {
  const { userProfile, firebaseUser } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setCurrent('');
    setNext('');
    setConfirm('');
  }

  function validate(): string | null {
    if (!current) return '현재 비밀번호를 입력해주세요.';
    if (!next || !confirm) return '새 비밀번호를 입력해주세요.';
    if (next !== confirm) return '새 비밀번호가 일치하지 않습니다.';
    if (next === current) return '새 비밀번호는 현재 비밀번호와 달라야 합니다.';
    if (next.length < 8) return '비밀번호는 최소 8자 이상이어야 합니다.';
    if (!/[a-z]/.test(next)) return '비밀번호에 소문자가 포함되어야 합니다.';
    if (!/[0-9]/.test(next)) return '비밀번호에 숫자가 포함되어야 합니다.';
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validate();
    if (err) { toast.error(err); return; }
    if (!firebaseUser?.email || !userProfile) {
      toast.error('로그인 정보를 확인할 수 없습니다.');
      return;
    }
    setSubmitting(true);
    try {
      const cred = EmailAuthProvider.credential(firebaseUser.email, current);
      await reauthenticateWithCredential(firebaseUser, cred);
      await updatePassword(firebaseUser, next);
      await updateUser(userProfile.id, { passwordChangedAt: new Date() });

      // 다른 디바이스 세션 강제 로그아웃 — 현재 세션은 즉시 새 idToken 발급으로 유지
      try {
        const idToken = await firebaseUser.getIdToken(/*forceRefresh*/ true);
        await fetch('/api/auth/revoke-sessions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${idToken}` },
        });
        // 현재 세션 토큰을 재발급해서 살리기
        await firebaseUser.getIdToken(true);
      } catch { /* revoke 실패해도 비번 변경 자체는 성공 */ }

      toast.success('비밀번호가 변경되었습니다. 다른 디바이스는 자동 로그아웃됩니다.');
      reset();
      onOpenChange(false);
      onSuccess?.();
    } catch (e: any) {
      const code = e?.code ?? '';
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        toast.error('현재 비밀번호가 올바르지 않습니다.');
      } else if (code === 'auth/weak-password') {
        toast.error('비밀번호 강도가 부족합니다. (최소 8자 + 소문자 + 숫자)');
      } else if (code === 'auth/requires-recent-login') {
        toast.error('보안을 위해 다시 로그인 후 시도해주세요.');
      } else {
        toast.error('비밀번호 변경에 실패했습니다.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>비밀번호 변경</DialogTitle>
          <DialogDescription>
            최소 8자 이상, 소문자와 숫자를 포함해야 합니다.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>현재 비밀번호</Label>
            <Input
              type="password"
              value={current}
              onChange={e => setCurrent(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label>새 비밀번호</Label>
            <Input
              type="password"
              value={next}
              onChange={e => setNext(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label>새 비밀번호 확인</Label>
            <Input
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              취소
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? '변경 중...' : '변경하기'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

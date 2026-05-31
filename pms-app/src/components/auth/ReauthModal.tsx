'use client';

/**
 * 본인 재인증 모달 — 민감 액션 직전 비밀번호 재입력 요구 (v0.9.1 / SECURITY_TODO D-2).
 *
 * 사용처:
 * - HR 마스터 권한 부여/회수 (`/admin/hr-master`)
 * - 비밀번호 초기화 (`/admin/users` 의 KeyRound 버튼)
 * - 백업 삭제 (`/admin/backup`)
 *
 * 사용 패턴:
 *   const [reauthOpen, setReauthOpen] = useState(false);
 *   const pendingAction = useRef<() => Promise<void>>();
 *
 *   async function handleSensitive() {
 *     pendingAction.current = async () => { await actuallyDoIt(); };
 *     setReauthOpen(true);
 *   }
 *
 *   <ReauthModal
 *     open={reauthOpen}
 *     onOpenChange={setReauthOpen}
 *     reason="HR 마스터 권한 부여"
 *     onConfirmed={async () => { await pendingAction.current?.(); pendingAction.current = undefined; }}
 *   />
 */
import { useState } from 'react';
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { useAuth } from '@/contexts/AuthContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { ShieldCheck } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 어떤 액션 직전인지 — 사용자에게 보여줄 짧은 설명 (예: "HR 마스터 권한 부여") */
  reason: string;
  /** 재인증 성공 시 호출 — 여기서 실제 액션 수행 */
  onConfirmed: () => Promise<void>;
}

export default function ReauthModal({ open, onOpenChange, reason, onConfirmed }: Props) {
  const { firebaseUser } = useAuth();
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function close() {
    setPassword('');
    setSubmitting(false);
    onOpenChange(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!firebaseUser?.email) {
      toast.error('로그인 정보를 확인할 수 없습니다.');
      return;
    }
    if (!password) {
      toast.error('비밀번호를 입력해주세요.');
      return;
    }
    setSubmitting(true);
    try {
      const cred = EmailAuthProvider.credential(firebaseUser.email, password);
      await reauthenticateWithCredential(firebaseUser, cred);
      // 재인증 성공 — 실제 액션 수행
      try {
        await onConfirmed();
      } catch (e: any) {
        toast.error(`작업 실패: ${e?.message ?? 'unknown'}`);
      }
      close();
    } catch (e: any) {
      const code = e?.code;
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        toast.error('비밀번호가 일치하지 않습니다.');
      } else if (code === 'auth/too-many-requests') {
        toast.error('너무 많은 시도가 있었습니다. 잠시 후 다시 시도해주세요.');
      } else {
        toast.error(`재인증 실패: ${e?.message ?? code ?? 'unknown'}`);
      }
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); else onOpenChange(true); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-amber-600" />
            본인 확인 필요
          </DialogTitle>
          <DialogDescription>
            <span className="font-semibold text-gray-900">{reason}</span> 작업을 진행하기 위해 본인 비밀번호를 다시 입력해주세요.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="reauth-password">현재 비밀번호</Label>
            <Input
              id="reauth-password"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close} disabled={submitting}>
              취소
            </Button>
            <Button type="submit" disabled={submitting || !password}>
              {submitting ? '확인 중...' : '확인'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

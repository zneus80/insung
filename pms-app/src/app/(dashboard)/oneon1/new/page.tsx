'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { createOneOnOne, getAllUsers } from '@/lib/firestore';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import type { User } from '@/types';

export default function NewOneOnOnePage() {
  const { userProfile } = useAuth();
  const router = useRouter();
  const [counterparts, setCounterparts] = useState<User[]>([]);
  const [counterpartId, setCounterpartId] = useState('');
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);

  const isLead = userProfile?.role === 'TEAM_LEAD';

  useEffect(() => {
    if (!userProfile) return;
    getAllUsers().then(users => {
      // 같은 부문의 본인 제외 모든 사용자
      setCounterparts(users.filter(u =>
        u.id !== userProfile.id && u.organizationId === userProfile.organizationId
      ));
    });
  }, [userProfile]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!userProfile || !counterpartId) return;
    setLoading(true);
    try {
      const id = await createOneOnOne({
        leaderId: isLead ? userProfile.id : counterpartId,
        memberId: isLead ? counterpartId : userProfile.id,
        organizationId: userProfile.organizationId,
        title: title.trim() || '',
      });
      toast.success('1on1 대화가 시작되었습니다.');
      router.push(`/oneon1/${id}`);
    } catch {
      toast.error('생성에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="1on1 대화 시작" showBack />
      <div className="flex-1 p-6">
        <div className="mx-auto max-w-md">
          <div className="rounded-xl border bg-white p-6 space-y-5">
            <h3 className="font-semibold text-gray-900">새 1on1 대화</h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label>{isLead ? '팀원 선택' : '팀장 선택'} *</Label>
                <Select value={counterpartId} onValueChange={(v: string | null) => setCounterpartId(v ?? '')}>
                  <SelectTrigger>
                    {counterpartId
                      ? <span className="flex flex-1 text-left">{(() => { const u = counterparts.find(c => c.id === counterpartId); return u ? `${u.name}${u.position ? ` (${u.position})` : ''}` : ''; })()}</span>
                      : <SelectValue placeholder={isLead ? '팀원을 선택하세요' : '팀장을 선택하세요'} />
                    }
                  </SelectTrigger>
                  <SelectContent>
                    {counterparts.map(u => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name}{u.position ? ` (${u.position})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>주제 <span className="text-gray-400 text-xs">(선택)</span></Label>
                <Input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="예) 2분기 목표 점검, 커리어 상담"
                />
              </div>
              <Button type="submit" disabled={loading || !counterpartId} className="w-full">
                {loading ? '생성 중...' : '대화 시작'}
              </Button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

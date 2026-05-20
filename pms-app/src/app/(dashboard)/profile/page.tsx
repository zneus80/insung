'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { updateUserProfile } from '@/lib/firestore';
import Header from '@/components/layout/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

export default function ProfilePage() {
  const { userProfile, firebaseUser } = useAuth();

  const [position, setPosition] = useState('');
  const [rank, setRank] = useState('');
  const [hireDate, setHireDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  useEffect(() => {
    if (!userProfile) return;
    setPosition(userProfile.position ?? '');
    setRank(userProfile.rank ?? '');
    setHireDate(userProfile.hireDate ?? '');
  }, [userProfile]);

  function showToast(msg: string) {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 3000);
  }

  async function handleSave() {
    if (!userProfile) return;
    setSaving(true);
    try {
      await updateUserProfile(userProfile.id, {
        position: position.trim() || undefined,
        rank: rank.trim() || undefined,
        hireDate: hireDate || undefined,
      });
      showToast('저장 완료');
    } catch (e: any) {
      console.error('프로필 저장 실패:', e);
      showToast('저장 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="내 프로필" showBack />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-lg mx-auto space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">기본 정보</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* 이름 (읽기전용) */}
              <div className="space-y-1.5">
                <Label htmlFor="name">이름</Label>
                <Input
                  id="name"
                  value={userProfile?.name ?? ''}
                  readOnly
                  className="bg-gray-50 cursor-not-allowed"
                />
              </div>

              {/* 이메일 (읽기전용) */}
              <div className="space-y-1.5">
                <Label htmlFor="email">이메일</Label>
                <Input
                  id="email"
                  value={firebaseUser?.email ?? ''}
                  readOnly
                  className="bg-gray-50 cursor-not-allowed"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">인사 정보</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* 직책 (편집) */}
              <div className="space-y-1.5">
                <Label htmlFor="position">직책</Label>
                <Input
                  id="position"
                  value={position}
                  onChange={e => setPosition(e.target.value)}
                  placeholder="예: 팀장, 파트장"
                />
              </div>

              {/* 입사일 (편집) */}
              <div className="space-y-1.5">
                <Label htmlFor="hireDate">입사일</Label>
                <Input
                  id="hireDate"
                  type="date"
                  value={hireDate}
                  onChange={e => setHireDate(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          <Button
            onClick={handleSave}
            disabled={saving}
            className="w-full"
          >
            {saving ? '저장 중...' : '저장'}
          </Button>
        </div>
      </div>

      {/* 토스트 */}
      {toastMessage && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-lg bg-gray-900 px-5 py-3 text-sm text-white shadow-lg animate-in fade-in slide-in-from-bottom-2">
          {toastMessage}
        </div>
      )}
    </div>
  );
}

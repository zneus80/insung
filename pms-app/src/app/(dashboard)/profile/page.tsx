'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { getOrganizations } from '@/lib/firestore';
import Header from '@/components/layout/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Organization } from '@/types';

const ROLE_LABEL: Record<string, string> = {
  MEMBER:    '팀원',
  TEAM_LEAD: '팀장',
  EXECUTIVE: '임원',
  CEO:       '최고관리자',
};

// 내 프로필 — 모든 인사 정보는 HR 관리자가 사용자 관리에서 입력. 본인은 읽기 전용 조회만 가능.
export default function ProfilePage() {
  const { userProfile, firebaseUser } = useAuth();
  const router = useRouter();
  const [orgs, setOrgs] = useState<Organization[]>([]);

  // 임원·최고관리자는 프로필 불필요 — 대시보드로 리다이렉트
  useEffect(() => {
    if (userProfile && (userProfile.role === 'EXECUTIVE' || userProfile.role === 'CEO')) {
      router.replace('/dashboard');
    }
  }, [userProfile, router]);

  useEffect(() => {
    getOrganizations().then(setOrgs).catch(() => {});
  }, []);

  const orgName = userProfile
    ? (orgs.find(o => o.id === userProfile.organizationId)?.name ?? userProfile.organizationId)
    : '';

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
              <ReadOnlyRow label="이름" value={userProfile?.name} />
              <ReadOnlyRow label="이메일" value={firebaseUser?.email ?? userProfile?.email} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">인사 정보</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <ReadOnlyRow label="직책" value={userProfile?.position} />
              <ReadOnlyRow label="입사일" value={userProfile?.hireDate} />
              <ReadOnlyRow label="소속 조직" value={orgName} />
              <ReadOnlyRow label="역할" value={userProfile ? (ROLE_LABEL[userProfile.role] ?? userProfile.role) : ''} />
              <p className="text-xs text-gray-400 pt-2">
                인사 정보 수정이 필요하면 HR 관리자에게 요청하세요.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function ReadOnlyRow({ label, value }: { label: string; value?: string }) {
  const display = value && value.trim() !== '' ? value : '—';
  const isEmpty = display === '—';
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input
        value={display}
        readOnly
        className={isEmpty ? 'bg-gray-50 text-gray-300 cursor-not-allowed' : 'bg-gray-50 cursor-not-allowed'}
      />
    </div>
  );
}

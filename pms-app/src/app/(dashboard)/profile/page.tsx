'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { getOrganizations, getMileage, listAllInnovationActivities } from '@/lib/firestore';
import { getPmIds } from '@/lib/innovation';
import Header from '@/components/layout/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckCircle2, XCircle, TrendingUp } from 'lucide-react';
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
  // 승진요건 실적 (전사 인원현황 computePromotion 과 동일 기준 — 연도 무관 누적)
  const [spPmCount, setSpPmCount] = useState(0);
  const [spMemberCount, setSpMemberCount] = useState(0);
  const [mileagePoints, setMileagePoints] = useState(0);
  const [promoLoading, setPromoLoading] = useState(true);

  // 임원·최고관리자는 프로필 불필요 — 대시보드로 리다이렉트
  useEffect(() => {
    if (userProfile && (userProfile.role === 'EXECUTIVE' || userProfile.role === 'CEO')) {
      router.replace('/dashboard');
    }
  }, [userProfile, router]);

  useEffect(() => {
    getOrganizations().then(setOrgs).catch(() => {});
  }, []);

  // 승진요건 실적 로드 — 스마트프로젝트 PM/참여(누적), ISKMS 마일리지
  useEffect(() => {
    if (!userProfile) return;
    const uid = userProfile.id;
    (async () => {
      try {
        const [innovations, mileage] = await Promise.all([
          listAllInnovationActivities(),
          getMileage(uid),
        ]);
        let pm = 0, member = 0;
        for (const a of innovations) {
          if (a.type !== 'SMART_PROJECT') continue;
          if (getPmIds(a).includes(uid)) pm++;
          if ((a.memberIds ?? []).includes(uid)) member++;
        }
        setSpPmCount(pm);
        setSpMemberCount(member);
        setMileagePoints(mileage?.points ?? 0);
      } catch { /* 표시만 생략 */ } finally {
        setPromoLoading(false);
      }
    })();
  }, [userProfile]);

  const orgName = userProfile
    ? (orgs.find(o => o.id === userProfile.organizationId)?.name ?? userProfile.organizationId)
    : '';

  // 승진 대상 구분 — 정식 팀장은 임원 승진, 팀원·팀장대행은 팀장 승진 (전사 인원현황과 동일 기준)
  const isLeadTrack = userProfile?.role === 'TEAM_LEAD' && !userProfile?.isActingLead;

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

          {/* 승진요건 충족여부 — 전사 인원현황과 동일 기준 (연도 무관 누적 실적) */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-1.5">
                <TrendingUp className="h-4 w-4 text-indigo-500" />
                승진요건 충족여부
                <span className="text-xs font-normal text-gray-400">({isLeadTrack ? '임원 승진조건' : '팀장 승진조건'})</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {promoLoading ? (
                <div className="h-10 animate-pulse rounded-lg bg-gray-100" />
              ) : isLeadTrack ? (
                <RequirementRow
                  label="스마트 프로젝트 PM 1회"
                  actual={`${spPmCount}회`}
                  met={spPmCount >= 1}
                />
              ) : (
                <>
                  <RequirementRow
                    label="스마트 프로젝트 1회 참여"
                    actual={`${spPmCount + spMemberCount}회`}
                    met={spPmCount + spMemberCount >= 1}
                  />
                  <RequirementRow
                    label="ISKMS 마일리지 200점"
                    actual={`${mileagePoints.toLocaleString()}점`}
                    met={mileagePoints >= 200}
                  />
                </>
              )}
              <p className="text-xs text-gray-400 pt-1">
                실적은 연도 무관 누적 기준입니다. 스마트 프로젝트 실적은 혁신활동 관리, 마일리지는 마일리지 관리 데이터를 따릅니다.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// 승진 조건 한 줄 — 조건 / 실적 / 충족 배지
function RequirementRow({ label, actual, met }: { label: string; actual: string; met: boolean }) {
  return (
    <div className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${met ? 'border-green-200 bg-green-50/60' : 'border-gray-200 bg-gray-50/60'}`}>
      {met
        ? <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
        : <XCircle className="h-4 w-4 shrink-0 text-gray-300" />}
      <span className="text-sm text-gray-800 flex-1 min-w-0">{label}</span>
      <span className="text-xs text-gray-500 shrink-0">실적 <b className={met ? 'text-green-700' : 'text-gray-600'}>{actual}</b></span>
      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${met ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>
        {met ? '충족' : '미충족'}
      </span>
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

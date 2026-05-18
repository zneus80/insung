'use client';

import { useState } from 'react';
import { getUser, getMileage, getOrganizations } from '@/lib/firestore';
import { getTier } from '@/lib/mileage-tier';
import type { User, Mileage, Organization } from '@/types';

interface Props {
  userId: string;
  userName: string;
}

interface LoadedData {
  user: User | null;
  mileage: Mileage | null;
  orgs: Organization[];
}

const ROLE_LABEL: Record<string, string> = {
  MEMBER:    '팀원',
  TEAM_LEAD: '팀장',
  EXECUTIVE: '임원',
  CEO:       '최고관리자',
};

export default function MemberInfoModal({ userId, userName }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<LoadedData | null>(null);

  async function handleOpen() {
    setOpen(true);
    if (data) return; // 이미 로드된 경우 재사용
    setLoading(true);
    try {
      const [user, mileage, orgs] = await Promise.all([
        getUser(userId),
        getMileage(userId),
        getOrganizations(),
      ]);
      setData({ user, mileage, orgs });
    } finally {
      setLoading(false);
    }
  }

  const orgName = data?.user
    ? (data.orgs.find(o => o.id === data.user!.organizationId)?.name ?? data.user.organizationId)
    : '';

  const tier = data?.mileage ? getTier(data.mileage.points) : null;

  return (
    <>
      <button
        onClick={handleOpen}
        className="text-sm font-medium text-blue-600 hover:underline"
      >
        {userName}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* 배경 오버레이 */}
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />

          {/* 모달 */}
          <div className="relative z-10 w-full max-w-md max-h-[85vh] overflow-y-auto rounded-2xl bg-white shadow-xl">
            {/* 헤더 */}
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-start justify-between">
              <div>
                <h2 className="font-semibold text-gray-900">{userName} 프로필</h2>
                <p className="text-xs text-gray-400 mt-0.5">개인 프로필 및 마일리지 정보</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 text-lg leading-none shrink-0 ml-4"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-6">
              {loading ? (
                <div className="flex items-center justify-center py-10">
                  <div className="h-6 w-6 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
                </div>
              ) : !data?.user ? (
                <p className="text-sm text-gray-400 text-center py-8">사용자 정보를 불러올 수 없습니다.</p>
              ) : (
                <>
                  {/* 개인 프로필 */}
                  <Section title="개인 프로필">
                    <Row label="이름"     value={data.user.name} />
                    <Row label="이메일"   value={data.user.email} />
                    <Row label="직책"     value={data.user.position} />
                    <Row label="직급"     value={data.user.rank} />
                    <Row label="입사일"   value={data.user.hireDate} />
                    <Row label="소속 조직" value={orgName} />
                    <Row label="역할"     value={ROLE_LABEL[data.user.role] ?? data.user.role} />
                  </Section>

                  {/* 마일리지 */}
                  <Section title="마일리지">
                    {data.mileage ? (
                      <>
                        <div className="px-4 py-3 flex items-center justify-between">
                          <span className="text-xs font-medium text-gray-500">총 마일리지</span>
                          <span className="text-lg font-bold text-gray-900">{data.mileage.points.toLocaleString()}점</span>
                        </div>
                        {tier && (
                          <div className="px-4 py-3 flex items-center justify-between border-t">
                            <span className="text-xs font-medium text-gray-500">티어</span>
                            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${tier.badge}`}>
                              {tier.icon} {tier.label}
                            </span>
                          </div>
                        )}
                        {data.mileage.submitTds !== undefined && (
                          <div className="px-4 py-3 flex items-center justify-between border-t">
                            <span className="text-xs font-medium text-gray-500">제출 TDS</span>
                            <span className="text-sm text-gray-800">{data.mileage.submitTds}점</span>
                          </div>
                        )}
                        {data.mileage.instructTds !== undefined && (
                          <div className="px-4 py-3 flex items-center justify-between border-t">
                            <span className="text-xs font-medium text-gray-500">지시 TDS</span>
                            <span className="text-sm text-gray-800">{data.mileage.instructTds}점</span>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="px-4 py-3">
                        <p className="text-sm text-gray-400">마일리지 정보 없음</p>
                      </div>
                    )}
                  </Section>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{title}</h3>
      <div className="rounded-xl border bg-gray-50 divide-y">
        {children}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="px-4 py-3 flex items-start gap-3">
      <span className="text-xs font-medium text-gray-500 shrink-0 min-w-[80px]">{label}</span>
      <span className="text-sm text-gray-800">{value}</span>
    </div>
  );
}

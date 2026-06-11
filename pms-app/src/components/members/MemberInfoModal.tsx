'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { getUser, getMileage, getOrganizations, getAwardsByUser, listInnovationActivitiesByUser } from '@/lib/firestore';
import { getTier } from '@/lib/mileage-tier';
import { getPmIds, getPerformerIds } from '@/lib/innovation';
import { useAuth } from '@/contexts/AuthContext';
import { useActiveYear } from '@/contexts/ActiveYearContext';
import type { User, Mileage, Organization, Award, InnovationActivity } from '@/types';

interface Props {
  userId: string;
  userName: string;
  /** 대상 사용자 역할 — 임원(EXECUTIVE)·CEO 는 프로필 비공개 대상이라 클릭 비활성. 미지정 시 제한 없음. */
  targetRole?: string;
  /** 커스텀 트리거 — 미지정 시 기본은 userName 텍스트 (파란 링크 스타일) */
  renderTrigger?: (open: () => void) => React.ReactNode;
  /** 제어 모드 — open/onOpenChange 모두 지정 시 내부 트리거 없이 외부 제어 */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface LoadedData {
  user: User | null;
  mileage: Mileage | null;
  orgs: Organization[];
  awards: Award[];
  innovations: InnovationActivity[];
}

const ROLE_LABEL: Record<string, string> = {
  MEMBER:    '팀원',
  TEAM_LEAD: '팀장',
  EXECUTIVE: '임원',
  CEO:       '최고관리자',
};

export default function MemberInfoModal({ userId, userName, targetRole, renderTrigger, open: openProp, onOpenChange }: Props) {
  const { userProfile } = useAuth();
  const { activeYear } = useActiveYear();
  const isControlled = typeof openProp === 'boolean' && typeof onOpenChange === 'function';
  const isSelfView = userProfile?.id === userId;
  // 대상이 임원·CEO 면 프로필 비공개 (다른 사람이 클릭해도 모달 안 뜸). 단, controlled(본인 제어) 는 예외 없음.
  const targetIsExecOrCeo = targetRole === 'EXECUTIVE' || targetRole === 'CEO';
  // 프로필 보기 권한: 팀원 역할 제외 (팀장·임원·CEO·HR 만 활성)
  // 단, 본인 클릭(헤더의 '내 프로필' 등) 은 항상 허용 — controlled 모드는 외부 제어이므로 항상 허용.
  const canViewProfile = isControlled || isSelfView ||
    (!targetIsExecOrCeo && !!userProfile && (userProfile.role !== 'MEMBER' || !!userProfile.isHrAdmin));
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? openProp! : internalOpen;
  const setOpen = (v: boolean) => {
    if (isControlled) onOpenChange!(v);
    else setInternalOpen(v);
  };
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<LoadedData | null>(null);

  async function handleOpen() {
    setOpen(true);
    if (data) return; // 이미 로드된 경우 재사용
    setLoading(true);
    try {
      const [user, mileage, orgs, awards, innovations] = await Promise.all([
        getUser(userId),
        getMileage(userId),
        getOrganizations(),
        getAwardsByUser(userId),
        listInnovationActivitiesByUser(userId), // 전체 연도 누적 — 과거 혁신활동까지 반영
      ]);
      setData({ user, mileage, orgs, awards, innovations });
    } finally {
      setLoading(false);
    }
  }

  // 제어 모드에서 외부가 open=true 로 바꾸면 데이터 로드
  useEffect(() => {
    if (isControlled && openProp && !data && !loading) {
      handleOpen();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isControlled, openProp]);

  const orgName = data?.user
    ? (data.orgs.find(o => o.id === data.user!.organizationId)?.name ?? data.user.organizationId)
    : '';

  const tier = data?.mileage ? getTier(data.mileage.points) : null;

  return (
    <>
      {isControlled ? null : !canViewProfile ? (
        // 팀원 역할은 프로필 보기 비활성 — 일반 텍스트로 표시
        <span className="text-sm font-medium text-gray-800">{userName}</span>
      ) : renderTrigger ? renderTrigger(handleOpen) : (
        <span
          role="button"
          tabIndex={0}
          onClick={e => { e.stopPropagation(); handleOpen(); }}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); handleOpen(); } }}
          className="text-sm font-medium text-blue-600 hover:underline cursor-pointer"
        >
          {userName}
        </span>
      )}

      {open && createPortal(
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
                    <Row label="입사일"   value={data.user.hireDate} />
                    <Row label="소속 조직" value={orgName} />
                  </Section>

                  {/* 승진요건 충족여부 — 전사 인원현황과 동일 기준 (연도 무관 누적) */}
                  <PromotionSection user={data.user} mileage={data.mileage} innovations={data.innovations} />

                  {/* 포상이력 */}
                  <Section title="포상이력">
                    {data.awards.length === 0 ? (
                      <div className="px-4 py-3">
                        <p className="text-sm text-gray-400">포상이력 없음</p>
                      </div>
                    ) : (
                      data.awards.map(award => (
                        <div key={award.id} className="px-4 py-3 flex items-start justify-between gap-3">
                          <div className="flex-1">
                            <p className="text-sm font-medium text-gray-800">{award.title}</p>
                            {award.description && (
                              <p className="text-xs text-gray-500 mt-0.5">{award.description}</p>
                            )}
                          </div>
                          <span className="text-xs text-gray-400 shrink-0">{award.awardDate}</span>
                        </div>
                      ))
                    )}
                  </Section>

                  {/* 마일리지 — 항상 총 마일리지 + 티어 2행 양식 (submit/instruct TDS 는 입력 UI 미구현 상태라 미표기) */}
                  <Section title="마일리지">
                    <div className="px-4 py-3 flex items-center justify-between">
                      <span className="text-xs font-medium text-gray-500">총 마일리지</span>
                      <span className="text-lg font-bold text-gray-900">{(data.mileage?.points ?? 0).toLocaleString()}점</span>
                    </div>
                    <div className="px-4 py-3 flex items-center justify-between border-t">
                      <span className="text-xs font-medium text-gray-500">티어</span>
                      {tier ? (
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${tier.badge}`}>
                          {tier.icon} {tier.label}
                        </span>
                      ) : (
                        <span className="text-sm text-gray-300">—</span>
                      )}
                    </div>
                  </Section>

                  {/* 혁신활동 실적 */}
                  <InnovationSection userId={userId} year={activeYear} items={data.innovations} />
                </>
              )}
            </div>
          </div>
        </div>
      , document.body)}
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
  const display = value && value.trim() !== '' ? value : '—';
  const isEmpty = display === '—';
  return (
    <div className="px-4 py-3 flex items-start gap-3">
      <span className="text-xs font-medium text-gray-500 shrink-0 min-w-[80px]">{label}</span>
      <span className={isEmpty ? 'text-sm text-gray-300' : 'text-sm text-gray-800'}>{display}</span>
    </div>
  );
}

// 승진요건 충족여부 — 전사 인원현황 computePromotion 과 동일 기준 (연도 무관 누적).
// 정식 팀장 → 임원 승진조건(SP PM 1회) / 팀원·팀장대행 → 팀장 승진조건(SP 1회 참여 + ISKMS 마일리지 200점).
function PromotionSection({ user, mileage, innovations }: { user: User; mileage: Mileage | null; innovations: InnovationActivity[] }) {
  // 임원·CEO 는 승진요건 대상 아님
  if (user.role === 'EXECUTIVE' || user.role === 'CEO') return null;

  const spPmCount = innovations.filter(a => a.type === 'SMART_PROJECT' && getPmIds(a).includes(user.id)).length;
  const spMemberCount = innovations.filter(a => a.type === 'SMART_PROJECT' && (a.memberIds ?? []).includes(user.id)).length;
  const points = mileage?.points ?? 0;
  const isLeadTrack = user.role === 'TEAM_LEAD' && !user.isActingLead;

  const rows = isLeadTrack
    ? [{ label: '스마트 프로젝트 PM 1회', actual: `${spPmCount}회`, met: spPmCount >= 1 }]
    : [
        { label: '스마트 프로젝트 1회 참여', actual: `${spPmCount + spMemberCount}회`, met: spPmCount + spMemberCount >= 1 },
        { label: 'ISKMS 마일리지 200점', actual: `${points.toLocaleString()}점`, met: points >= 200 },
      ];

  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
        승진요건 충족여부 <span className="normal-case font-normal">({isLeadTrack ? '임원 승진조건' : '팀장 승진조건'})</span>
      </h3>
      <div className="rounded-xl border bg-gray-50 divide-y">
        {rows.map(r => (
          <div key={r.label} className="px-4 py-3 flex items-center gap-2">
            <span className="text-sm text-gray-800 flex-1 min-w-0">{r.label}</span>
            <span className="text-xs text-gray-500 shrink-0">실적 <b className={r.met ? 'text-green-700' : 'text-gray-600'}>{r.actual}</b></span>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${r.met ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>
              {r.met ? '충족' : '미충족'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// 혁신활동 실적 — 스마트프로젝트 PM/참여, TDS 지시/수행 카운트. 클릭 시 주제 목록 노출.
function InnovationSection({ userId, year, items }: { userId: string; year: number; items: InnovationActivity[] }) {
  const [openKey, setOpenKey] = useState<'sp-pm' | 'sp-mem' | 'tds-ins' | 'tds-per' | null>(null);
  const spPm = items.filter(a => a.type === 'SMART_PROJECT' && getPmIds(a).includes(userId));
  const spMem = items.filter(a => a.type === 'SMART_PROJECT' && (a.memberIds ?? []).includes(userId));
  const tdsIns = items.filter(a => a.type === 'TDS' && a.instructorId === userId);
  const tdsPer = items.filter(a => a.type === 'TDS' && getPerformerIds(a).includes(userId));

  const cells: Array<{ key: typeof openKey; label: string; list: InnovationActivity[]; cls: string }> = [
    { key: 'sp-pm', label: '스마트프로젝트 PM', list: spPm, cls: 'text-purple-700' },
    { key: 'sp-mem', label: '스마트프로젝트 참여', list: spMem, cls: 'text-purple-700' },
    { key: 'tds-ins', label: 'TDS 지시', list: tdsIns, cls: 'text-cyan-700' },
    { key: 'tds-per', label: 'TDS 수행', list: tdsPer, cls: 'text-cyan-700' },
  ];

  const openList = cells.find(c => c.key === openKey)?.list ?? [];

  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">혁신활동 실적 (누적)</h3>
      <div className="rounded-xl border bg-gray-50 overflow-hidden">
        <div className="grid grid-cols-2 divide-x divide-y">
          {cells.map(c => {
            const active = openKey === c.key;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => setOpenKey(active ? null : c.key)}
                disabled={c.list.length === 0}
                className={`px-4 py-3 text-left transition-colors ${active ? 'bg-white' : 'hover:bg-white/60'} disabled:cursor-default disabled:opacity-60`}
              >
                <p className="text-xs text-gray-500">{c.label}</p>
                <p className={`text-lg font-bold mt-0.5 ${c.list.length > 0 ? c.cls : 'text-gray-300'}`}>
                  {c.list.length}<span className="text-xs font-normal text-gray-400 ml-1">건</span>
                </p>
              </button>
            );
          })}
        </div>
        {openKey && openList.length > 0 && (
          <div className="border-t bg-white px-4 py-3 space-y-1.5">
            <p className="text-xs font-semibold text-gray-500">{cells.find(c => c.key === openKey)?.label} 목록</p>
            <ul className="space-y-1">
              {openList.map(a => (
                <li key={a.id} className="text-sm text-gray-700 flex items-center gap-2">
                  <span className={`text-[10px] font-semibold rounded-full px-1.5 py-0.5 ${a.status === 'COMPLETED' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                    {a.status === 'COMPLETED' ? '완료' : '추진중'}
                  </span>
                  <span>{a.name}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

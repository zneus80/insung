'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  getAllUsers, getOrganizations, getMentoringFormsByUsers,
} from '@/lib/firestore';
import { useActiveYear } from '@/contexts/ActiveYearContext';
import Header from '@/components/layout/Header';
import AuthGuard from '@/components/layout/AuthGuard';
import { ChevronDown, ChevronRight, MessageSquareHeart, AlertCircle, Pencil } from 'lucide-react';
import MemberInfoModal from '@/components/members/MemberInfoModal';
import { cn } from '@/lib/utils';
import type { User, Organization, MentoringForm, JobRequestType } from '@/types';

const JOB_REQUEST_LABELS: Record<JobRequestType, string> = {
  EXPAND:    '① 직무 확대',
  REDUCE:    '② 직무 축소',
  CHANGE:    '③ 직무 변경',
  RELOCATE:  '④ 근무지 이동',
  SATISFIED: '● 만족함',
};

export default function MentoringAllPage() {
  return (
    <AuthGuard allowedRoles={['CEO']} requireHrAdmin>
      <MentoringAllContent />
    </AuthGuard>
  );
}

function MentoringAllContent() {
  const searchParams = useSearchParams();
  const { activeYear } = useActiveYear();
  const initYear = Number(searchParams.get('year') ?? activeYear) || activeYear;
  const [selectedYear, setSelectedYear] = useState(initYear);
  const YEAR_TABS = [activeYear, activeYear - 1, activeYear - 2];

  const [users, setUsers] = useState<User[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [forms, setForms] = useState<Record<string, MentoringForm>>({});
  const [loading, setLoading] = useState(true);
  const [expandedOrgs, setExpandedOrgs] = useState<Set<string>>(new Set());
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [selectedForm, setSelectedForm] = useState<MentoringForm | null>(null);
  // URL ?user= 자동 선택 1회 플래그 (로드 후)
  const userParam = searchParams.get('user');
  const [userParamApplied, setUserParamApplied] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setSelectedUser(null);
      setSelectedForm(null);
      try {
        const [allUsers, allOrgs] = await Promise.all([getAllUsers(), getOrganizations()]);
        const active = allUsers.filter(u => u.isActive);
        setUsers(active);
        setOrgs(allOrgs);

        const formList = await getMentoringFormsByUsers(active.map(u => u.id), selectedYear);
        const formMap: Record<string, MentoringForm> = {};
        formList.forEach(f => { if (f) formMap[f.userId] = f; });
        setForms(formMap);

        const topOrgs = allOrgs.filter(o => !o.parentId);
        if (topOrgs.length > 0) setExpandedOrgs(new Set([topOrgs[0].id]));

        // URL ?user= 가 있고 아직 적용 전이면 자동 선택 + 해당 조직 펼치기
        if (userParam && !userParamApplied) {
          const target = active.find(u => u.id === userParam);
          if (target) {
            setSelectedUser(target);
            setSelectedForm(formMap[target.id] ?? null);
            // 조직 체인 모두 펼치기
            const chain = new Set<string>();
            let cur = allOrgs.find(o => o.id === target.organizationId);
            while (cur) { chain.add(cur.id); cur = cur.parentId ? allOrgs.find(o => o.id === cur!.parentId) : undefined; }
            setExpandedOrgs(prev => new Set([...prev, ...chain]));
          }
          setUserParamApplied(true);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [selectedYear, userParam, userParamApplied]);


  const usersByOrg = users.reduce<Record<string, User[]>>((acc, u) => {
    (acc[u.organizationId] ??= []).push(u);
    return acc;
  }, {});

  function toggleOrg(orgId: string) {
    setExpandedOrgs(prev => {
      const next = new Set(prev);
      next.has(orgId) ? next.delete(orgId) : next.add(orgId);
      return next;
    });
  }

  function handleSelectUser(user: User) {
    setSelectedUser(user);
    setSelectedForm(forms[user.id] ?? null);
  }

  const STATUS_LABEL: Record<string, string> = {
    DRAFT: '작성중',
    SUBMITTED: '제출완료',
  };
  const STATUS_COLOR: Record<string, string> = {
    DRAFT: 'bg-gray-100 text-gray-500',
    SUBMITTED: 'bg-green-100 text-green-700',
  };

  return (
    <div className="flex flex-col h-full">
      <Header title="전사 육성면담서 확인" />

      {/* 연도 탭 */}
      <div className="flex items-center gap-2 px-6 py-3 bg-gray-50 border-b shrink-0">
        {YEAR_TABS.map(year => (
          <button
            key={year}
            onClick={() => setSelectedYear(year)}
            className={cn(
              'px-4 py-1.5 rounded-full text-sm font-medium transition-colors',
              selectedYear === year
                ? 'bg-blue-600 text-white'
                : 'bg-white border border-gray-200 text-gray-500 hover:text-gray-700',
            )}
          >
            {year}년
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden flex">
        {/* 좌측: 조직/팀원 목록 */}
        <div className="w-72 border-r overflow-y-auto flex-shrink-0 bg-gray-50">
          <div className="p-4 space-y-1">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
              {selectedYear}년 육성면담서
            </p>
            {loading ? (
              <div className="space-y-2">
                {[1,2,3].map(i => <div key={i} className="h-8 animate-pulse rounded bg-gray-200" />)}
              </div>
            ) : (
              orgs.filter(o => !o.parentId).map(topOrg => (
                <OrgTree
                  key={topOrg.id}
                  org={topOrg}
                  allOrgs={orgs}
                  usersByOrg={usersByOrg}
                  forms={forms}
                  expandedOrgs={expandedOrgs}
                  selectedUserId={selectedUser?.id}
                  onToggle={toggleOrg}
                  onSelectUser={handleSelectUser}
                  statusLabel={STATUS_LABEL}
                  statusColor={STATUS_COLOR}
                />
              ))
            )}
          </div>
        </div>

        {/* 우측: 육성면담서 상세 */}
        <div className="flex-1 overflow-y-auto p-6">
          {!selectedUser ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <MessageSquareHeart className="h-12 w-12 mb-3 opacity-30" />
              <p className="text-sm">좌측에서 팀원을 선택하면 육성면담서를 확인할 수 있습니다.</p>
            </div>
          ) : !selectedForm ? (
            <div className="max-w-2xl">
              <h2 className="text-lg font-bold text-gray-900 mb-1"><MemberInfoModal userId={selectedUser.id} userName={selectedUser.name} /></h2>
              <p className="text-sm text-gray-500 mb-6">{selectedUser.position ?? ''}</p>
              <div className="rounded-xl border border-dashed bg-gray-50 p-12 text-center">
                <p className="text-sm text-gray-400">아직 작성된 육성면담서가 없습니다.</p>
              </div>
            </div>
          ) : (
            <div className="max-w-2xl space-y-6">
              <div>
                <h2 className="text-lg font-bold text-gray-900"><MemberInfoModal userId={selectedUser.id} userName={selectedUser.name} /></h2>
                <p className="text-sm text-gray-500">{selectedUser.position ?? ''} · {selectedYear}년 육성면담서</p>
                <span className={cn('inline-block mt-1 text-xs px-2 py-0.5 rounded-full font-medium', STATUS_COLOR[selectedForm.status])}>
                  {STATUS_LABEL[selectedForm.status]}
                </span>
              </div>

              {/* 수정 요청 대기 안내 (정보만 표시 — 처리는 알림에서) */}
              {selectedForm.editRequestPending && (
                <div className="flex items-start gap-3 rounded-xl border border-blue-300 bg-blue-50 p-4">
                  <AlertCircle className="h-5 w-5 shrink-0 text-blue-600 mt-0.5" />
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <Pencil className="h-4 w-4 text-blue-700" />
                      <p className="font-semibold text-blue-900">수정 요청 대기 중</p>
                      {selectedForm.editRequestedAt && (
                        <span className="text-xs text-blue-700/70">
                          {new Date(selectedForm.editRequestedAt).toLocaleDateString('ko-KR')} 요청
                        </span>
                      )}
                    </div>
                    {selectedForm.editRequestReason && (
                      <div className="rounded-md bg-white/60 border border-blue-200 px-3 py-2">
                        <p className="text-xs font-medium text-blue-700 mb-0.5">요청 사유</p>
                        <p className="text-sm text-blue-900 whitespace-pre-wrap">{selectedForm.editRequestReason}</p>
                      </div>
                    )}
                    <p className="text-xs text-blue-700/80">알림함에서 [수정 허가] / [거절] 로 처리할 수 있습니다.</p>
                  </div>
                </div>
              )}

              <Section title="직무 정보">
                <Row label="직책" value={selectedForm.currentPosition} />
                <Row label="주요담당업무" value={selectedForm.mainDuties} />
                <Row label="현 직위 승진일" value={selectedForm.promotionDate} />
                <Row label="보유자격증" value={selectedForm.certifications} />
                <Row label="주요 업적" value={selectedForm.achievements} multiline />
              </Section>

              <Section title="경력개발 계획">
                <Row label="희망 Position" value={selectedForm.careerPlan} multiline />
              </Section>

              <Section title="직무 요청사항">
                <Row label="요청 유형" value={JOB_REQUEST_LABELS[selectedForm.jobRequest] ?? selectedForm.jobRequest} />
                {/* ①② 직무 확대/축소 이유 */}
                {(selectedForm.jobRequest === 'EXPAND' || selectedForm.jobRequest === 'REDUCE') && (
                  <Row label="이유" value={selectedForm.jobRequestReason} multiline />
                )}
                {/* ③ 직무 변경 — 희망 직무 1·2순위 + 변경 이유 */}
                {selectedForm.jobRequest === 'CHANGE' && (
                  <>
                    <Row label="희망 직무 1순위" value={selectedForm.desiredJob1} />
                    <Row label="희망 직무 2순위" value={selectedForm.desiredJob2} />
                    <Row label="직무 변경 희망 이유" value={selectedForm.jobChangeReason} multiline />
                  </>
                )}
                {/* ④ 근무지 이동 — 희망 근무지 1·2순위 + 변경 이유 */}
                {selectedForm.jobRequest === 'RELOCATE' && (
                  <>
                    <Row label="희망 근무지 1순위" value={selectedForm.desiredLocation1} />
                    <Row label="희망 근무지 2순위" value={selectedForm.desiredLocation2} />
                    <Row label="근무지 변경 희망 이유" value={selectedForm.locationChangeReason} multiline />
                  </>
                )}
              </Section>

              <Section title="종합 의견">
                <Row label="본인 종합의견" value={selectedForm.selfOpinion} multiline />
                <Row label="면담자 의견" value={selectedForm.interviewerOpinion} multiline />
              </Section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function OrgTree({ org, allOrgs, usersByOrg, forms, expandedOrgs, selectedUserId, onToggle, onSelectUser, statusLabel, statusColor }: {
  org: Organization;
  allOrgs: Organization[];
  usersByOrg: Record<string, User[]>;
  forms: Record<string, MentoringForm>;
  expandedOrgs: Set<string>;
  selectedUserId?: string;
  onToggle: (id: string) => void;
  onSelectUser: (u: User) => void;
  statusLabel: Record<string, string>;
  statusColor: Record<string, string>;
}) {
  const children = allOrgs.filter(o => o.parentId === org.id);
  const members = usersByOrg[org.id] ?? [];
  const isExpanded = expandedOrgs.has(org.id);

  return (
    <div>
      <button
        onClick={() => onToggle(org.id)}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-left text-xs font-semibold text-gray-700 hover:bg-gray-100 transition-colors"
      >
        {isExpanded
          ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-gray-400" />
          : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-400" />}
        {org.name}
      </button>
      {isExpanded && (
        <div className="ml-3 border-l border-gray-200 pl-2 space-y-0.5 mt-0.5">
          {members.map(u => {
            const f = forms[u.id];
            return (
              <button
                key={u.id}
                onClick={() => onSelectUser(u)}
                className={cn(
                  'w-full flex items-center justify-between px-2 py-1.5 rounded-md text-left text-xs transition-colors',
                  selectedUserId === u.id
                    ? 'bg-blue-100 text-blue-800 font-medium'
                    : 'text-gray-600 hover:bg-gray-100',
                )}
              >
                <span className="truncate flex items-center gap-1">
                  {u.name}{u.position ? ` (${u.position})` : ''}
                  {f?.editRequestPending && (
                    <span
                      className="inline-block h-1.5 w-1.5 rounded-full bg-red-500"
                      title="수정 요청 대기 중"
                    />
                  )}
                </span>
                {f && (
                  <span className={cn('shrink-0 ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium', statusColor[f.status])}>
                    {statusLabel[f.status]}
                  </span>
                )}
              </button>
            );
          })}
          {children.map(child => (
            <OrgTree
              key={child.id}
              org={child}
              allOrgs={allOrgs}
              usersByOrg={usersByOrg}
              forms={forms}
              expandedOrgs={expandedOrgs}
              selectedUserId={selectedUserId}
              onToggle={onToggle}
              onSelectUser={onSelectUser}
              statusLabel={statusLabel}
              statusColor={statusColor}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-white p-5 space-y-3">
      <h3 className="text-sm font-semibold text-gray-800 border-b pb-2">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Row({ label, value, multiline }: { label: string; value?: string; multiline?: boolean }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
      {multiline
        ? <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{value}</p>
        : <p className="text-sm text-gray-700">{value}</p>
      }
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  getAllUsers, getOrganizations, getMentoringFormsByUsers,
  getSelfEvaluationsByUsers, getAllIndividualEvaluations,
} from '@/lib/firestore';
import { useActiveYear } from '@/contexts/ActiveYearContext';
import { useAuth } from '@/contexts/AuthContext';
import Header from '@/components/layout/Header';
import AuthGuard from '@/components/layout/AuthGuard';
import { ChevronDown, ChevronRight, MessageSquareHeart, AlertCircle, Pencil, Search } from 'lucide-react';
import MemberInfoModal from '@/components/members/MemberInfoModal';
import MentoringPerfBody from '@/components/evaluation/MentoringPerfBody';
import SelfEvalBody, { computeSelfEvalTotal } from '@/components/evaluation/SelfEvalBody';
import { SearchInput } from '@/components/ui/search-input';
import { cn } from '@/lib/utils';
import { compareOrgByDisplayOrder } from '@/lib/approval-filters';
import type { User, Organization, MentoringForm, JobRequestType, SelfEvaluation, IndividualEvaluation, EvaluationGrade } from '@/types';

// 평가등급 칩 색상 (평가 화면과 동일 톤)
const GRADE_CHIP: Record<string, string> = {
  A: 'bg-blue-100 text-blue-700',
  B: 'bg-green-100 text-green-700',
  C: 'bg-gray-100 text-gray-700',
  D: 'bg-orange-100 text-orange-700',
  E: 'bg-red-100 text-red-600',
};

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
  const { userProfile } = useAuth();
  // CEO·HR마스터 = 평가등급·자기평가 포함 풀 버전 / HR관리자(마스터 아님) = 기존 육성면담서 확인만
  const fullView = userProfile?.role === 'CEO' || !!userProfile?.isHrMaster;
  const searchParams = useSearchParams();
  const { activeYear } = useActiveYear();
  const initYear = Number(searchParams.get('year') ?? activeYear) || activeYear;
  const [selectedYear, setSelectedYear] = useState(initYear);
  const YEAR_TABS = [activeYear, activeYear - 1, activeYear - 2];

  const [users, setUsers] = useState<User[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [forms, setForms] = useState<Record<string, MentoringForm>>({});
  const [selfEvals, setSelfEvals] = useState<Record<string, SelfEvaluation>>({});
  const [indivEvals, setIndivEvals] = useState<Record<string, IndividualEvaluation>>({});
  const [loading, setLoading] = useState(true);
  const [expandedOrgs, setExpandedOrgs] = useState<Set<string>>(new Set());
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [selectedForm, setSelectedForm] = useState<MentoringForm | null>(null);
  const [search, setSearch] = useState('');
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
        // 임원·CEO 는 육성면담서 작성 대상이 아니므로 전사 확인 목록에서 제외
        const active = allUsers.filter(u => u.isActive && u.role !== 'EXECUTIVE' && u.role !== 'CEO');
        setUsers(active);
        setOrgs(allOrgs.filter(o => !o.archivedAt)); // 아카이브된 조직(예: 과거 총무팀) 제외 — 중복 표시 방지

        const ids = active.map(u => u.id);
        const [formList, seList, ieList] = await Promise.all([
          getMentoringFormsByUsers(ids, selectedYear),
          fullView ? getSelfEvaluationsByUsers(ids, selectedYear) : Promise.resolve([] as SelfEvaluation[]),
          fullView ? getAllIndividualEvaluations(selectedYear) : Promise.resolve([] as IndividualEvaluation[]),
        ]);
        const formMap: Record<string, MentoringForm> = {};
        formList.forEach(f => { if (f) formMap[f.userId] = f; });
        setForms(formMap);
        const seMap: Record<string, SelfEvaluation> = {};
        seList.forEach(se => { if (se) seMap[se.userId] = se; });
        setSelfEvals(seMap);
        const ieMap: Record<string, IndividualEvaluation> = {};
        ieList.forEach(ie => { ieMap[ie.userId] = ie; });
        setIndivEvals(ieMap);

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
      <Header title={fullView ? "전사 육성면담서·자기평가" : "전사 육성면담서 확인"} />

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
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              {selectedYear}년 육성면담서{fullView ? '·자기평가' : ''}
            </p>
            {/* 검색 */}
            <div className="mb-3">
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="이름·직책 검색"
                showSearchIcon
                className="w-full"
              />
            </div>
            {loading ? (
              <div className="space-y-2">
                {[1,2,3].map(i => <div key={i} className="h-8 animate-pulse rounded bg-gray-200" />)}
              </div>
            ) : search.trim() ? (
              // 검색 모드: 매칭 사용자 평면 목록
              (() => {
                const s = search.trim().toLowerCase();
                const matched = users.filter(u =>
                  u.name?.toLowerCase().includes(s) || (u.position ?? '').toLowerCase().includes(s),
                );
                if (matched.length === 0) {
                  return <p className="text-sm text-gray-400 px-2 py-4">검색 결과가 없습니다.</p>;
                }
                return matched.map(u => {
                  const f = forms[u.id];
                  return (
                    <button
                      key={u.id}
                      onClick={() => handleSelectUser(u)}
                      className={cn(
                        'w-full flex items-center justify-between px-2 py-1.5 rounded-md text-left text-xs transition-colors',
                        selectedUser?.id === u.id ? 'bg-blue-100 text-blue-800 font-medium' : 'text-gray-600 hover:bg-gray-100',
                      )}
                    >
                      <span className="truncate flex items-center gap-1">
                        {u.name}{u.position ? ` (${u.position})` : ''}
                        {f?.editRequestPending && <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500" title="수정 요청 대기 중" />}
                      </span>
                      {f && (
                        <span className={cn('shrink-0 ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium', STATUS_COLOR[f.status])}>
                          {STATUS_LABEL[f.status]}
                        </span>
                      )}
                    </button>
                  );
                });
              })()
            ) : (
              orgs.filter(o => !o.parentId).slice().sort(compareOrgByDisplayOrder).map(topOrg => (
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
              <p className="text-sm">좌측에서 팀원을 선택하면 {fullView ? '평가의견·자기평가·육성면담서를' : '육성면담서를'} 확인할 수 있습니다.</p>
            </div>
          ) : (
            <div className="max-w-3xl space-y-6">
              <div>
                <h2 className="text-lg font-bold text-gray-900"><MemberInfoModal userId={selectedUser.id} userName={selectedUser.name} /></h2>
                <p className="text-sm text-gray-500">
                  {selectedUser.position ?? ''} · {selectedYear}년 육성면담서{fullView ? '·자기평가' : ''}
                  {(() => { const t = computeSelfEvalTotal(selfEvals[selectedUser.id]?.status === 'SUBMITTED' ? selfEvals[selectedUser.id] : null); return t != null
                    ? <span className="ml-1.5 font-semibold text-indigo-600">(자기평가 점수 {t}점)</span> : null; })()}
                </p>
                {selectedForm && (
                  <span className={cn('inline-block mt-1 text-xs px-2 py-0.5 rounded-full font-medium', STATUS_COLOR[selectedForm.status])}>
                    {STATUS_LABEL[selectedForm.status]}
                  </span>
                )}
              </div>

              {/* 평가 의견 — 팀장 / 본부장(부공장장) / 임원 병렬 배치 (CEO·HR마스터 전용) */}
              {fullView && (() => {
                const ie = indivEvals[selectedUser.id];
                // 임원 등급·의견은 확정(EXEC_CONFIRMED/PUBLISHED) 상태일 때만 표시 —
                // 쿼터 재확정 등으로 무효화되면 status 가 복원되지만 execGrade/execComment 필드는 남으므로
                // 상태 게이트 없이는 무효화된 등급이 계속 노출된다(평가이력 관리와 동일 기준).
                // 팀장/본부장 의견은 회수 시 필드 자체가 삭제되므로 그대로 표시해도 안전.
                const execConfirmed = ie?.status === 'EXEC_CONFIRMED' || ie?.status === 'PUBLISHED';
                const cards: { title: string; grade?: EvaluationGrade; comment?: string }[] = [
                  { title: '팀장 평가등급·의견', grade: ie?.leadGrade, comment: ie?.leadComment },
                  { title: '본부장(부공장장) 평가등급·의견', grade: ie?.hqGrade, comment: ie?.hqComment },
                  { title: '임원 평가등급·의견',
                    grade: execConfirmed ? ie?.execGrade : undefined,
                    comment: execConfirmed ? ie?.execComment : undefined },
                ];
                return (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {cards.map(c => (
                      <div key={c.title} className="rounded-xl border bg-white p-4 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-gray-500">{c.title}</p>
                          {c.grade ? (
                            <span className={cn('shrink-0 rounded-full px-2.5 py-0.5 text-sm font-bold', GRADE_CHIP[c.grade] ?? 'bg-gray-100 text-gray-600')}>
                              {c.grade}
                            </span>
                          ) : (
                            <span className="shrink-0 text-xs text-gray-300">미제출</span>
                          )}
                        </div>
                        <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed min-h-[40px]">
                          {c.comment?.trim() || <span className="text-gray-300">의견 없음</span>}
                        </p>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* 자기평가 — 임원 평가등급확정과 동일 노출 (CEO·HR마스터 전용) */}
              {fullView && (
                <div className="rounded-xl border bg-white p-5">
                  <h3 className="text-sm font-bold text-gray-800 mb-3">자기평가</h3>
                  <SelfEvalBody form={selfEvals[selectedUser.id]?.status === 'SUBMITTED' ? selfEvals[selectedUser.id] : null} />
                </div>
              )}

              {!selectedForm ? (
                <div className="rounded-xl border border-dashed bg-gray-50 p-12 text-center">
                  <p className="text-sm text-gray-400">아직 작성된 육성면담서가 없습니다.</p>
                </div>
              ) : (<>

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

              {/* 통합 육성면담서(신양식) — 직무정보·업무실적·경력·요청·종합의견 */}
              <MentoringPerfBody form={selectedForm} />

              {selectedForm.interviewerOpinion?.trim() && (
                <Section title="면담자 의견">
                  <Row label="면담자 의견" value={selectedForm.interviewerOpinion} multiline />
                </Section>
              )}
              </>)}
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
  const children = allOrgs.filter(o => o.parentId === org.id).slice().sort(compareOrgByDisplayOrder);
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

'use client';

import { useEffect, useState } from 'react';
import { getAllUsers, getOrganizations, getMentoringFormsByUsers } from '@/lib/firestore';
import Header from '@/components/layout/Header';
import AuthGuard from '@/components/layout/AuthGuard';
import { ChevronDown, ChevronRight, MessageSquareHeart } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { User, Organization, MentoringForm } from '@/types';

export default function MentoringAllPage() {
  return (
    <AuthGuard allowedRoles={['CEO']} requireHrAdmin>
      <MentoringAllContent />
    </AuthGuard>
  );
}

function MentoringAllContent() {
  const [users, setUsers] = useState<User[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [forms, setForms] = useState<Record<string, MentoringForm>>({});
  const [loading, setLoading] = useState(true);
  const [expandedOrgs, setExpandedOrgs] = useState<Set<string>>(new Set());
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [selectedForm, setSelectedForm] = useState<MentoringForm | null>(null);
  const year = new Date().getFullYear();

  useEffect(() => {
    (async () => {
      try {
        const [allUsers, allOrgs] = await Promise.all([getAllUsers(), getOrganizations()]);
        setUsers(allUsers.filter(u => u.isActive));
        setOrgs(allOrgs);

        // 육성면담서 로드
        const formList = await getMentoringFormsByUsers(allUsers.map(u => u.id), year);
        const formMap: Record<string, MentoringForm> = {};
        formList.forEach(f => { if (f) formMap[f.userId] = f; });
        setForms(formMap);

        // 첫 조직 펼치기
        const topOrgs = allOrgs.filter(o => !o.parentId);
        if (topOrgs.length > 0) setExpandedOrgs(new Set([topOrgs[0].id]));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // 조직별 팀원 그룹핑
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
      <Header title="육성면담서 확인" />
      <div className="flex-1 overflow-hidden flex">
        {/* 좌측: 조직/팀원 목록 */}
        <div className="w-72 border-r overflow-y-auto flex-shrink-0 bg-gray-50">
          <div className="p-4 space-y-1">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{year}년 육성면담서</p>
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

        {/* 우측: 선택된 육성면담서 상세 */}
        <div className="flex-1 overflow-y-auto p-6">
          {!selectedUser ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <MessageSquareHeart className="h-12 w-12 mb-3 opacity-30" />
              <p className="text-sm">좌측에서 팀원을 선택하면 육성면담서를 확인할 수 있습니다.</p>
            </div>
          ) : !selectedForm ? (
            <div className="max-w-2xl">
              <h2 className="text-lg font-bold text-gray-900 mb-1">{selectedUser.name}</h2>
              <p className="text-sm text-gray-500 mb-6">{selectedUser.position ?? ''}</p>
              <div className="rounded-xl border border-dashed bg-gray-50 p-12 text-center">
                <p className="text-sm text-gray-400">아직 작성된 육성면담서가 없습니다.</p>
              </div>
            </div>
          ) : (
            <div className="max-w-2xl space-y-6">
              <div>
                <h2 className="text-lg font-bold text-gray-900">{selectedUser.name}</h2>
                <p className="text-sm text-gray-500">{selectedUser.position ?? ''} · {year}년 육성면담서</p>
                <span className={cn('inline-block mt-1 text-xs px-2 py-0.5 rounded-full font-medium', STATUS_COLOR[selectedForm.status])}>
                  {STATUS_LABEL[selectedForm.status]}
                </span>
              </div>

              {/* 직무 정보 */}
              <Section title="직무 정보">
                <Row label="직책" value={selectedForm.currentPosition} />
                <Row label="주요담당업무" value={selectedForm.mainDuties} />
                <Row label="현 직위 승진일" value={selectedForm.promotionDate} />
                <Row label="보유자격증" value={selectedForm.certifications} />
                <Row label="주요 업적" value={selectedForm.achievements} multiline />
              </Section>

              {/* 경력개발 계획 */}
              <Section title="경력개발 계획">
                <Row label="희망 Position" value={selectedForm.careerPlan} multiline />
              </Section>

              {/* 직무 요청사항 */}
              <Section title="직무 요청사항">
                <Row label="요청 유형" value={selectedForm.jobRequest} />
                <Row label="이유" value={selectedForm.jobRequestReason} multiline />
                {selectedForm.desiredJob1 && <Row label="희망 직무 1순위" value={selectedForm.desiredJob1} />}
                {selectedForm.desiredJob2 && <Row label="희망 직무 2순위" value={selectedForm.desiredJob2} />}
              </Section>

              {/* 종합 의견 */}
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
        {isExpanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-gray-400" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-400" />}
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
                  selectedUserId === u.id ? 'bg-blue-100 text-blue-800 font-medium' : 'text-gray-600 hover:bg-gray-100'
                )}
              >
                <span className="truncate">{u.name} {u.position ? `(${u.position})` : ''}</span>
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

function Row({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
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

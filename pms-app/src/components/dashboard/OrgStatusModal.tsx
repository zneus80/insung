'use client';

/**
 * 조직현황 — 본인 스코프 인원의 요약 표 (팝업)
 * 스코프:
 *   - MEMBER, 일반팀장 → 본인 organizationId (팀 전체)
 *   - 본부장(HEADQUARTERS 소속/리더) → 본부 descendants
 *   - 임원(EXECUTIVE) → 책임 부문/공장 descendants
 *
 * 표시 컬럼: 이름, 직책, 입사일, 마일리지, 스마트프로젝트(PM/팀원), 포상건수
 */

import { useEffect, useMemo, useState } from 'react';
import { X, Users } from 'lucide-react';
import {
  getAllUsers,
  getOrganizations,
  getMileage,
  getAwardsByUser,
  listAllInnovationActivities,
  getIndividualEvaluation,
} from '@/lib/firestore';
import { getPmIds } from '@/lib/innovation';
import { roleRank } from '@/lib/user-sort';
import { useAuth } from '@/contexts/AuthContext';
import { useActiveYear } from '@/contexts/ActiveYearContext';
import MemberInfoModal from '@/components/members/MemberInfoModal';
import type { User, Organization, Mileage, Award } from '@/types';

// 인사평가 등급 칩 색상
const GRADE_CHIP: Record<string, string> = {
  S: 'bg-purple-100 text-purple-700',
  A: 'bg-blue-100 text-blue-700',
  B: 'bg-green-100 text-green-700',
  C: 'bg-gray-100 text-gray-700',
  D: 'bg-orange-100 text-orange-700',
  E: 'bg-red-100 text-red-600',
};

interface RowData {
  user: User;
  mileagePoints: number;
  awardCount: number;
  smartPm: number;       // PM 참여 건수
  smartMember: number;   // 팀원 참여 건수
  // 승진 요건 충족 여부 (PolicyGuideButton 참조)
  // 팀장 승진: ① SMART_PROJECT 1건 이상 참여 (PM 또는 팀원) ② 마일리지 누적 200점 이상
  // 임원 승진: SMART_PROJECT 1건 이상 PM 으로 수행
  qualifyLead: boolean;
  qualifyExec: boolean;
  grades: Record<number, string | undefined>;  // 연도별 확정 등급 (3개년)
}

export default function OrgStatusModal({ onClose }: { onClose: () => void }) {
  const { userProfile } = useAuth();
  const { activeYear } = useActiveYear();
  // 3개년 인사평가 등급 — 팀장·임원·CEO·HR마스터에게만 노출 (HR관리자는 제외).
  // 데이터는 ACL(viewableBy) 경로로만 읽어 권한 없는 타인 등급은 자동 차단(§6-1 가시성 원칙 준수, 원칙 자체는 불변).
  const gradeYears = [activeYear, activeYear - 1, activeYear - 2];
  const canSeeGrades = !!userProfile && (
    userProfile.role === 'TEAM_LEAD' || userProfile.role === 'EXECUTIVE' ||
    userProfile.role === 'CEO' || !!userProfile.isHrMaster
  );
  const [rows, setRows] = useState<RowData[]>([]);
  const [orgsById, setOrgsById] = useState<Map<string, Organization>>(new Map());
  const [scopeLabel, setScopeLabel] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userProfile) return;
    (async () => {
      try {
        const [allUsers, allOrgs] = await Promise.all([
          getAllUsers(),
          getOrganizations(),
        ]);
        const myOrg = allOrgs.find(o => o.id === userProfile.organizationId);

        // 스코프 결정
        let scopeIds: string[] = [];
        let label = '';
        function descendantsOf(orgId: string): string[] {
          const ids: string[] = [orgId];
          for (const c of allOrgs.filter(o => o.parentId === orgId)) {
            ids.push(...descendantsOf(c.id));
          }
          return ids;
        }
        // 다중 leader 겸직 지원 — 본인이 leaderId 인 모든 조직 + (TEAM_LEAD/MEMBER) home org
        const myLedHQs = allOrgs.filter(o => o.leaderId === userProfile.id && o.type === 'HEADQUARTERS');
        const myLedDivs = allOrgs.filter(o => o.leaderId === userProfile.id && o.type === 'DIVISION');
        const isHQHead =
          (userProfile.role === 'TEAM_LEAD' && myOrg?.type === 'HEADQUARTERS') ||
          myLedHQs.length > 0;

        if (userProfile.role === 'EXECUTIVE' || myLedDivs.length > 0) {
          // 임원 — 본인이 leader 인 모든 부문/공장 + (home org 가 DIVISION 이면 포함). home org 의 DIVISION 조상도 포함.
          const divs: Organization[] = [...myLedDivs];
          if (myOrg?.type === 'DIVISION') divs.push(myOrg);
          else if (myOrg) {
            const anc = findAncestor(myOrg, allOrgs, 'DIVISION');
            if (anc) divs.push(anc);
          }
          const dedupedDivs = Array.from(new Map(divs.map(d => [d.id, d])).values());
          scopeIds = Array.from(new Set(dedupedDivs.flatMap(d => descendantsOf(d.id))));
          label = dedupedDivs.length === 1
            ? `${dedupedDivs[0].name} 부문/공장 전체`
            : dedupedDivs.length > 1
              ? `${dedupedDivs.map(d => d.name).join(', ')} (${dedupedDivs.length}개 부문)`
              : '';
        } else if (isHQHead) {
          // 본부장 — 본인이 leader 인 모든 HQ + home HQ
          const hqs: Organization[] = [...myLedHQs];
          if (myOrg?.type === 'HEADQUARTERS') hqs.push(myOrg);
          const dedupedHqs = Array.from(new Map(hqs.map(h => [h.id, h])).values());
          scopeIds = Array.from(new Set(dedupedHqs.flatMap(h => descendantsOf(h.id))));
          label = dedupedHqs.length === 1
            ? `${dedupedHqs[0].name} 본부 전체`
            : `${dedupedHqs.map(h => h.name).join(', ')} (${dedupedHqs.length}개 본부)`;
        } else {
          // 팀원/일반팀장 — home team + 본인이 leader 인 다른 팀들
          const myLedTeams = allOrgs.filter(o => o.leaderId === userProfile.id);
          const teams: Organization[] = [...myLedTeams];
          if (myOrg) teams.push(myOrg);
          const dedupedTeams = Array.from(new Map(teams.map(t => [t.id, t])).values());
          scopeIds = Array.from(new Set(dedupedTeams.flatMap(t => descendantsOf(t.id))));
          label = dedupedTeams.length === 1
            ? `${dedupedTeams[0].name}`
            : dedupedTeams.map(t => t.name).join(', ');
        }
        setScopeLabel(label);

        // 스코프 사용자 목록 — 임원/CEO 는 인원현황 미표시 (요청사항)
        const scopeUsers = allUsers.filter(u =>
          u.isActive !== false &&
          scopeIds.includes(u.organizationId) &&
          u.role !== 'EXECUTIVE' && u.role !== 'CEO',
        );

        // 마일리지·포상·혁신활동 병렬 조회
        //  · SMART_PROJECT 참여 횟수는 innovationActivities 직접 집계 (마일리지 entries 아님)
        const [mileages, awardLists, innovations, gradeLists] = await Promise.all([
          Promise.all(scopeUsers.map(u => getMileage(u.id))),
          Promise.all(scopeUsers.map(u => getAwardsByUser(u.id))),
          listAllInnovationActivities(), // 승진 요건은 누적(연도 무관) — 전체 연도 PM 실적 집계
          // 3개년 등급 — 관리자만, ACL 경로(getIndividualEvaluation)로만 조회 → 권한 없으면 자동 미표시
          canSeeGrades
            ? Promise.all(scopeUsers.map(async u => {
                const perYear: Record<number, string | undefined> = {};
                await Promise.all(gradeYears.map(async y => {
                  try {
                    const ie = await getIndividualEvaluation(u.id, y);
                    // 임원 최종 확정 등급만 표시 — 쿼터 재확정 등으로 무효화되면 status 가 이전 단계로
                    // 복원되므로, 남아있는 execGrade 는 확정으로 보지 않는다(평가이력 관리와 동일 기준).
                    // 미확정 팀장/본부장 의견 등급도 노출하지 않는다.
                    perYear[y] = (ie?.status === 'EXEC_CONFIRMED' || ie?.status === 'PUBLISHED')
                      ? ie.execGrade : undefined;
                  } catch { /* 권한 없음 → 미표시 */ }
                }));
                return perYear;
              }))
            : Promise.resolve([] as Record<number, string | undefined>[]),
        ]);
        // 사용자별 스마트프로젝트 PM/멤버 카운트
        const spByUser = new Map<string, { pm: number; pmCompleted: number; member: number }>();
        for (const a of innovations) {
          if (a.type !== 'SMART_PROJECT') continue;
          for (const uid of getPmIds(a)) {
            const c = spByUser.get(uid) ?? { pm: 0, pmCompleted: 0, member: 0 };
            c.pm++;
            if (a.status === 'COMPLETED') c.pmCompleted++; // 임원 승진 실적은 완료만
            spByUser.set(uid, c);
          }
          for (const uid of (a.memberIds ?? [])) {
            const c = spByUser.get(uid) ?? { pm: 0, pmCompleted: 0, member: 0 }; c.member++; spByUser.set(uid, c);
          }
        }

        const data: RowData[] = scopeUsers.map((u, i) => {
          const mileage: Mileage | null = mileages[i];
          const awards: Award[] = awardLists[i];
          const sp = spByUser.get(u.id) ?? { pm: 0, pmCompleted: 0, member: 0 };
          const smartPm = sp.pm;
          const smartMember = sp.member;
          const pts = mileage?.points ?? 0;
          // (1) 팀장 승진: SMART_PROJECT(PM 또는 팀원) 1회 이상 + 마일리지 200점 이상
          const qualifyLead = (smartPm + smartMember) >= 1 && pts >= 200;
          // (2) 임원 승진: 완료된 SMART_PROJECT PM 1회 이상 (추진중은 실적으로 인정하지 않음)
          const qualifyExec = sp.pmCompleted >= 1;
          return {
            user: u,
            mileagePoints: pts,
            awardCount: awards.length,
            smartPm,
            smartMember,
            qualifyLead,
            qualifyExec,
            grades: gradeLists[i] ?? {},
          };
        });
        // 1차: 팀(조직) displayOrder 우선, 2차: 직책(팀장→책임→주임→그 외), 3차: 이름 가나다순
        const orgsMap = new Map(allOrgs.map(o => [o.id, o]));
        const orgRank = (orgId: string): number => {
          const o = orgsMap.get(orgId);
          return o?.displayOrder ?? 999;
        };
        data.sort((a, b) => {
          // 1차: 팀
          const oa = orgRank(a.user.organizationId);
          const ob = orgRank(b.user.organizationId);
          if (oa !== ob) return oa - ob;
          const orgNameA = orgsMap.get(a.user.organizationId)?.name ?? '';
          const orgNameB = orgsMap.get(b.user.organizationId)?.name ?? '';
          if (orgNameA !== orgNameB) return orgNameA.localeCompare(orgNameB, 'ko');
          // 2차: 역할 (팀장 → 팀원)
          const pa = roleRank(a.user.role);
          const pb = roleRank(b.user.role);
          if (pa !== pb) return pa - pb;
          // 3차: 입사일 (오래된 사람 우선). 미입력은 최하단.
          const ha = a.user.hireDate || '9999-99-99';
          const hb = b.user.hireDate || '9999-99-99';
          if (ha !== hb) return ha.localeCompare(hb);
          return a.user.name.localeCompare(b.user.name, 'ko');
        });
        setRows(data);
        setOrgsById(new Map(allOrgs.map(o => [o.id, o])));
      } finally {
        setLoading(false);
      }
    })();
  }, [userProfile, activeYear]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-blue-600" />
            <h2 className="text-lg font-bold text-gray-900">조직현황</h2>
            {scopeLabel && (
              <span className="text-sm text-gray-500 ml-1">· {scopeLabel}</span>
            )}
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-gray-100 text-gray-500">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-6 space-y-2">
              {[1,2,3,4].map(i => <div key={i} className="h-12 animate-pulse rounded-lg bg-gray-100" />)}
            </div>
          ) : rows.length === 0 ? (
            <p className="p-12 text-center text-sm text-gray-400">표시할 인원이 없습니다.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs border-b sticky top-0">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">이름</th>
                  <th className="px-4 py-3 text-left font-semibold">소속</th>
                  <th className="px-4 py-3 text-left font-semibold">직책</th>
                  <th className="px-4 py-3 text-left font-semibold">입사일</th>
                  <th className="px-4 py-3 text-right font-semibold">마일리지</th>
                  <th className="px-4 py-3 text-center font-semibold">스마트프로젝트<br />(PM / 팀원)</th>
                  <th className="px-4 py-3 text-right font-semibold">포상</th>
                  {canSeeGrades && (
                    <th className="px-4 py-3 text-center font-semibold">인사평가 등급<br />({gradeYears.join(' / ')})</th>
                  )}
                  <th className="px-4 py-3 text-center font-semibold">승진요건 충족<br />(팀장 / 임원)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map(r => (
                  <tr key={r.user.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      <MemberInfoModal userId={r.user.id} userName={r.user.name} targetRole={r.user.role} />
                    </td>
                    <td className="px-4 py-3 text-gray-600">{orgsById.get(r.user.organizationId)?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{r.user.position ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-500">
                      {r.user.hireDate ? formatHireDate(r.user.hireDate) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-semibold text-blue-700">{r.mileagePoints}</span>
                      <span className="text-xs text-gray-400 ml-1">점</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex items-center gap-2 text-xs">
                        <span className="rounded-full bg-orange-100 text-orange-700 px-2 py-0.5">PM {r.smartPm}</span>
                        <span className="rounded-full bg-blue-100 text-blue-700 px-2 py-0.5">팀원 {r.smartMember}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-semibold text-amber-600">{r.awardCount}</span>
                      <span className="text-xs text-gray-400 ml-1">건</span>
                    </td>
                    {canSeeGrades && (
                      <td className="px-4 py-3 text-center">
                        <span className="inline-flex items-center gap-1 text-xs">
                          {gradeYears.map(y => {
                            const g = r.grades?.[y];
                            return (
                              <span key={y} title={`${y}년`}
                                className={`rounded px-1.5 py-0.5 font-semibold ${g ? (GRADE_CHIP[g] ?? 'bg-gray-100 text-gray-600') : 'bg-gray-50 text-gray-300'}`}>
                                {g ?? '-'}
                              </span>
                            );
                          })}
                        </span>
                      </td>
                    )}
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex items-center gap-1 text-xs">
                        {/* 정식 팀장은 팀장 승진조건 표시 안 함 — 팀장 대행(isActingLead)·팀원만 표시 */}
                        {(r.user.role === 'MEMBER' || (r.user.role === 'TEAM_LEAD' && r.user.isActingLead)) && (
                          <QualBadge ok={r.qualifyLead} label="팀장" />
                        )}
                        <QualBadge ok={r.qualifyExec} label="임원" />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function QualBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={
        ok
          ? 'rounded-full bg-green-100 text-green-700 px-2 py-0.5 font-semibold'
          : 'rounded-full bg-gray-100 text-gray-400 px-2 py-0.5'
      }
      title={`${label} 승진 요건 ${ok ? '충족' : '미충족'}`}
    >
      {label} {ok ? 'OK' : 'NO'}
    </span>
  );
}

function findAncestor(start: Organization, allOrgs: Organization[], type: Organization['type']): Organization | undefined {
  let cur: Organization | undefined = start;
  while (cur) {
    if (cur.type === type) return cur;
    cur = cur.parentId ? allOrgs.find(o => o.id === cur!.parentId) : undefined;
  }
  return undefined;
}

function formatHireDate(d: string): string {
  // YYYY-MM-DD or YYYY.MM.DD acceptable; normalize
  return d.replace(/-/g, '.').slice(0, 10);
}

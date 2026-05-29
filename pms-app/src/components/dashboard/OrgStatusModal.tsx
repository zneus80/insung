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
} from '@/lib/firestore';
import { useAuth } from '@/contexts/AuthContext';
import { useActiveYear } from '@/contexts/ActiveYearContext';
import MemberInfoModal from '@/components/members/MemberInfoModal';
import type { User, Organization, Mileage, Award } from '@/types';

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
}

export default function OrgStatusModal({ onClose }: { onClose: () => void }) {
  const { userProfile } = useAuth();
  const { activeYear } = useActiveYear();
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
        // 본부장 판별: TEAM_LEAD 인데 본인 소속이 HEADQUARTERS 거나, HQ 의 leaderId
        const myLedHQ = allOrgs.find(o => o.leaderId === userProfile.id && o.type === 'HEADQUARTERS');
        const isHQHead =
          (userProfile.role === 'TEAM_LEAD' && myOrg?.type === 'HEADQUARTERS') ||
          !!myLedHQ;
        // 임원(부문/공장 책임) 판별: EXECUTIVE 거나 DIVISION 의 leaderId
        const myLedDiv = allOrgs.find(o => o.leaderId === userProfile.id && o.type === 'DIVISION');

        if (userProfile.role === 'EXECUTIVE' || myLedDiv) {
          // 임원 — 부문/공장 전체
          const divOrg = myLedDiv ?? allOrgs.find(o => o.id === userProfile.organizationId && o.type === 'DIVISION')
            ?? (myOrg ? findAncestor(myOrg, allOrgs, 'DIVISION') : undefined);
          if (divOrg) {
            scopeIds = descendantsOf(divOrg.id);
            label = `${divOrg.name} 부문/공장 전체`;
          }
        } else if (isHQHead) {
          // 본부장 — 본부 descendants
          const hqOrg = myLedHQ ?? myOrg;
          if (hqOrg) {
            scopeIds = descendantsOf(hqOrg.id);
            label = `${hqOrg.name} 본부 전체`;
          }
        } else {
          // 팀원/팀장 — 본인 팀
          if (myOrg) {
            scopeIds = [myOrg.id];
            label = `${myOrg.name}`;
          }
        }
        setScopeLabel(label);

        // 스코프 사용자 목록 — 임원/CEO 는 인원현황 미표시 (요청사항)
        const scopeUsers = allUsers.filter(u =>
          u.isActive !== false &&
          scopeIds.includes(u.organizationId) &&
          u.role !== 'EXECUTIVE' && u.role !== 'CEO',
        );

        // 마일리지·포상 병렬 조회 — SMART_PROJECT 참여 횟수는 마일리지 entries 에서 산정
        const [mileages, awardLists] = await Promise.all([
          Promise.all(scopeUsers.map(u => getMileage(u.id))),
          Promise.all(scopeUsers.map(u => getAwardsByUser(u.id))),
        ]);

        const data: RowData[] = scopeUsers.map((u, i) => {
          const mileage: Mileage | null = mileages[i];
          const awards: Award[] = awardLists[i];
          const entries = mileage?.entries ?? [];
          const smartPm = entries.filter(e => e.type === 'SMART_PROJECT' && e.subtype === 'PM').length;
          const smartMember = entries.filter(e => e.type === 'SMART_PROJECT' && e.subtype === 'MEMBER').length;
          const pts = mileage?.points ?? 0;
          // (1) 팀장 승진: SMART_PROJECT(PM 또는 팀원) 1회 이상 + 마일리지 200점 이상
          const qualifyLead = (smartPm + smartMember) >= 1 && pts >= 200;
          // (2) 임원 승진: SMART_PROJECT PM 1회 이상
          const qualifyExec = smartPm >= 1;
          return {
            user: u,
            mileagePoints: pts,
            awardCount: awards.length,
            smartPm,
            smartMember,
            qualifyLead,
            qualifyExec,
          };
        });
        // 팀장 먼저, 이름 가나다순
        data.sort((a, b) => {
          const rank = (r: string) => r === 'TEAM_LEAD' ? 0 : 1;
          const d = rank(a.user.role) - rank(b.user.role);
          if (d !== 0) return d;
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
                  <th className="px-4 py-3 text-center font-semibold">승진요건 충족<br />(팀장 / 임원)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map(r => (
                  <tr key={r.user.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      <MemberInfoModal userId={r.user.id} userName={r.user.name} />
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

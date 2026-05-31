'use client';

/**
 * 가시성 ACL 백필 페이지 (v0.9.1)
 *
 * 4개 평가 컬렉션의 모든 기존 문서에 viewableBy 필드를 백필한다.
 * - 새로 작성/수정되는 평가는 자동으로 viewableBy 가 박히지만,
 *   v0.9.1 이전에 저장된 기존 문서들은 viewableBy 가 없어 규칙 강화 시 read 가 차단된다.
 * - 이 페이지에서 일회성 실행으로 모든 기존 평가에 ACL 을 채워넣는다.
 *
 * HR 마스터 전용. 안전 작업 — 평가 데이터의 다른 필드(등급·의견)는 한 글자도 안 건드린다.
 */

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { collection, doc, getDocs, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { computeViewableBy, getUser, COLLECTIONS, createAuditLog, loadOrgTreeCache, loadOrgLeadersCache, type OrgTreeCache, type OrgLeadersCache } from '@/lib/firestore';
import Header from '@/components/layout/Header';
import AuthGuard from '@/components/layout/AuthGuard';
import { ShieldCheck, AlertCircle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

type CollectionKey = 'individualEvaluations' | 'selfEvaluations' | 'yearEndEvals' | 'mentoringForms';

interface Stats {
  total: number;
  alreadyHasAcl: number;
  updated: number;
  failed: number;
  errors: string[];
}

type Mode = 'fill-missing' | 'force-recompute';

const COLLECTION_LABEL: Record<CollectionKey, string> = {
  individualEvaluations: '개인평가',
  selfEvaluations: '자기평가',
  yearEndEvals: '연말평가',
  mentoringForms: '육성면담서',
};

const COLLECTION_NAMES = {
  individualEvaluations: COLLECTIONS.INDIVIDUAL_EVALUATIONS,
  selfEvaluations: COLLECTIONS.SELF_EVALUATIONS,
  yearEndEvals: COLLECTIONS.YEAR_END_EVALS,
  mentoringForms: COLLECTIONS.MENTORING_FORMS,
} as const;

export default function SecurityAclPage() {
  return (
    <AuthGuard requireHrMaster>
      <SecurityAclContent />
    </AuthGuard>
  );
}

function SecurityAclContent() {
  const { userProfile } = useAuth();
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState<Mode>('fill-missing');
  const [stats, setStats] = useState<Record<CollectionKey, Stats>>(() => ({
    individualEvaluations: { total: 0, alreadyHasAcl: 0, updated: 0, failed: 0, errors: [] },
    selfEvaluations:       { total: 0, alreadyHasAcl: 0, updated: 0, failed: 0, errors: [] },
    yearEndEvals:          { total: 0, alreadyHasAcl: 0, updated: 0, failed: 0, errors: [] },
    mentoringForms:        { total: 0, alreadyHasAcl: 0, updated: 0, failed: 0, errors: [] },
  }));
  const [done, setDone] = useState(false);

  // userId 기준 캐시 — 같은 사용자의 evaluation 이 여러 개일 때 user fetch 중복 방지
  const userCache = new Map<string, { organizationId: string } | null>();

  async function getUserOrgCached(userId: string): Promise<string | null> {
    if (userCache.has(userId)) {
      return userCache.get(userId)?.organizationId ?? null;
    }
    const u = await getUser(userId);
    userCache.set(userId, u ? { organizationId: u.organizationId } : null);
    return u?.organizationId ?? null;
  }

  async function processCollection(key: CollectionKey, useUserOrg: boolean, forceRecompute: boolean, orgsCache: OrgTreeCache, leadersCache: OrgLeadersCache): Promise<Stats> {
    const collName = COLLECTION_NAMES[key];
    const snap = await getDocs(collection(db, collName));
    const stat: Stats = { total: snap.size, alreadyHasAcl: 0, updated: 0, failed: 0, errors: [] };

    for (const d of snap.docs) {
      const data = d.data();
      // force 모드면 기존 viewableBy 있어도 덮어씀 (stale UID 정리·조직 개편 후 복구 용도)
      if (!forceRecompute && Array.isArray(data.viewableBy) && data.viewableBy.length > 0) {
        stat.alreadyHasAcl++;
        continue;
      }
      const userId = data.userId as string | undefined;
      if (!userId) {
        stat.failed++;
        stat.errors.push(`${collName}/${d.id}: userId 누락`);
        continue;
      }
      let orgId: string | null;
      if (useUserOrg) {
        orgId = await getUserOrgCached(userId);
      } else {
        orgId = (data.organizationId as string | undefined) ?? (await getUserOrgCached(userId));
      }
      if (!orgId) {
        try {
          await updateDoc(doc(db, collName, d.id), {
            viewableBy: [userId],
            updatedAt: serverTimestamp(),
          });
          stat.updated++;
        } catch (e: any) {
          stat.failed++;
          stat.errors.push(`${collName}/${d.id}: ${e?.message ?? 'unknown'}`);
        }
        continue;
      }
      try {
        const viewableBy = await computeViewableBy(userId, orgId, orgsCache, leadersCache);
        await updateDoc(doc(db, collName, d.id), {
          viewableBy,
          updatedAt: serverTimestamp(),
        });
        stat.updated++;
      } catch (e: any) {
        stat.failed++;
        stat.errors.push(`${collName}/${d.id}: ${e?.message ?? 'unknown'}`);
      }
    }
    return stat;
  }

  async function handleRun() {
    if (!userProfile) return;
    const isForce = mode === 'force-recompute';
    const confirmMsg = isForce
      ? '⚠️ 재계산(덮어쓰기) 모드 — 기존 viewableBy 가 있는 문서까지 모두 다시 계산해서 덮어씁니다.\n조직 개편·리더 교체 후 stale ACL 정리 시 사용하세요.\n등급·의견 등 다른 필드는 변경되지 않습니다.\n진행하시겠습니까?'
      : '기존 평가 4종 모든 문서에 viewableBy 를 백필합니다.\n이미 viewableBy 가 있는 문서는 스킵됩니다.\n등급·의견 등 다른 필드는 변경되지 않습니다.\n진행하시겠습니까?';
    if (!confirm(confirmMsg)) return;

    setRunning(true);
    setDone(false);
    userCache.clear();

    try {
      // 조직 트리 + leader 캐시 1회 로드 — 모든 doc 처리에 재사용
      const orgsCache = await loadOrgTreeCache();
      const leadersCache = await loadOrgLeadersCache();

      const ie = await processCollection('individualEvaluations', false, isForce, orgsCache, leadersCache);
      setStats(s => ({ ...s, individualEvaluations: ie }));

      const se = await processCollection('selfEvaluations', true, isForce, orgsCache, leadersCache);
      setStats(s => ({ ...s, selfEvaluations: se }));

      const ye = await processCollection('yearEndEvals', false, isForce, orgsCache, leadersCache);
      setStats(s => ({ ...s, yearEndEvals: ye }));

      const mf = await processCollection('mentoringForms', false, isForce, orgsCache, leadersCache);
      setStats(s => ({ ...s, mentoringForms: mf }));

      const totalUpdated = ie.updated + se.updated + ye.updated + mf.updated;
      const totalFailed = ie.failed + se.failed + ye.failed + mf.failed;

      await createAuditLog({
        action: 'BACKUP_RESTORE',  // 가장 가까운 분류 — 별도 분류 추가 검토
        actorId: userProfile.id,
        actorName: userProfile.name,
        details: `viewableBy ${isForce ? '재계산(덮어쓰기)' : '백필'} — 갱신 ${totalUpdated}건 / 실패 ${totalFailed}건`,
      });

      setDone(true);
      toast.success(`백필 완료 — 갱신 ${totalUpdated}건, 실패 ${totalFailed}건`);
    } catch (e: any) {
      toast.error(`백필 중 오류: ${e?.message ?? 'unknown'}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="가시성 ACL 백필 (v0.9.1)" />
      <div className="flex-1 min-h-0 p-6 overflow-auto space-y-6">

        {/* 안내 */}
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5" />
            <div className="text-sm text-amber-900 space-y-2">
              <p className="font-semibold">v0.9.1 보안 강화 — 일회성 백필 작업</p>
              <ul className="list-disc list-inside space-y-1">
                <li>4개 평가 컬렉션의 모든 기존 문서에 <code className="font-mono bg-amber-100 px-1 rounded">viewableBy</code> 필드를 추가합니다.</li>
                <li>이미 <code className="font-mono bg-amber-100 px-1 rounded">viewableBy</code> 가 있는 문서는 스킵됩니다 (재실행 안전).</li>
                <li><strong>등급·평가의견 등 다른 필드는 한 글자도 건드리지 않습니다.</strong></li>
                <li>백필 완료 후 Firestore 보안 규칙을 강화하면 콘솔 우회를 통한 평가 데이터 조회가 차단됩니다.</li>
                <li>작업 전 <a href="/admin/backup" className="underline font-semibold">데이터 백업</a> 을 권장합니다.</li>
              </ul>
            </div>
          </div>
        </div>

        {/* 실행 모드 + 버튼 */}
        <div className="rounded-xl border bg-white p-5 space-y-4">
          {/* 모드 선택 */}
          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold text-gray-900">실행 모드</p>
            <label className="flex items-start gap-2 p-3 rounded-lg border cursor-pointer hover:bg-gray-50">
              <input
                type="radio"
                name="mode"
                value="fill-missing"
                checked={mode === 'fill-missing'}
                onChange={() => setMode('fill-missing')}
                disabled={running}
                className="mt-0.5"
              />
              <div className="text-sm">
                <p className="font-medium text-gray-900">백필 (기본) — 누락된 viewableBy 만 추가</p>
                <p className="text-gray-500">이미 viewableBy 가 있는 문서는 스킵. 첫 도입 시 사용.</p>
              </div>
            </label>
            <label className="flex items-start gap-2 p-3 rounded-lg border cursor-pointer hover:bg-amber-50 border-amber-200">
              <input
                type="radio"
                name="mode"
                value="force-recompute"
                checked={mode === 'force-recompute'}
                onChange={() => setMode('force-recompute')}
                disabled={running}
                className="mt-0.5"
              />
              <div className="text-sm">
                <p className="font-medium text-amber-900">재계산 (덮어쓰기) — 모든 문서 강제 재계산</p>
                <p className="text-amber-700">기존 viewableBy 도 새로 계산해서 덮어씀. 조직 개편·리더 교체 후 stale ACL 정리, 삭제된 사용자 UID 제거에 사용.</p>
              </div>
            </label>
          </div>

          {/* 실행 */}
          <div className="flex items-center justify-between pt-2 border-t">
            <div>
              <p className="text-sm text-gray-500">HR 마스터 권한으로 즉시 실행됩니다.</p>
            </div>
            <button
              onClick={handleRun}
              disabled={running}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-white font-medium disabled:bg-gray-300 ${
                mode === 'force-recompute' ? 'bg-amber-600 hover:bg-amber-700' : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              <ShieldCheck className="h-4 w-4" />
              {running ? '실행 중...' : (mode === 'force-recompute' ? '재계산 실행' : '백필 실행')}
            </button>
          </div>
        </div>

        {/* 결과 */}
        <div className="space-y-3">
          {(Object.keys(stats) as CollectionKey[]).map(key => {
            const s = stats[key];
            const hasAny = s.total > 0;
            return (
              <div key={key} className="rounded-xl border bg-white p-4">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-gray-900">{COLLECTION_LABEL[key]}</span>
                  {done && s.failed === 0 && hasAny && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                </div>
                <div className="mt-2 grid grid-cols-4 gap-2 text-sm">
                  <div><span className="text-gray-500">전체</span> <span className="font-semibold ml-1">{s.total}</span></div>
                  <div><span className="text-gray-500">이미 ACL</span> <span className="font-semibold ml-1">{s.alreadyHasAcl}</span></div>
                  <div><span className="text-gray-500">갱신</span> <span className="font-semibold ml-1 text-green-700">{s.updated}</span></div>
                  <div><span className="text-gray-500">실패</span> <span className={`font-semibold ml-1 ${s.failed > 0 ? 'text-red-700' : ''}`}>{s.failed}</span></div>
                </div>
                {s.errors.length > 0 && (
                  <details className="mt-2 text-xs text-red-700">
                    <summary className="cursor-pointer">오류 상세 ({s.errors.length})</summary>
                    <ul className="mt-1 list-disc list-inside space-y-0.5">
                      {s.errors.slice(0, 20).map((e, i) => <li key={i}>{e}</li>)}
                      {s.errors.length > 20 && <li>... 외 {s.errors.length - 20}건</li>}
                    </ul>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

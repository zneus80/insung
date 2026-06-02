export const dynamic = 'force-dynamic';

/**
 * 개인평가(individualEvaluations) 읽기 프록시 (옵션 E).
 *
 * 클라이언트가 Firestore 를 직접 조회하지 않고 이 API 를 경유하게 하여,
 * 콘솔·curl 등 우회 경로를 서버에서 차단할 수 있는 기반을 만든다.
 *
 * 인증: Authorization: Bearer <Firebase ID Token>
 *
 * body: { mode: 'single' | 'org' | 'all', userId?, orgId?, year }
 *  - single: 특정 사용자의 해당 연도 평가 1건
 *  - org:    특정 조직의 해당 연도 평가 목록
 *  - all:    해당 연도 전체(권한 범위 내)
 *
 * 【Phase 2a】 조직 체인 스코프 기반 권한:
 *   - HR(관리자·마스터)·CEO → 전체
 *   - 팀장 → home팀 ∪ 본인 leader 조직 산하
 *   - 본부장(HQ_HEAD) → 본인 HQ 산하 (비-leader 면 home HQ 산하)
 *   - 차순위임원(EXEC_SUB) → home부문 산하 ∪ led 산하
 *   - 최상위임원(EXEC_TOP) → 본인 leader 조직 산하만 (home 제외, §6-1)
 *   - 그 외(MEMBER) → 본인 평가만
 *   클라이언트 화면(evaluation/team·result 등)의 scopeOrgIds 계산과 동일.
 *
 * 【Phase 2b 예정】 화면 검증 후 firestore.rules individualEvaluations read 를
 *   `if isHrAdmin()` 로 잠가 비-HR 의 콘솔·curl 직접 조회를 차단.
 */

import { NextRequest, NextResponse } from 'next/server';
import { initializeApp, getApps, getApp, cert, ServiceAccount } from 'firebase-admin/app';
import { getFirestore, Firestore, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { computeEvalReadScopeOrgIds } from '@/lib/eval-authz';
import type { Organization } from '@/types';

const COLLECTION = 'individualEvaluations';

function getAdminApp() {
  if (getApps().length > 0) return getApp();
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY 환경변수가 없습니다.');
  return initializeApp({ credential: cert(JSON.parse(raw) as ServiceAccount) });
}

/** Firestore Timestamp → ISO 문자열 (클라이언트가 Date 로 복원) */
function iso(v: any): string | undefined {
  if (!v) return undefined;
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (v.toDate) return v.toDate().toISOString();
  if (v instanceof Date) return v.toISOString();
  return undefined;
}

/** Admin SDK doc → 클라이언트 평가 객체(날짜 필드 ISO 직렬화) */
function serializeEval(id: string, d: any) {
  return {
    ...d,
    id,
    createdAt: iso(d.createdAt) ?? new Date().toISOString(),
    updatedAt: iso(d.updatedAt) ?? new Date().toISOString(),
    leadSubmittedAt: iso(d.leadSubmittedAt),
    hqReviewedAt: iso(d.hqReviewedAt),
    execConfirmedAt: iso(d.execConfirmedAt),
  };
}

interface Requester {
  uid: string;
  role: string;
  orgId: string | undefined;
  isHr: boolean;
}

/** HR·CEO 는 전체 열람 */
function isAllAccess(r: Requester): boolean {
  return r.isHr || r.role === 'CEO';
}

async function loadAllOrgs(db: Firestore): Promise<Organization[]> {
  const snap = await db.collection('organizations').get();
  return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Organization[];
}

export async function POST(req: NextRequest) {
  try {
    const app = getAdminApp();
    const auth = getAuth(app);
    const db = getFirestore(app);

    const authHeader = req.headers.get('authorization') ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    let uid: string;
    try {
      const decoded = await auth.verifyIdToken(token);
      uid = decoded.uid;
    } catch {
      return NextResponse.json({ error: 'invalid token' }, { status: 401 });
    }

    const userSnap = await db.collection('users').doc(uid).get();
    const userData = userSnap.data();
    if (!userData) return NextResponse.json({ error: 'user not found' }, { status: 403 });
    const requester: Requester = {
      uid,
      role: userData.role ?? 'MEMBER',
      orgId: userData.organizationId ?? undefined,
      isHr: userData.isHrAdmin === true || userData.isHrMaster === true || userData.role === 'HR_ADMIN',
    };

    const body = await req.json().catch(() => ({}));
    const mode: string = body.mode;
    const year = Number(body.year);
    if (!Number.isFinite(year)) return NextResponse.json({ error: 'year 필요' }, { status: 400 });

    const allAccess = isAllAccess(requester);
    // 조직 스코프는 필요할 때만 계산 (allAccess 면 불필요)
    let scope: Set<string> | null = null;
    async function getScope(): Promise<Set<string>> {
      if (!scope) {
        const allOrgs = await loadAllOrgs(db);
        scope = new Set(computeEvalReadScopeOrgIds(requester.uid, requester.role, requester.orgId, allOrgs));
      }
      return scope;
    }

    if (mode === 'single') {
      const targetUserId: string = body.userId;
      if (!targetUserId) return NextResponse.json({ error: 'userId 필요' }, { status: 400 });
      const snap = await db.collection(COLLECTION)
        .where('userId', '==', targetUserId)
        .where('cycleYear', '==', year)
        .get();
      const docs = snap.docs.map(d => serializeEval(d.id, d.data()));
      // 권한: 본인 OR HR/CEO OR 대상 평가의 조직이 내 스코프 내
      if (targetUserId === uid || allAccess) return NextResponse.json({ evals: docs });
      const s = await getScope();
      const allowed = docs.filter(e => s.has(e.organizationId));
      return NextResponse.json({ evals: allowed });
    }

    if (mode === 'org') {
      const orgId: string = body.orgId;
      if (!orgId) return NextResponse.json({ error: 'orgId 필요' }, { status: 400 });
      if (!allAccess) {
        const s = await getScope();
        if (!s.has(orgId)) return NextResponse.json({ evals: [] });
      }
      const snap = await db.collection(COLLECTION)
        .where('organizationId', '==', orgId)
        .where('cycleYear', '==', year)
        .get();
      const evals = snap.docs.map(d => serializeEval(d.id, d.data()));
      return NextResponse.json({ evals });
    }

    if (mode === 'all') {
      const snap = await db.collection(COLLECTION).where('cycleYear', '==', year).get();
      const all = snap.docs.map(d => serializeEval(d.id, d.data()));
      if (allAccess) return NextResponse.json({ evals: all });
      // 비-HR/CEO: 본인 스코프 조직 + 본인 평가만
      const s = await getScope();
      const evals = all.filter(e => e.userId === uid || s.has(e.organizationId));
      return NextResponse.json({ evals });
    }

    return NextResponse.json({ error: 'invalid mode' }, { status: 400 });
  } catch (e: any) {
    console.error('[evaluation/individual] failed:', e?.message, e?.stack);
    return NextResponse.json({ error: e?.message ?? 'failed' }, { status: 500 });
  }
}

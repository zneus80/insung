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
 * 【Phase 1】 현재 권한 정책을 그대로 서버에서 재현한다(투명 리팩터):
 *   읽기 허용 = 본인 평가 OR 팀장/임원/CEO OR HR(관리자·마스터)
 *   → 동작 변화 없음. read 경로만 서버로 이전.
 *
 * 【Phase 2 예정】 authorizeAndFilter() 를 조직 체인 스코프 기반으로 좁히고,
 *   firestore.rules 의 read 를 `if isHrAdmin()` 로 잠가 비-HR 의 직접 조회를 차단한다.
 */

import { NextRequest, NextResponse } from 'next/server';
import { initializeApp, getApps, getApp, cert, ServiceAccount } from 'firebase-admin/app';
import { getFirestore, Firestore, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

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
  isHr: boolean;
}

/**
 * 권한 판정 + 필터.
 * 【Phase 1】 현재 정책 그대로: privileged(팀장/임원/CEO/HR)는 전체, 그 외는 본인 것만.
 */
function isPrivileged(r: Requester): boolean {
  return r.isHr || r.role === 'CEO' || r.role === 'EXECUTIVE' || r.role === 'TEAM_LEAD';
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
      isHr: userData.isHrAdmin === true || userData.isHrMaster === true || userData.role === 'HR_ADMIN',
    };

    const body = await req.json().catch(() => ({}));
    const mode: string = body.mode;
    const year = Number(body.year);
    if (!Number.isFinite(year)) return NextResponse.json({ error: 'year 필요' }, { status: 400 });

    const priv = isPrivileged(requester);

    if (mode === 'single') {
      const targetUserId: string = body.userId;
      if (!targetUserId) return NextResponse.json({ error: 'userId 필요' }, { status: 400 });
      // 권한: 본인 또는 privileged
      if (targetUserId !== uid && !priv) {
        return NextResponse.json({ evals: [] });
      }
      const snap = await db.collection(COLLECTION)
        .where('userId', '==', targetUserId)
        .where('cycleYear', '==', year)
        .get();
      const evals = snap.docs.map(d => serializeEval(d.id, d.data()));
      return NextResponse.json({ evals });
    }

    if (mode === 'org') {
      const orgId: string = body.orgId;
      if (!orgId) return NextResponse.json({ error: 'orgId 필요' }, { status: 400 });
      // Phase 1: privileged 만 조직 단위 조회 허용 (기존 화면이 호출하는 권한과 동일)
      if (!priv) return NextResponse.json({ evals: [] });
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
      // Phase 1: privileged → 전체, 그 외 → 본인 것만
      const evals = priv ? all : all.filter(e => e.userId === uid);
      return NextResponse.json({ evals });
    }

    return NextResponse.json({ error: 'invalid mode' }, { status: 400 });
  } catch (e: any) {
    console.error('[evaluation/individual] failed:', e?.message, e?.stack);
    return NextResponse.json({ error: e?.message ?? 'failed' }, { status: 500 });
  }
}

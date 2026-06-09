export const dynamic = 'force-dynamic';

/**
 * 평가 부속 문서(자기평가·연말평가·육성면담서) 읽기 프록시 (옵션 E, Phase 3).
 * docId = `${userId}_${year}` 구조의 3개 컬렉션을 공통 처리한다.
 *
 * 인증: Authorization: Bearer <Firebase ID Token>
 * body: { collection, mode, userId?, userIds?, year }
 *   collection: 'selfEvaluations' | 'yearEndEvals' | 'mentoringForms'
 *   mode: 'single'  → { userId, year }
 *         'byUsers' → { userIds[], year }
 *
 * 권한: 본인(userId===요청자) OR HR(관리자·마스터)/CEO OR 대상 문서의 조직이 내 스코프 내.
 *   (규칙은 owner/HR/CEO 직접 read 만 허용 → 팀장·임원의 타인 조회는 이 프록시 경유)
 */

import { NextRequest, NextResponse } from 'next/server';
import { initializeApp, getApps, getApp, cert, ServiceAccount } from 'firebase-admin/app';
import { getFirestore, Firestore, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { computeEvalReadScopeOrgIds } from '@/lib/eval-authz';
import type { Organization } from '@/types';

const ALLOWED_COLLECTIONS = ['selfEvaluations', 'yearEndEvals', 'mentoringForms'] as const;
type FormCollection = (typeof ALLOWED_COLLECTIONS)[number];

function getAdminApp() {
  if (getApps().length > 0) return getApp();
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY 환경변수가 없습니다.');
  return initializeApp({ credential: cert(JSON.parse(raw) as ServiceAccount) });
}

/** Firestore Timestamp 를 ISO 문자열로 깊은 변환 (클라이언트가 Date 로 복원) */
function serialize(v: any): any {
  if (v == null) return v;
  if (v instanceof Timestamp || typeof v?.toDate === 'function') return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(serialize);
  if (typeof v === 'object') {
    const out: Record<string, any> = {};
    for (const k of Object.keys(v)) out[k] = serialize(v[k]);
    return out;
  }
  return v;
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
      uid = (await auth.verifyIdToken(token)).uid;
    } catch {
      return NextResponse.json({ error: 'invalid token' }, { status: 401 });
    }

    const userSnap = await db.collection('users').doc(uid).get();
    const userData = userSnap.data();
    if (!userData) return NextResponse.json({ error: 'user not found' }, { status: 403 });
    const role: string = userData.role ?? 'MEMBER';
    const orgId: string | undefined = userData.organizationId ?? undefined;
    const allAccess = userData.isHrAdmin === true || userData.isHrMaster === true || role === 'HR_ADMIN' || role === 'CEO';

    const body = await req.json().catch(() => ({}));
    const collection: FormCollection = body.collection;
    const mode: string = body.mode;
    const year = Number(body.year);
    if (!ALLOWED_COLLECTIONS.includes(collection)) return NextResponse.json({ error: 'invalid collection' }, { status: 400 });
    if (!Number.isFinite(year)) return NextResponse.json({ error: 'year 필요' }, { status: 400 });

    // 스코프는 비-allAccess 일 때만 1회 계산
    let scope: Set<string> | null = null;
    async function getScope(): Promise<Set<string>> {
      if (!scope) {
        const allOrgs = await loadAllOrgs(db);
        scope = new Set(computeEvalReadScopeOrgIds(uid, role, orgId, allOrgs));
      }
      return scope;
    }

    // 단일 문서 권한 판정
    async function authorized(docUserId: string, docData: any): Promise<boolean> {
      if (docUserId === uid || allAccess) return true;
      const s = await getScope();
      return !!docData?.organizationId && s.has(docData.organizationId);
    }

    if (mode === 'single') {
      const targetUserId: string = body.userId;
      if (!targetUserId) return NextResponse.json({ error: 'userId 필요' }, { status: 400 });
      const snap = await db.collection(collection).doc(`${targetUserId}_${year}`).get();
      if (!snap.exists) return NextResponse.json({ docs: [] });
      const data = snap.data();
      if (!(await authorized(data!.userId ?? targetUserId, data))) return NextResponse.json({ docs: [] });
      return NextResponse.json({ docs: [{ ...serialize(data), id: snap.id }] });
    }

    if (mode === 'byUsers') {
      const userIds: string[] = Array.isArray(body.userIds) ? body.userIds : [];
      if (userIds.length === 0) return NextResponse.json({ docs: [] });
      const snaps = await db.getAll(...userIds.map(u => db.collection(collection).doc(`${u}_${year}`)));
      const out: any[] = [];
      for (const snap of snaps) {
        if (!snap.exists) continue;
        const data = snap.data()!;
        if (await authorized(data.userId, data)) out.push({ ...serialize(data), id: snap.id });
      }
      return NextResponse.json({ docs: out });
    }

    return NextResponse.json({ error: 'invalid mode' }, { status: 400 });
  } catch (e: any) {
    console.error('[evaluation/forms] failed:', e?.message, e?.stack);
    console.error('[evaluation/forms] 실패:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

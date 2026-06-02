import { initializeApp, getApps, getApp, cert, ServiceAccount } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

/**
 * 서버 Route Handler 공용 권한 검증.
 * Authorization: Bearer <Firebase ID Token> 를 검증하고 호출자의 HR 권한을 확인한다.
 * Admin SDK 는 Firestore 규칙을 우회하므로, 특권 API 는 반드시 이 가드를 통과시켜야 한다.
 */

function adminApp() {
  if (getApps().length > 0) return getApp();
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY 환경변수가 없습니다.');
  return initializeApp({ credential: cert(JSON.parse(raw) as ServiceAccount) });
}

export type AuthResult =
  | { ok: true; uid: string; isHrAdmin: boolean; isHrMaster: boolean; name: string }
  | { ok: false; status: number; error: string };

/**
 * 요청자를 검증한다.
 *  - opts.master=true  → HR 마스터만 통과
 *  - 그 외             → HR 관리자(또는 마스터) 통과
 */
export async function requireHr(req: Request, opts: { master?: boolean } = {}): Promise<AuthResult> {
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return { ok: false, status: 401, error: 'unauthorized' };

  let uid: string;
  try {
    uid = (await getAuth(adminApp()).verifyIdToken(token)).uid;
  } catch {
    return { ok: false, status: 401, error: 'invalid token' };
  }

  const snap = await getFirestore(adminApp()).collection('users').doc(uid).get();
  const u = snap.data();
  const isHrAdmin = u?.isHrAdmin === true || u?.isHrMaster === true || u?.role === 'HR_ADMIN';
  const isHrMaster = u?.isHrMaster === true;

  if (opts.master && !isHrMaster) {
    return { ok: false, status: 403, error: 'forbidden: HR master required' };
  }
  if (!opts.master && !isHrAdmin) {
    return { ok: false, status: 403, error: 'forbidden: HR admin required' };
  }
  return { ok: true, uid, isHrAdmin, isHrMaster, name: u?.name ?? '' };
}

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';
import { initializeApp, getApps, getApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

function getAdminApp() {
  if (getApps().length > 0) return getApp();
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)
    : null;
  if (!serviceAccount) throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY 환경변수가 없습니다.');
  return initializeApp({ credential: cert(serviceAccount) });
}

const adminDb = () => getFirestore(getAdminApp());

/**
 * 사용자를 Firestore + Firebase Auth 양쪽에서 일관되게 삭제한다.
 *
 * 입력:
 *  - uid:   Firestore users 문서 ID (보통 Auth UID 와 동일하나, 초대대기 단계에서는 placeholder UUID)
 *  - email: (선택) Auth UID 가 placeholder 와 다른 경우 이메일로 Auth 계정 식별
 *
 * 동작:
 *  1) Firestore users/{uid} document 삭제
 *  2) Firebase Auth 계정 삭제
 *     - 먼저 uid 로 시도 (Firestore document ID 가 Auth UID 와 일치하는 정상 케이스)
 *     - 실패하면 email 로 fallback (placeholder 케이스)
 *     - 둘 다 못 찾으면 Auth 삭제는 스킵 (Firestore 만 삭제됨, 이미 삭제됐을 수 있음)
 */
export async function POST(req: NextRequest) {
  try {
    const { uid, email } = await req.json();
    if (!uid) return NextResponse.json({ error: 'uid 필요' }, { status: 400 });

    const db = adminDb();
    const auth = adminAuth.getAuth();

    // 1) Firestore document 삭제
    await db.collection('users').doc(uid).delete();

    // 2) Firebase Auth 계정 삭제 시도
    let deletedAuthUid: string | null = null;
    try {
      await auth.deleteUser(uid);
      deletedAuthUid = uid;
    } catch (e: any) {
      // uid 로 못 찾았을 때 → email 로 fallback
      if (email) {
        try {
          const u = await auth.getUserByEmail(email);
          await auth.deleteUser(u.uid);
          deletedAuthUid = u.uid;
        } catch {
          // Auth 계정이 이미 없는 경우: 정상 처리
        }
      }
    }

    return NextResponse.json({ ok: true, deletedAuthUid });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

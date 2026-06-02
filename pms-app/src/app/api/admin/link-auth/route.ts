export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';
import { requireHr } from '@/lib/api-auth';
import { initializeApp, getApps, getApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const RESET_PASSWORD = '1q2w3e4r!';

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
 * 기존 Firebase Auth 계정(같은 이메일)을 placeholder Firestore document 와 연결한다.
 *
 * 흐름:
 *  1) email 로 Firebase Auth UID 조회 (Admin SDK)
 *  2) (옵션) 비밀번호를 RESET_PASSWORD 로 초기화 (사용자가 로그인 가능하도록)
 *  3) placeholder Firestore document(현재 placeholderId) 데이터를 읽어
 *     실제 Auth UID 로 새 document 생성 (isActive: true)
 *  4) placeholder document 삭제
 *
 * 입력: { placeholderId: string, email: string, resetPassword?: boolean }
 */
export async function POST(req: NextRequest) {
  try {
    const gate = await requireHr(req, {});
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

    const { placeholderId, email, resetPassword = true } = await req.json();
    if (!placeholderId || !email) {
      return NextResponse.json({ error: 'placeholderId, email 필요' }, { status: 400 });
    }

    const auth = adminAuth.getAuth();
    let authUser;
    try {
      authUser = await auth.getUserByEmail(email);
    } catch {
      return NextResponse.json({ error: '해당 이메일의 Firebase Auth 계정을 찾을 수 없습니다.' }, { status: 404 });
    }

    if (resetPassword) {
      await auth.updateUser(authUser.uid, { password: RESET_PASSWORD, disabled: false });
    } else {
      await auth.updateUser(authUser.uid, { disabled: false });
    }

    const db = adminDb();
    // placeholder document 읽기
    const placeholderRef = db.collection('users').doc(placeholderId);
    const placeholderSnap = await placeholderRef.get();
    if (!placeholderSnap.exists) {
      return NextResponse.json({ error: 'placeholder Firestore 문서를 찾을 수 없습니다.' }, { status: 404 });
    }
    const placeholderData = placeholderSnap.data() ?? {};

    // Auth UID 와 동일한 ID 로 새 document 생성 (이미 있으면 merge 로 갱신)
    const targetRef = db.collection('users').doc(authUser.uid);
    await targetRef.set({
      ...placeholderData,
      id: authUser.uid,
      email,
      isActive: true,
      wasActivated: true,
      updatedAt: new Date(),
    }, { merge: true });

    // placeholder 가 Auth UID 와 다른 경우에만 삭제
    if (placeholderId !== authUser.uid) {
      await placeholderRef.delete();
    }

    return NextResponse.json({ ok: true, uid: authUser.uid, password: resetPassword ? RESET_PASSWORD : undefined });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

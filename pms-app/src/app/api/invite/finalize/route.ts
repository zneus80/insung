export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { initializeApp, getApps, getApp, cert, ServiceAccount } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

/**
 * 초대 수락 마무리 — 권한이 필요한 부분만 서버(Admin SDK)에서 처리.
 *
 * 클라이언트가 createUserWithEmailAndPassword 로 Auth 계정을 만든 뒤(=본인 로그인 상태) 호출한다.
 * 신규 가입자는 '남의' placeholder users 문서를 삭제할 권한이 없어(규칙상 owner/HR만) 여기서 대신 처리한다.
 *
 * 입력: { token: string, idToken: string }
 *  1) idToken 검증 → 호출자 uid·email 확보
 *  2) 초대 문서 확인 + 이메일 일치 검증(초대 대상 본인인지)
 *  3) placeholder users 문서 삭제(있고 uid 와 다를 때)
 *  4) 초대 사용처리(usedAt, userId=uid)
 */
function adminApp() {
  if (getApps().length > 0) return getApp();
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY 환경변수가 없습니다.');
  return initializeApp({ credential: cert(JSON.parse(raw) as ServiceAccount) });
}

export async function POST(req: NextRequest) {
  try {
    const { token, idToken } = await req.json();
    if (!token || !idToken) {
      return NextResponse.json({ error: 'token, idToken 필요' }, { status: 400 });
    }

    // 1) 호출자 검증 (방금 비밀번호를 설정해 로그인한 본인)
    let caller;
    try {
      caller = await getAuth(adminApp()).verifyIdToken(idToken);
    } catch {
      return NextResponse.json({ error: 'invalid token' }, { status: 401 });
    }
    const uid = caller.uid;
    const callerEmail = (caller.email ?? '').toLowerCase();

    const db = getFirestore(adminApp());

    // 2) 초대 문서 확인
    const invRef = db.collection('invitations').doc(token);
    const invSnap = await invRef.get();
    if (!invSnap.exists) {
      return NextResponse.json({ error: '초대 정보를 찾을 수 없습니다.' }, { status: 404 });
    }
    const inv = invSnap.data() ?? {};
    const invEmail = (inv.email ?? '').toLowerCase();
    // 초대 대상 본인만 마무리 가능
    if (invEmail && callerEmail && invEmail !== callerEmail) {
      return NextResponse.json({ error: '초대 이메일과 로그인 계정이 일치하지 않습니다.' }, { status: 403 });
    }

    // 3) placeholder users 문서 삭제 (있고 신규 uid 와 다를 때)
    const placeholderId: string | undefined = inv.userId;
    if (placeholderId && placeholderId !== uid) {
      try { await db.collection('users').doc(placeholderId).delete(); }
      catch (e) { console.error('[invite/finalize] placeholder 삭제 실패:', e); }
    }

    // 4) 초대 사용처리
    await invRef.set({ usedAt: new Date(), userId: uid }, { merge: true });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    console.error('[invite/finalize] 실패:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

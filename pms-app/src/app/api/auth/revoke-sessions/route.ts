import { NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';

/**
 * 본인의 모든 refresh token 무효화 → 다른 디바이스 세션 강제 로그아웃.
 * 비밀번호 변경 직후 호출.
 *
 * 인증: Authorization: Bearer <idToken> (현재 세션의 Firebase ID 토큰)
 * — verifyIdToken 으로 uid 확인 후 본인 토큰만 revoke (남의 uid 지정 불가)
 */
export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('authorization') ?? '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!idToken) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const auth = adminAuth.getAuth();
    const decoded = await auth.verifyIdToken(idToken, /*checkRevoked*/ false);
    await auth.revokeRefreshTokens(decoded.uid);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('[revoke-sessions] 실패:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

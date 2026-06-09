export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';
import { requireHr } from '@/lib/api-auth';

const RESET_PASSWORD = '1q2w3e4r!';

export async function POST(req: NextRequest) {
  try {
    const gate = await requireHr(req, { master: true });
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

    const { uid } = await req.json();
    if (!uid) return NextResponse.json({ error: 'uid 필요' }, { status: 400 });

    await adminAuth.getAuth().updateUser(uid, { password: RESET_PASSWORD });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('[reset-password] 실패:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

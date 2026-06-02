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
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

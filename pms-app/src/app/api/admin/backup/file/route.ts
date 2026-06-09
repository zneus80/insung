export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { initializeApp, getApps, getApp, cert, ServiceAccount } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { getAuth } from 'firebase-admin/auth';

function getAdminApp() {
  if (getApps().length > 0) return getApp();
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY) as ServiceAccount
    : null;
  if (!serviceAccount) throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY 환경변수가 없습니다.');
  return initializeApp({
    credential: cert(serviceAccount),
    storageBucket: process.env.BACKUP_STORAGE_BUCKET ?? 'insung-pms-backups',
  });
}

/**
 * 백업 JSON 파일 조회 — HR 마스터 전용.
 * GET /api/admin/backup/file?id=<backupId>
 *   - Authorization: Bearer <Firebase ID Token>
 *   - 반환: 백업 스냅샷 JSON 원본 (application/json)
 *
 * 감사 로그에 BACKUP_DOWNLOAD 기록.
 */
export async function GET(req: NextRequest) {
  try {
    const app = getAdminApp();
    const auth = getAuth(app);
    const db = getFirestore(app);

    const authHeader = req.headers.get('authorization') ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const decoded = await auth.verifyIdToken(token);
    const userDoc = await db.collection('users').doc(decoded.uid).get();
    const userData = userDoc.data();
    if (!userData?.isHrMaster) {
      return NextResponse.json({ error: 'forbidden: HR master required' }, { status: 403 });
    }
    const actorName = userData.name ?? decoded.email ?? '알 수 없음';

    const { searchParams } = new URL(req.url);
    const backupId = searchParams.get('id') ?? '';
    if (!backupId) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const backupSnap = await db.collection('backups').doc(backupId).get();
    if (!backupSnap.exists) return NextResponse.json({ error: 'backup not found' }, { status: 404 });
    const meta = backupSnap.data() as any;
    if (!meta?.storagePath) {
      return NextResponse.json({ error: 'this backup has no snapshot data (legacy)' }, { status: 400 });
    }

    const bucket = getStorage(app).bucket(process.env.BACKUP_STORAGE_BUCKET ?? 'insung-pms-backups');
    const [buf] = await bucket.file(meta.storagePath).download();

    // 감사 로그
    const { FieldValue } = await import('firebase-admin/firestore');
    await db.collection('auditLogs').add({
      action: 'BACKUP_DOWNLOAD',
      actorId: decoded.uid,
      actorName,
      targetId: backupId,
      details: `백업 JSON 원본 다운로드 — ${meta.storagePath}, ${buf.length}바이트`,
      createdAt: FieldValue.serverTimestamp(),
    });

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${backupId}_${meta.year ?? 'backup'}.json"`,
      },
    });
  } catch (e: any) {
    console.error('[backup/file] failed:', e?.message, e?.stack);
    console.error('[backup/file] 실패:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

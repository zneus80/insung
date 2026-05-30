export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { initializeApp, getApps, getApp, cert, ServiceAccount } from 'firebase-admin/app';
import { getFirestore, Firestore, Timestamp, FieldValue, WriteBatch } from 'firebase-admin/firestore';
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
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? 'insung-pms.firebasestorage.app',
  });
}

/** ISO 문자열 또는 { __ts } 래퍼를 Timestamp 로 변환 (snapshot 시 직렬화 형식과 대응) */
function deserializeValue(v: any): any {
  if (v === null || v === undefined) return v;
  if (typeof v === 'object' && '__ts' in v && typeof v.__ts === 'string') {
    return Timestamp.fromDate(new Date(v.__ts));
  }
  if (Array.isArray(v)) return v.map(deserializeValue);
  if (typeof v === 'object') {
    const out: Record<string, any> = {};
    for (const k of Object.keys(v)) out[k] = deserializeValue(v[k]);
    return out;
  }
  return v;
}

async function deleteAll(db: Firestore, name: string) {
  const snap = await db.collection(name).get();
  const batches: WriteBatch[] = [];
  let batch = db.batch(); let count = 0;
  for (const d of snap.docs) {
    batch.delete(d.ref);
    count++;
    if (count >= 400) { batches.push(batch); batch = db.batch(); count = 0; }
  }
  if (count > 0) batches.push(batch);
  for (const b of batches) await b.commit();
  return snap.size;
}

async function writeAll(db: Firestore, name: string, docs: Array<{ id: string; data: any; subcollections?: any }>) {
  let batch = db.batch(); let count = 0; let written = 0;
  for (const d of docs) {
    const ref = db.collection(name).doc(d.id);
    batch.set(ref, deserializeValue(d.data));
    count++; written++;
    if (count >= 400) { await batch.commit(); batch = db.batch(); count = 0; }
    // oneOnOnes 서브컬렉션 처리
    if (d.subcollections?.questions) {
      let subBatch = db.batch(); let sc = 0;
      for (const q of d.subcollections.questions) {
        subBatch.set(db.collection(name).doc(d.id).collection('questions').doc(q.id), deserializeValue(q.data));
        sc++;
        if (sc >= 400) { await subBatch.commit(); subBatch = db.batch(); sc = 0; }
      }
      if (sc > 0) await subBatch.commit();
    }
  }
  if (count > 0) await batch.commit();
  return written;
}

/**
 * 백업 복원 (전체 덮어쓰기).
 *
 * 인증: HR 마스터 ID 토큰 필수.
 * Body: { backupId: string, confirmText: string }
 *   - confirmText 가 "RESTORE" 가 아니면 거부 (실수 방지)
 *
 * 동작:
 * 1) backupId → Firestore backups/{id} → storagePath 조회
 * 2) Storage 에서 JSON 다운로드 및 파싱
 * 3) 백업에 포함된 각 컬렉션 → 전부 삭제 후 백업 데이터로 덮어쓰기
 * 4) 감사 로그 기록
 *
 * 주의: 본 작업은 비가역적입니다 (현재 데이터 모두 사라짐). 클라이언트에서 강한 확인 UI 필요.
 */
export async function POST(req: NextRequest) {
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

    const body = await req.json();
    const backupId: string = body?.backupId ?? '';
    const confirmText: string = body?.confirmText ?? '';
    if (!backupId) return NextResponse.json({ error: 'backupId required' }, { status: 400 });
    if (confirmText !== 'RESTORE') {
      return NextResponse.json({ error: 'confirmText must be "RESTORE"' }, { status: 400 });
    }

    const backupSnap = await db.collection('backups').doc(backupId).get();
    if (!backupSnap.exists) return NextResponse.json({ error: 'backup not found' }, { status: 404 });
    const backupMeta = backupSnap.data() as any;
    if (!backupMeta?.storagePath) {
      return NextResponse.json({ error: 'this backup has no snapshot data (legacy record)' }, { status: 400 });
    }

    // Storage 에서 JSON 읽기
    const bucket = getStorage(app).bucket();
    const file = bucket.file(backupMeta.storagePath);
    const [exists] = await file.exists();
    if (!exists) return NextResponse.json({ error: 'snapshot file not found in storage' }, { status: 404 });
    const [buf] = await file.download();
    const payload = JSON.parse(buf.toString('utf8'));
    if (!payload?.data || !Array.isArray(payload?.collections)) {
      return NextResponse.json({ error: 'invalid snapshot format' }, { status: 400 });
    }

    // 컬렉션별로 삭제 후 쓰기
    const deletedStats: Record<string, number> = {};
    const writtenStats: Record<string, number> = {};
    for (const name of payload.collections as string[]) {
      const docs = payload.data[name] ?? [];
      deletedStats[name] = await deleteAll(db, name);
      writtenStats[name] = await writeAll(db, name, docs);
    }

    // 감사 로그
    await db.collection('auditLogs').add({
      action: 'BACKUP_RESTORE' as any,
      actorId: decoded.uid,
      actorName,
      targetId: backupId,
      details: `백업 복원 (전체 덮어쓰기) — backupId=${backupId}, path=${backupMeta.storagePath}`,
      createdAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      ok: true,
      backupId,
      deleted: deletedStats,
      written: writtenStats,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'failed' }, { status: 500 });
  }
}

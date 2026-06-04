export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { initializeApp, getApps, getApp, cert, ServiceAccount } from 'firebase-admin/app';
import { getFirestore, Firestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
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
 * 백업 대상 컬렉션 — 핵심 인사평가 데이터.
 * (auditLogs, notifications, invitations 는 운영 로그 / 일시 데이터라 제외)
 */
const BACKUP_COLLECTIONS = [
  'users',
  'organizations',
  'goals',
  'goalHistories',
  'progressUpdates',
  'orgEvaluations',
  'individualEvaluations',
  'evaluationCycles',
  'gradeQuotas',
  'mileages',
  'annualGoals',
  'orgGradeHistories',
  'divisionGradeQuotas',
  'selfEvaluations',
  'yearEndEvals',
  'mentoringForms',
  'announcements',
  'awards',
  'systemSettings',
  'weeklyTasks',
  'innovationActivities',
  'oneOnOnes',
];

/** Timestamp → ISO 문자열로 직렬화 (복원 시 다시 Timestamp 로 변환) */
function serializeValue(v: any): any {
  if (v === null || v === undefined) return v;
  if (v instanceof Timestamp) return { __ts: v.toDate().toISOString() };
  if (v instanceof Date) return { __ts: v.toISOString() };
  if (Array.isArray(v)) return v.map(serializeValue);
  if (typeof v === 'object') {
    const out: Record<string, any> = {};
    for (const k of Object.keys(v)) out[k] = serializeValue(v[k]);
    return out;
  }
  return v;
}

async function snapshotCollection(db: Firestore, name: string) {
  const snap = await db.collection(name).get();
  const docs = snap.docs.map(d => ({
    id: d.id,
    data: serializeValue(d.data()),
  }));
  // oneOnOnes/{id}/questions 서브컬렉션 별도 처리
  if (name === 'oneOnOnes') {
    for (const doc of docs) {
      const sub = await db.collection('oneOnOnes').doc(doc.id).collection('questions').get();
      (doc as any).subcollections = {
        questions: sub.docs.map(s => ({ id: s.id, data: serializeValue(s.data()) })),
      };
    }
  }
  return docs;
}

/**
 * 백업 스냅샷 생성.
 *
 * 인증: 둘 중 하나
 * - Authorization: Bearer <Firebase ID Token>  (HR 마스터 사용자)
 * - Authorization: Bearer <OIDC ID Token>      (Cloud Scheduler 서비스 계정 — issuer 검증)
 */
export async function POST(req: NextRequest) {
  try {
    const app = getAdminApp();
    const auth = getAuth(app);
    const db = getFirestore(app);

    const authHeader = req.headers.get('authorization') ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    let actorId = 'system';
    let actorName = '자동 백업 (Cloud Scheduler)';
    let isSystem = false;

    // 먼저 Firebase ID 토큰으로 시도 → 실패 시 Cloud Scheduler OIDC 토큰으로 시도
    try {
      const decoded = await auth.verifyIdToken(token);
      actorId = decoded.uid;
      const userDoc = await db.collection('users').doc(decoded.uid).get();
      const userData = userDoc.data();
      if (!userData?.isHrMaster) {
        return NextResponse.json({ error: 'forbidden: HR master required' }, { status: 403 });
      }
      actorName = userData.name ?? decoded.email ?? '알 수 없음';
    } catch {
      // OIDC 토큰 검증 — Cloud Scheduler 서비스 계정 (운영 시 별도 검증 로직 권장)
      const expectedAud = process.env.SCHEDULER_OIDC_AUDIENCE;
      const expectedEmail = process.env.SCHEDULER_SA_EMAIL;
      if (!expectedAud || !expectedEmail) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
      }
      const parts = token.split('.');
      if (parts.length !== 3) return NextResponse.json({ error: 'invalid token' }, { status: 401 });
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      if (payload.iss !== 'https://accounts.google.com') {
        return NextResponse.json({ error: 'invalid issuer' }, { status: 401 });
      }
      if (payload.email !== expectedEmail) {
        return NextResponse.json({ error: 'invalid email' }, { status: 401 });
      }
      if (payload.aud !== expectedAud) {
        return NextResponse.json({ error: 'invalid audience' }, { status: 401 });
      }
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
        return NextResponse.json({ error: 'token expired' }, { status: 401 });
      }
      isSystem = true;
    }

    // 모든 컬렉션 스냅샷
    const snapshot: Record<string, any[]> = {};
    const stats: Record<string, number> = {};
    for (const name of BACKUP_COLLECTIONS) {
      const docs = await snapshotCollection(db, name);
      snapshot[name] = docs;
      stats[name] = docs.length;
    }

    // D-4: 백업 무결성 검증 — 핵심 컬렉션 (users / organizations) 이 0건이면 비정상으로 간주
    if ((stats.users ?? 0) === 0 || (stats.organizations ?? 0) === 0) {
      const reason = `백업 데이터 비정상 — users=${stats.users}, organizations=${stats.organizations}`;
      await notifyBackupFailure(db, actorId, actorName, isSystem, reason);
      return NextResponse.json({ error: reason }, { status: 500 });
    }

    // 메타 정보
    const now = new Date();
    const year = now.getFullYear();
    const fileTimestamp = now.toISOString().replace(/[:.]/g, '-');
    const storagePath = `backups/${year}/${fileTimestamp}_${isSystem ? 'auto' : 'manual'}.json`;
    const payload = {
      version: 1,
      createdAt: now.toISOString(),
      year,
      actorId,
      actorName,
      collections: BACKUP_COLLECTIONS,
      stats,
      data: snapshot,
    };
    const json = JSON.stringify(payload);

    // Firebase Storage 업로드
    const bucket = getStorage(app).bucket(process.env.BACKUP_STORAGE_BUCKET ?? 'insung-pms-backups');
    const file = bucket.file(storagePath);
    await file.save(json, {
      contentType: 'application/json',
      metadata: { metadata: { actorId, actorName, year: String(year), auto: String(isSystem) } },
    });

    // Firestore backups 컬렉션에 메타데이터 기록
    const docRef = await db.collection('backups').add({
      year,
      createdBy: actorId,
      createdByName: actorName,
      isAuto: isSystem,
      storagePath,
      sizeBytes: Buffer.byteLength(json, 'utf8'),
      stats: {
        // 하위호환: 기존 UI 컬럼 보존
        goals: stats.goals ?? 0,
        users: stats.users ?? 0,
        orgEvaluations: stats.orgEvaluations ?? 0,
        individualEvaluations: stats.individualEvaluations ?? 0,
        mentoringForms: stats.mentoringForms ?? 0,
        // 신규: 전체 컬렉션 카운트
        all: stats,
      },
      createdAt: FieldValue.serverTimestamp(),
    });

    // 감사 로그
    await db.collection('auditLogs').add({
      action: 'BACKUP_CREATE',
      actorId,
      actorName,
      details: `${isSystem ? '[자동] ' : ''}전체 스냅샷 백업 (${Buffer.byteLength(json, 'utf8')}바이트, ${BACKUP_COLLECTIONS.length}개 컬렉션)`,
      createdAt: FieldValue.serverTimestamp(),
    });

    // D-4: 파일 사이즈 검증 — 1KB 미만이면 비정상 (메타만 있고 데이터 없음)
    if (Buffer.byteLength(json, 'utf8') < 1024) {
      await notifyBackupFailure(db, actorId, actorName, isSystem, `백업 파일 크기 비정상 (${Buffer.byteLength(json, 'utf8')}바이트)`);
    }

    return NextResponse.json({
      ok: true,
      backupId: docRef.id,
      storagePath,
      sizeBytes: Buffer.byteLength(json, 'utf8'),
      stats,
    });
  } catch (e: any) {
    console.error('[backup/snapshot] failed:', e?.message, e?.code, e?.stack);
    // D-4: 예외 발생 시에도 HR마스터 알림
    try {
      const app = getAdminApp();
      const db = getFirestore(app);
      await notifyBackupFailure(db, 'system', '시스템', true, `백업 예외: ${e?.message ?? 'unknown'}`);
    } catch { /* 알림 실패 시에도 무시 — 원래 에러 반환이 우선 */ }
    return NextResponse.json({ error: e?.message ?? 'failed', code: e?.code }, { status: 500 });
  }
}

/**
 * D-4: 백업 실패 시 모든 HR마스터에게 in-app 알림 + 감사 로그 기록.
 */
async function notifyBackupFailure(
  db: Firestore,
  actorId: string,
  actorName: string,
  isAuto: boolean,
  reason: string,
): Promise<void> {
  try {
    const mastersSnap = await db.collection('users')
      .where('isHrMaster', '==', true)
      .where('isActive', '==', true)
      .get();

    const now = FieldValue.serverTimestamp();
    const writeBatch = db.batch();

    // 알림 생성
    for (const m of mastersSnap.docs) {
      const notifRef = db.collection('notifications').doc();
      writeBatch.set(notifRef, {
        userId: m.id,
        type: 'BACKUP_FAILED',
        category: 'SECURITY',
        title: '백업 실패 알림',
        message: `${isAuto ? '[자동] ' : ''}백업 실패: ${reason}`,
        link: '/admin/backup',
        read: false,
        createdAt: now,
      });
    }

    // 감사 로그
    const auditRef = db.collection('auditLogs').doc();
    writeBatch.set(auditRef, {
      action: 'BACKUP_FAILED',
      actorId,
      actorName,
      details: `${isAuto ? '[자동] ' : ''}${reason}`,
      createdAt: now,
    });

    await writeBatch.commit();
  } catch (e: any) {
    console.error('[backup/notifyBackupFailure] failed:', e?.message);
  }
}

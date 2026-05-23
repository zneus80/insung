export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';
import { initializeApp, getApps, getApp, cert } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';

function getAdminApp() {
  if (getApps().length > 0) return getApp();
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)
    : null;
  if (!serviceAccount) throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY 환경변수가 없습니다.');
  return initializeApp({ credential: cert(serviceAccount) });
}

const adminDb = () => getFirestore(getAdminApp());

// 사용자가 만든 historical 데이터를 가지는 컬렉션 (userId 필드 기준)
const USER_DATA_COLLECTIONS = [
  'goals',
  'weeklyTasks',
  'selfEvaluations',
  'individualEvaluations',
  'mentoringForms',
  'progressUpdates',
  'notifications',
  'awards',
];

/**
 * 사용자 + 해당 사용자의 historical data 를 backups 컬렉션으로 이관 후 원본 삭제 (v0.75 B13).
 *
 * 흐름:
 *  1) 사용자 데이터 fetch (users / goals / weeklyTasks / mentoringForms / ...)
 *  2) userDataBackups/{uid} 문서로 저장 (deletedAt, deletedBy 포함)
 *  3) historical 데이터 원본 삭제
 *  4) Firestore users 문서 삭제
 *  5) Firebase Auth 계정 삭제 (uid 또는 email 로 식별)
 *
 * 입력: { uid: string, email?: string, deletedBy: string }
 */
async function fetchUserDocuments(db: Firestore, userId: string) {
  const results: Record<string, any[]> = {};
  for (const col of USER_DATA_COLLECTIONS) {
    const snap = await db.collection(col).where('userId', '==', userId).get();
    if (snap.size > 0) {
      results[col] = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
    }
  }
  // mileages 는 document id = userId 패턴
  const mileageDoc = await db.collection('mileages').doc(userId).get();
  if (mileageDoc.exists) {
    results['mileages'] = [{ _id: mileageDoc.id, ...mileageDoc.data() }];
  }
  // 1on1 (leaderId 또는 memberId)
  const [leaderSnap, memberSnap] = await Promise.all([
    db.collection('oneOnOnes').where('leaderId', '==', userId).get(),
    db.collection('oneOnOnes').where('memberId', '==', userId).get(),
  ]);
  const oneOnOnesArr = [
    ...leaderSnap.docs.map(d => ({ _id: d.id, ...d.data() })),
    ...memberSnap.docs.map(d => ({ _id: d.id, ...d.data() })),
  ];
  if (oneOnOnesArr.length > 0) results['oneOnOnes'] = oneOnOnesArr;
  return results;
}

async function deleteUserDocuments(db: Firestore, userId: string, snapshot: Record<string, any[]>) {
  const tasks: Promise<any>[] = [];
  for (const col of USER_DATA_COLLECTIONS) {
    if (!snapshot[col]) continue;
    for (const item of snapshot[col]) {
      tasks.push(db.collection(col).doc(item._id).delete());
    }
  }
  if (snapshot['mileages']) {
    tasks.push(db.collection('mileages').doc(userId).delete());
  }
  if (snapshot['oneOnOnes']) {
    for (const item of snapshot['oneOnOnes']) {
      tasks.push(db.collection('oneOnOnes').doc(item._id).delete());
    }
  }
  await Promise.all(tasks);
}

export async function POST(req: NextRequest) {
  try {
    const { uid, email, deletedBy } = await req.json();
    if (!uid) return NextResponse.json({ error: 'uid 필요' }, { status: 400 });

    const db = adminDb();
    const auth = adminAuth.getAuth();

    // 0) 사용자 정보 가져오기 (백업 메타데이터용)
    const userSnap = await db.collection('users').doc(uid).get();
    const userData = userSnap.exists ? userSnap.data() : null;

    // 1) historical 데이터 수집
    const snapshot = await fetchUserDocuments(db, uid);
    const counts = Object.fromEntries(Object.entries(snapshot).map(([k, v]) => [k, v.length]));
    const totalDocs = Object.values(counts).reduce((s, n) => s + n, 0);

    // 2) backup 문서 저장 (userDataBackups/{uid})
    if (totalDocs > 0 || userData) {
      await db.collection('userDataBackups').doc(uid).set({
        userId: uid,
        userName: userData?.name ?? '',
        email: userData?.email ?? email ?? '',
        originalOrganizationId: userData?.organizationId ?? '',
        originalRole: userData?.role ?? '',
        deletedAt: new Date(),
        deletedBy: deletedBy ?? null,
        userData: userData ?? null,
        data: snapshot,           // {goals:[...], weeklyTasks:[...], ...}
        counts,                   // {goals: 5, weeklyTasks: 30, ...}
      });
    }

    // 3) 원본 historical 데이터 삭제
    await deleteUserDocuments(db, uid, snapshot);

    // 4) Firestore users 문서 삭제
    await db.collection('users').doc(uid).delete();

    // 5) Firebase Auth 계정 삭제
    let deletedAuthUid: string | null = null;
    try {
      await auth.deleteUser(uid);
      deletedAuthUid = uid;
    } catch {
      if (email) {
        try {
          const u = await auth.getUserByEmail(email);
          await auth.deleteUser(u.uid);
          deletedAuthUid = u.uid;
        } catch { /* Auth 계정 없으면 패스 */ }
      }
    }

    return NextResponse.json({
      ok: true,
      deletedAuthUid,
      backedUp: totalDocs > 0,
      counts,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

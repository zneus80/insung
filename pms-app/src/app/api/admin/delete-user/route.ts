export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';
import { initializeApp, getApps, getApp, cert } from 'firebase-admin/app';
import { getFirestore, Firestore, FieldValue } from 'firebase-admin/firestore';

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
// v0.76: goals 는 별도 처리 — 활성 목표는 팀장에게 이관, 종료 목표만 백업+삭제
const USER_DATA_COLLECTIONS = [
  'weeklyTasks',
  'selfEvaluations',
  'individualEvaluations',
  'mentoringForms',
  'progressUpdates',
  'notifications',
  'awards',
];

// 이관 대상 활성 목표 상태 (이외 상태는 백업+삭제)
const ACTIVE_GOAL_STATUSES = new Set([
  'PENDING_APPROVAL', 'LEAD_APPROVED', 'APPROVED', 'IN_PROGRESS',
  'COMPLETED', 'PENDING_COMPLETION', 'PENDING_MODIFY', 'PENDING_ABANDON',
]);

/** 삭제 대상 사용자 → 이관 받을 수행자 ID 결정. 팀장 → 본부장 → 부문/공장 임원 순.
 *  leaderId 가 명시되지 않은 환경 fallback: 해당 조직 소속 사용자 중 TEAM_LEAD / EXECUTIVE 첫 사람.
 */
async function resolveTransferTarget(db: Firestore, userId: string, userOrgId: string): Promise<{ targetUserId: string; targetOrgId: string } | null> {
  const orgsSnap = await db.collection('organizations').get();
  const orgsById = new Map<string, any>();
  orgsSnap.docs.forEach(d => orgsById.set(d.id, { id: d.id, ...d.data() }));

  // 전체 사용자 로드 (작은 규모 가정) — leaderId 미설정 fallback 용
  const usersSnap = await db.collection('users').get();
  const allUsers = usersSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

  function findLeaderInOrg(orgId: string): string | null {
    // 1) 해당 조직 소속이고 role 이 TEAM_LEAD/EXECUTIVE 인 사용자 (삭제 대상 제외)
    const cand = allUsers.find(u =>
      u.id !== userId &&
      u.organizationId === orgId &&
      u.isActive !== false &&
      (u.role === 'TEAM_LEAD' || u.role === 'EXECUTIVE'),
    );
    return cand?.id ?? null;
  }

  let current = orgsById.get(userOrgId);
  while (current) {
    // 1) 명시적 leaderId 우선
    if (current.leaderId && current.leaderId !== userId) {
      return { targetUserId: current.leaderId, targetOrgId: current.id };
    }
    // 2) fallback: 그 조직에 속한 TEAM_LEAD/EXECUTIVE 사용자
    const fb = findLeaderInOrg(current.id);
    if (fb) {
      return { targetUserId: fb, targetOrgId: current.id };
    }
    // 3) 부모 조직으로 이동
    if (!current.parentId) break;
    current = orgsById.get(current.parentId);
  }
  return null;
}

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
  // 종료된 goals (활성 목표는 이관되었고 snapshot.goals 에는 종료된 것만 있음)
  if (snapshot['goals']) {
    for (const item of snapshot['goals']) {
      tasks.push(db.collection('goals').doc(item._id).delete());
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
    const { uid, email, deletedBy, forceDeleteGoals } = await req.json();
    if (!uid) return NextResponse.json({ error: 'uid 필요' }, { status: 400 });

    const db = adminDb();
    const auth = adminAuth.getAuth();

    // 0) 사용자 정보 가져오기 (백업 메타데이터용)
    const userSnap = await db.collection('users').doc(uid).get();
    const userData = userSnap.exists ? userSnap.data() : null;
    const userOrgId = userData?.organizationId ?? '';
    const userName = userData?.name ?? '';

    // 0-1) 활성 목표 이관 (v0.76) — 팀장(→본부장→임원) 에게 이관 후 수행자 재지정 대기
    let transferTarget: { targetUserId: string; targetOrgId: string } | null = null;
    let transferredGoalIds: string[] = [];
    let archivedGoals: any[] = [];
    let notifSentCount = 0;
    if (userOrgId && !forceDeleteGoals) {
      // forceDeleteGoals=true 면 이관 시도 안 함 → 활성 목표도 백업 후 삭제
      transferTarget = await resolveTransferTarget(db, uid, userOrgId);
    }
    {
      const goalsSnap = await db.collection('goals').where('userId', '==', uid).get();
      const allGoals = goalsSnap.docs.map(d => ({ _id: d.id, ...d.data() } as any));
      // 활성/종료 분리
      const activeGoals = allGoals.filter(g =>
        ACTIVE_GOAL_STATUSES.has(g.status) && !g.trashedAt && !g.softDeletedAt,
      );
      const inactiveGoals = allGoals.filter(g => !activeGoals.includes(g));
      if (transferTarget && activeGoals.length > 0) {
        // ① 목표 이관 + 이력 기록 (알림과 분리 — 이관은 반드시 완료)
        const transferTasks: Promise<any>[] = [];
        for (const g of activeGoals) {
          const newRelated = Array.from(new Set([...(g.relatedOrgIds ?? []), transferTarget.targetOrgId, userOrgId]));
          transferTasks.push(db.collection('goals').doc(g._id).update({
            userId: transferTarget.targetUserId,
            organizationId: transferTarget.targetOrgId,
            relatedOrgIds: newRelated,
            previousOwnerId: uid,
            previousOwnerName: userName,
            transferredAt: FieldValue.serverTimestamp(),
            needsReassignment: true,
            updatedAt: FieldValue.serverTimestamp(),
          }));
          transferTasks.push(db.collection('goalHistories').add({
            goalId: g._id,
            changedBy: deletedBy ?? null,
            changeType: 'OWNER_TRANSFERRED',
            previousStatus: g.status,
            newStatus: g.status,
            comment: `사용자 삭제로 인한 이관: ${userName} → 수행자 재지정 대기`,
            createdAt: FieldValue.serverTimestamp(),
          }));
          transferredGoalIds.push(g._id);
        }
        await Promise.all(transferTasks);

        // ② 이관 알림: 목표 이관 완료 후 별도 발송 (실패해도 이관에 영향 없음)
        for (const g of activeGoals) {
          try {
            await db.collection('notifications').add({
              userId: transferTarget.targetUserId,
              category: 'GOAL',
              title: g.title ?? '핵심목표',
              message: `${userName}님의 삭제로 '${g.title ?? '목표'}' 핵심목표가 이관되었습니다. 수행자 재지정이 필요합니다.`,
              link: `/goals/${g._id}`,
              read: false,
              createdAt: FieldValue.serverTimestamp(),
            });
            notifSentCount++;
          } catch (notifErr) {
            console.error(`[알림] 이관 알림 발송 실패 (goalId: ${g._id}):`, notifErr);
          }
        }
        console.log(`[이관] 목표 ${transferredGoalIds.length}건 이관, 알림 ${notifSentCount}건 발송 → ${transferTarget.targetUserId}`);
        archivedGoals = inactiveGoals;
      } else {
        // 이관 대상 없음 — 활성 목표도 백업+삭제 (orphan 방지)
        archivedGoals = allGoals;
      }
    }

    // 1) historical 데이터 수집
    const snapshot = await fetchUserDocuments(db, uid);
    if (archivedGoals.length > 0) snapshot['goals'] = archivedGoals;  // 종료 goals 백업 포함
    const counts = Object.fromEntries(Object.entries(snapshot).map(([k, v]) => [k, v.length]));
    counts['goalsTransferred'] = transferredGoalIds.length;
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
      transferTarget,           // { targetUserId, targetOrgId } 또는 null
      transferredGoalCount: transferredGoalIds.length,
      notifSentCount,           // 알림 발송 건수 (0이면 발송 실패)
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

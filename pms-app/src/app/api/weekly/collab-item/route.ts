export const dynamic = 'force-dynamic';

/**
 * 공동업무(TF) 주간보고 항목 — 타팀(소유팀) 주간 문서에 작성자 본인 항목을 추가/수정/삭제.
 *
 * 배경: 주간보고는 팀(orgId) 단위 단일 문서이고, Firestore 규칙은 타팀 문서 쓰기를 막는다.
 *   다른 팀이 소유한 공동목표(collaboratorIds 에 본인 포함)의 추진내용을 본인이 적으려면
 *   이 서버 경로(admin 권한)로 소유팀 문서에 authorId=본인 항목을 기록한다.
 *
 * 인증: Authorization: Bearer <Firebase ID Token>
 * body: { targetOrgId, year, week, weekStart, weekEnd, goalId, section: 'hd'|'wd',
 *         op: 'upsert'|'delete', item?, itemId? }
 *
 * 권한: 요청자(uid)가 goalId 목표의 소유자(userId) 또는 공동수행자(collaboratorIds)여야 하고,
 *   그 목표의 organizationId === targetOrgId 여야 한다.
 *   기존 항목 수정·삭제는 그 항목의 authorId === uid 인 것만(본인이 쓴 것만).
 */

import { NextRequest, NextResponse } from 'next/server';
import { initializeApp, getApps, getApp, cert, ServiceAccount } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

function getAdminApp() {
  if (getApps().length > 0) return getApp();
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY 환경변수가 없습니다.');
  return initializeApp({ credential: cert(JSON.parse(raw) as ServiceAccount) });
}

function docId(orgId: string, year: number, week: number): string {
  return `${orgId}_${year}_W${String(week).padStart(2, '0')}`;
}

export async function POST(req: NextRequest) {
  try {
    const app = getAdminApp();
    const auth = getAuth(app);
    const db = getFirestore(app);

    const authHeader = req.headers.get('authorization') ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    let uid: string;
    try {
      uid = (await auth.verifyIdToken(token)).uid;
    } catch {
      return NextResponse.json({ error: 'invalid token' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const targetOrgId: string = body.targetOrgId;
    const year = Number(body.year);
    const week = Number(body.week);
    const goalId: string = body.goalId;
    const section: 'hd' | 'wd' = body.section === 'wd' ? 'wd' : 'hd';
    const op: 'upsert' | 'delete' = body.op === 'delete' ? 'delete' : 'upsert';
    if (!targetOrgId || !goalId || !Number.isFinite(year) || !Number.isFinite(week)) {
      return NextResponse.json({ error: 'targetOrgId·year·week·goalId 필요' }, { status: 400 });
    }

    // 권한: 목표의 소유자/공동수행자 + 목표 소유조직 === targetOrgId
    const goalSnap = await db.collection('goals').doc(goalId).get();
    const g = goalSnap.data();
    if (!goalSnap.exists || !g) return NextResponse.json({ error: 'goal not found' }, { status: 404 });
    const isParticipant = g.userId === uid || (Array.isArray(g.collaboratorIds) && g.collaboratorIds.includes(uid));
    if (!isParticipant || g.organizationId !== targetOrgId) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const field = section === 'wd' ? 'willDoItems' : 'hasDoneItems';
    const ref = db.collection('weeklyTasks').doc(docId(targetOrgId, year, week));
    const snap = await ref.get();
    const cur = snap.exists ? (snap.data() as any) : null;
    const arr: any[] = Array.isArray(cur?.[field]) ? [...cur[field]] : [];

    if (op === 'delete') {
      const itemId: string = body.itemId;
      if (!itemId) return NextResponse.json({ error: 'itemId 필요' }, { status: 400 });
      const target = arr.find(x => x.id === itemId);
      if (target && target.authorId !== uid) {
        return NextResponse.json({ error: '본인이 작성한 항목만 삭제할 수 있습니다.' }, { status: 403 });
      }
      const next = arr.filter(x => x.id !== itemId);
      await writeBack(ref, snap.exists, field, next, { targetOrgId, year, week, body });
      return NextResponse.json({ ok: true });
    }

    // upsert
    const item = body.item ?? {};
    if (!item.id) return NextResponse.json({ error: 'item.id 필요' }, { status: 400 });
    const userSnap = await db.collection('users').doc(uid).get();
    const authorName: string = userSnap.data()?.name ?? '';
    const idx = arr.findIndex(x => x.id === item.id);
    const cleaned = {
      id: item.id,
      title: typeof item.title === 'string' ? item.title : '',
      content: typeof item.content === 'string' ? item.content : '',
      goalId,                 // 항상 해당 공동목표에 연결
      authorId: uid,
      authorName,
      // 공동업무 TF 항목은 일반업무 별표 대상이 아님 — important 무시
    };
    if (idx >= 0) {
      if (arr[idx].authorId !== uid) {
        return NextResponse.json({ error: '본인이 작성한 항목만 수정할 수 있습니다.' }, { status: 403 });
      }
      arr[idx] = { ...arr[idx], ...cleaned };
    } else {
      arr.push(cleaned);
    }
    await writeBack(ref, snap.exists, field, arr, { targetOrgId, year, week, body });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('[weekly/collab-item] 실패:', e?.message, e?.stack);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

async function writeBack(
  ref: FirebaseFirestore.DocumentReference,
  exists: boolean,
  field: string,
  arr: any[],
  ctx: { targetOrgId: string; year: number; week: number; body: any },
) {
  const payload: Record<string, any> = {
    [field]: arr,
    organizationId: ctx.targetOrgId,
    teamOrgId: ctx.targetOrgId,
    year: ctx.year,
    weekNumber: ctx.week,
    updatedAt: Timestamp.now(),
  };
  // 문서가 없을 때만 주차 범위 생성(이미 있으면 보존)
  if (!exists) {
    if (ctx.body.weekStart) payload.weekStart = Timestamp.fromDate(new Date(ctx.body.weekStart));
    if (ctx.body.weekEnd) payload.weekEnd = Timestamp.fromDate(new Date(ctx.body.weekEnd));
    payload.userId = '';
  }
  await ref.set(payload, { merge: true });
}

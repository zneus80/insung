export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 임원 수만큼 AI 호출 — 여유 타임아웃

import { NextRequest, NextResponse } from 'next/server';
import { initializeApp, getApps, getApp, cert, ServiceAccount } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { GoogleGenAI } from '@google/genai';

/**
 * 임원 위클리 리포트 — 월요일 Cloud Scheduler 자동 생성 + 알림.
 * 각 임원의 산하 팀 지난주 주간업무보고를 서버 Gemini 로 요약·분석·금주방향 생성 → weeklyReports 캐시 저장 → 알림.
 * 인증: Firebase ID 토큰(HR 마스터) 또는 Cloud Scheduler OIDC. (백업 스케줄러와 동일 패턴)
 * 멱등: 같은 주차 캐시가 이미 있으면 재생성하지 않음(수동 force=true 시 재생성).
 */
function getAdminApp() {
  if (getApps().length > 0) return getApp();
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY) as ServiceAccount
    : null;
  if (!serviceAccount) throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY 환경변수가 없습니다.');
  return initializeApp({ credential: cert(serviceAccount) });
}

// ── ISO 주차 (클라이언트 모달과 동일 규칙) ──
function isoWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}
function prevWeek(year: number, week: number): { year: number; week: number } {
  if (week === 1) { const l = isoWeek(new Date(year - 1, 11, 28)); return { year: year - 1, week: l.week }; }
  return { year, week: week - 1 };
}
const taskDocId = (orgId: string, y: number, w: number) => `${orgId}_${y}_W${String(w).padStart(2, '0')}`;
const reportDocId = (execId: string, y: number, w: number) => `${execId}_${y}_W${w}`; // 클라이언트 캐시 키와 동일(패딩 없음)

function descendantOrgIds(rootId: string, orgs: any[]): string[] {
  const out = [rootId];
  for (const c of orgs.filter(o => o.parentId === rootId)) out.push(...descendantOrgIds(c.id, orgs));
  return out;
}

interface ReportTeam {
  teamName: string;
  members: Array<{ name: string; position?: string; hasDone: string[]; willDo: string[] }>;
  /** 팀 핵심목표 컨텍스트 — 실효성·KPI 달성·기한 대비 진척 판단 근거 */
  goals?: Array<{ title: string; status: string; progress: number; dueDate?: string; kpis?: string[] }>;
}

function buildPrompt(divisionName: string, year: number, week: number, teams: ReportTeam[]): string {
  return [
    '당신은 임원을 보좌하는 업무 분석가입니다. 아래 "주간업무보고 데이터(JSON)"는 임원 산하 조직의 지난주 실적/금주 계획입니다.',
    '이를 바탕으로 임원이 한눈에 파악할 수 있는 한국어 위클리 리포트를 작성하세요.',
    '반드시 아래 세 섹션을 마크다운 제목(##)으로 구성합니다:',
    '## 1. 요약 — 팀/부문별 지난주 주요 성과·진척을 핵심 위주로 압축(팀별 한두 줄).',
    '## 2. 분석 — 진행 양상, 눈에 띄는 성과, 지연·이슈·리스크, 팀 간 편차 등을 통찰 위주로.',
    '## 3. 금주 방향 — 다음 주 계획(willDo)과 위 분석을 토대로 임원이 챙겨야 할 우선순위·점검 포인트 제안.',
    '원칙: 입력 JSON을 그대로 나열하지 말고 통찰 있는 문장/목록으로 재구성. 데이터 없는 팀은 "보고 없음"으로만. 점검·제안 톤.',
    '【답변 구조 — 반드시 준수】',
    '- 서술 단위는 팀 → 업무(공동업무 단위) → 참여 개인 순으로 판단합니다. 여러 사람이 같은 업무를 수행한 경우 사람별로 반복 서술하지 말고, 업무를 기준으로 한 번만 설명하면서 "A(주도)·B·C 참여, A는 ~, B는 ~ 담당" 식으로 참여자와 역할을 묶습니다.',
    '- 개인별 나열은 그 사람 고유의 단독 업무·특이 기여가 있을 때만 사용합니다.',
    '- 각 실적/계획 항목 앞의 대괄호 태그는 그 항목이 속한 업무를 나타냅니다: "[목표명]"이면 해당 핵심목표의 실적/계획이고, "[일반]"이면 핵심목표에 속하지 않는 일반업무입니다. ★항목은 반드시 태그에 적힌 목표에만 귀속시키고, 다른 목표의 실적/계획과 절대 섞지 마세요.',
    '- 각 인원의 hasDone/willDo 는 작성자가 아니라 실제 업무 수행자(참여자) 기준으로 귀속된 것입니다. 같은 항목이 여러 사람에게 있으면 그 업무를 함께 수행한 것입니다.',
    '- "[일반]" 일반업무는 누락하지 말고 팀별로 "일반업무: ~ 등"처럼 한두 줄로 요약해 포함하세요(항목 전체 나열은 불필요). 특이사항이 있으면 분석에도 반영합니다.',
    '- teams[].goals 는 팀 핵심목표 컨텍스트(상태·진행률·추진기한·KPI)입니다. 주간 실적을 평가할 때 이 컨텍스트와 대조해 ①실적의 실효성(계획 나열이 아닌 실제 진척) ②KPI 달성 방향성 ③기한 대비 진척(기한이 많이 남은 목표의 낮은 진행률을 부진으로 단정하지 않기)을 판단하세요.',
    '- 추론 표현: 누적 데이터가 제한적이므로 직접 확인되지 않는 판단은 "현재 데이터 기준으로는 ~로 추론됩니다"처럼 추론임을 명시하고 한계를 밝히세요.',
    '【출력 형식 — 반드시 준수】',
    '- 문단은 2~4문장 단위로 나누고, 문단 사이에는 반드시 빈 줄을 넣습니다.',
    '- 목록은 각 항목을 반드시 별도의 줄에서 하이픈(-)으로 시작합니다. 한 줄에 여러 항목을 "•"나 쉼표로 이어 붙이지 마세요.',
    '- "팀명: 요약" 형태는 - **팀명**: 요약 처럼 앞을 굵게 합니다.',
    '- ⛔ 백틱(`)·코드 표기는 절대 사용하지 마세요(코드가 아닌 보고서입니다). 팀명·날짜·회의명 등 강조가 필요하면 **굵게**만 사용합니다.',
    '- 상위 항목 아래 세부는 공백 2칸 들여쓴 하위 불릿("  - 세부")으로 계층을 표현합니다(최대 2단계). 같은 깊이로 평평하게 나열하지 마세요.',
    '- 팀별·업무별 성과를 비교·나열할 때는 표(Markdown table)를 적절히 사용합니다. (예: 업무 | 참여자 | 주요 내용)',
    '- 관련된 항목은 묶고, 장황한 서론은 생략합니다.',
    '',
    `대상: ${divisionName} · ${year}년 ${week}주차`,
    '주간업무보고 데이터(JSON):',
    JSON.stringify({ divisionName, year, week, teams }),
  ].join('\n');
}

export async function POST(req: NextRequest) {
  try {
    const app = getAdminApp();
    const auth = getAuth(app);
    const db = getFirestore(app);

    // ── 인증: Firebase ID(HR마스터) 또는 Cloud Scheduler OIDC ──
    const authHeader = req.headers.get('authorization') ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    let authed = false;
    try {
      const decoded = await auth.verifyIdToken(token);
      const userData = (await db.collection('users').doc(decoded.uid).get()).data();
      if (!userData?.isHrMaster) return NextResponse.json({ error: 'forbidden: HR master required' }, { status: 403 });
      authed = true;
    } catch {
      const expectedAud = process.env.SCHEDULER_OIDC_AUDIENCE;
      const expectedEmail = process.env.SCHEDULER_SA_EMAIL;
      if (expectedAud && expectedEmail) {
        const parts = token.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
          if (payload.iss === 'https://accounts.google.com' && payload.email === expectedEmail
            && payload.aud === expectedAud && (!payload.exp || payload.exp >= Math.floor(Date.now() / 1000))) {
            authed = true;
          }
        }
      }
    }
    if (!authed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const force = body?.force === true;

    // ── 대상 주차(지난주) ──
    const nowW = isoWeek(new Date());
    const t = prevWeek(nowW.year, nowW.week);

    // ── 데이터 로드 ──
    const [orgsSnap, usersSnap, goalsSnap] = await Promise.all([
      db.collection('organizations').get(),
      db.collection('users').get(),
      db.collection('goals').where('cycleYear', '==', t.year).get(),
    ]);
    const orgs = orgsSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })).filter(o => !o.archivedAt);
    const users = usersSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
    const orgById = new Map(orgs.map(o => [o.id, o]));
    const nameById = new Map(users.map(u => [u.id, u.name]));
    const posById = new Map(users.map(u => [u.id, u.position]));
    // 팀별 핵심목표 컨텍스트 — 실효성·KPI 달성·기한 대비 진척 판단 근거 (승인 이후 상태만)
    const goalTitleById = new Map(goalsSnap.docs.map(d => [d.id, (d.data() as any).title as string]));
    // 목표 가시성 — 주간보고 화면과 동일 규칙: 완료 목표는 '완료한 주차'까지만 리포트 대상.
    const targetKey = t.year * 100 + t.week;
    const goalVisibleInWeek = (g: any) => {
      if (g.status !== 'COMPLETED') return true;
      const at = (g.completionExecApprovedAt ?? g.updatedAt)?.toDate?.();
      if (!at) return false;
      const w = isoWeek(at);
      return targetKey <= (w.year * 100 + w.week);
    };
    const goalRawById = new Map(goalsSnap.docs.map(d => [d.id, d.data() as any]));
    const GOAL_VISIBLE = new Set(['APPROVED', 'IN_PROGRESS', 'COMPLETED']);
    const goalsByOrg = new Map<string, Array<{ title: string; status: string; progress: number; dueDate?: string; kpis?: string[] }>>();
    for (const doc of goalsSnap.docs) {
      const g = doc.data() as any;
      if (!GOAL_VISIBLE.has(g.status) || g.trashedAt || g.softDeletedAt) continue;
      if (!goalVisibleInWeek(g)) continue;   // 완료 주차가 지난 목표는 컨텍스트에서도 제외
      if (!goalsByOrg.has(g.organizationId)) goalsByOrg.set(g.organizationId, []);
      goalsByOrg.get(g.organizationId)!.push({
        title: g.title,
        status: g.status === 'COMPLETED' ? '완료' : '추진중',
        progress: g.progress ?? 0,
        dueDate: g.dueDate?.toDate?.() ? g.dueDate.toDate().toISOString().slice(0, 10) : undefined,
        kpis: Array.isArray(g.kpis) ? g.kpis.slice(0, 5) : undefined,
      });
    }

    // ── Gemini (Vertex AI) — firebase-adminsdk SA 자격증명 명시 주입(aiplatform.user 부여된 계정) ──
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY!);
    const genai = new GoogleGenAI({
      vertexai: true,
      project: sa.project_id,
      location: 'us-central1',
      googleAuthOptions: { credentials: { client_email: sa.client_email, private_key: sa.private_key } },
    });

    const execs = users.filter(u => u.role === 'EXECUTIVE' && u.isActive !== false);
    const counts = { generated: 0, skipped: 0, empty: 0, failed: 0 };

    // 임원별 병렬 처리 — 임원 수가 늘어도 타임아웃 여유 확보(각자 독립 try/catch).
    await Promise.all(execs.map(async (exec) => {
      try {
        // 캐시 멱등 — 이미 있으면 스킵(force 시 재생성)
        const cacheRef = db.collection('weeklyReports').doc(reportDocId(exec.id, t.year, t.week));
        if (!force && (await cacheRef.get()).exists) { counts.skipped++; return; }

        // 스코프: 본인이 leader 인 조직들의 descendants 중 TEAM
        const ledRoots = orgs.filter(o => o.leaderId === exec.id).map(o => o.id);
        const scopeIds = [...new Set(ledRoots.flatMap(id => descendantOrgIds(id, orgs)))];
        const teamOrgIds = scopeIds.filter(id => orgById.get(id)?.type === 'TEAM');
        if (teamOrgIds.length === 0) { counts.empty++; return; }

        const taskSnaps = await Promise.all(teamOrgIds.map(id => db.collection('weeklyTasks').doc(taskDocId(id, t.year, t.week)).get()));
        const teams: ReportTeam[] = [];
        taskSnaps.forEach((snap, idx) => {
          const orgId = teamOrgIds[idx];
          const d = snap.exists ? (snap.data() as any) : null;
          // 항목을 '업무 수행자' 기준으로 귀속 — 참여인원(participantIds)이 있으면 그들에게(대표 작성 시 참여자 전원 실적),
          // 없으면 작성자(authorId)에게. 각 항목엔 소속 목표명을 태그해 AI가 실적/계획을 정확한 목표에 연결하게 한다.
          const byPerson = new Map<string, { name: string; position?: string; hasDone: string[]; willDo: string[] }>();
          const pushTo = (uid: string, fallbackName: string | undefined, text: string, kind: 'hasDone' | 'willDo') => {
            const name = nameById.get(uid) || fallbackName || '미상';
            if (!byPerson.has(uid)) byPerson.set(uid, { name, position: posById.get(uid), hasDone: [], willDo: [] });
            const v = (text || '').trim(); if (v) byPerson.get(uid)![kind].push(v);
          };
          const tag = (i: any, text: string) => {
            if (!i.goalId) return `[일반] ${text}`;
            const gt = goalTitleById.get(i.goalId);
            return gt ? `[${gt}] ${text}` : text;
          };
          const distribute = (i: any, text: string, kind: 'hasDone' | 'willDo') => {
            // 완료 주차가 지난 목표의 잔여 항목은 제외 (화면 가시성과 동일)
            if (i.goalId) {
              const g = goalRawById.get(i.goalId);
              if (g && !goalVisibleInWeek(g)) return;
            }
            const targets = (Array.isArray(i.participantIds) && i.participantIds.length > 0) ? i.participantIds : [i.authorId || 'unknown'];
            targets.forEach((uid: string) => pushTo(uid, i.authorName, tag(i, text), kind));
          };
          (d?.hasDoneItems ?? []).forEach((i: any) => distribute(i, i.title || i.content, 'hasDone'));
          (d?.willDoItems ?? []).forEach((i: any) => distribute(i, i.title || i.content, 'willDo'));
          const members = [...byPerson.values()].filter(m => m.hasDone.length || m.willDo.length);
          if (members.length) teams.push({
            teamName: orgById.get(orgId)?.name ?? '(팀)',
            members,
            goals: (goalsByOrg.get(orgId) ?? []).slice(0, 15),
          });
        });
        if (teams.length === 0) { counts.empty++; return; }

        const divisionName = orgById.get(exec.organizationId)?.name ?? '담당 조직';
        const resp = await genai.models.generateContent({
          model: 'gemini-2.5-pro',
          contents: buildPrompt(divisionName, t.year, t.week, teams),
        });
        const text = (resp.text ?? '').trim();
        if (!text) { counts.failed++; return; }

        await cacheRef.set({
          execId: exec.id, year: t.year, week: t.week, content: text,
          generatedAt: FieldValue.serverTimestamp(), generatedByName: '시스템(월요일 자동)',
          viewedAt: FieldValue.delete(),   // 새로 생성된 리포트는 미열람 — 대시보드 NEW 배지 재표시
        }, { merge: true });

        // 알림
        await db.collection('notifications').add({
          userId: exec.id,
          type: 'WEEKLY_REPORT_READY',
          category: 'WEEKLY_TASK',
          title: '위클리 리포트',
          message: `${t.year}년 ${t.week}주차 위클리 리포트가 준비되었습니다. 대시보드에서 확인하세요.`,
          link: '/dashboard',
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        });
        counts.generated++;
      } catch (e) {
        console.error(`[위클리 리포트] ${exec.name} 생성 실패:`, e);
        counts.failed++;
      }
    }));

    return NextResponse.json({ ok: true, year: t.year, week: t.week, execs: execs.length, ...counts });
  } catch (e: any) {
    console.error('[위클리 리포트 생성] 실패:', e);
    return NextResponse.json({ error: e?.message ?? 'internal error' }, { status: 500 });
  }
}

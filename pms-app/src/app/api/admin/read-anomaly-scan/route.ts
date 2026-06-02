export const dynamic = 'force-dynamic';

/**
 * 평가 데이터 대량 read 이상 탐지 스캐너.
 *
 * Firestore Data Access 감사 로그(Cloud Logging)를 최근 N분 구간으로 조회해
 * 사용자별 "평가 컬렉션 read 횟수"를 집계하고, 임계값을 넘으면 HR 마스터 전원에게
 * 앱 내 알림(notifications) + 감사 로그(auditLogs)를 남긴다.
 *
 * 한계: 단건 unfiltered 쿼리로 전체를 긁으면 로그 1줄 → 건수 기반이라 알림 미발동.
 *       그 경우에도 누가/무엇을 읽었는지는 감사 로그에 남아 사후 추적은 가능하다.
 *       실시간 차단이 필요하면 API 프록시(SECURITY_TODO 옵션 E) 적용 필요.
 *
 * 인증:
 *  - Authorization: Bearer <Firebase ID Token> (HR 마스터) — 수동 실행/테스트
 *  - Authorization: Bearer <Cloud Scheduler OIDC Token> — 주기 실행
 *
 * 테스트용 옵션 (HR 마스터 호출 시에만 허용):
 *  - ?threshold=N    임계값 임시 변경
 *  - ?windowMin=N    조회 구간(분) 임시 변경
 *  - ?dryRun=1       탐지만 하고 알림/감사로그/상태 기록을 남기지 않음
 */

import { NextRequest, NextResponse } from 'next/server';
import { initializeApp, getApps, getApp, cert, ServiceAccount } from 'firebase-admin/app';
import { getFirestore, Firestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { GoogleAuth } from 'google-auth-library';

const PROJECT_ID = process.env.GCLOUD_PROJECT_ID ?? 'insung-pms';

// 민감 컬렉션 (인사평가 데이터)
const SENSITIVE_COLLECTIONS = [
  'individualEvaluations',
  'selfEvaluations',
  'yearEndEvals',
  'mentoringForms',
];

const DEFAULT_WINDOW_MIN = 10;
const DEFAULT_THRESHOLD = Number(process.env.READ_ANOMALY_THRESHOLD ?? 300);
// 같은 사용자에 대해 이 시간(분) 내 재알림 억제 (지속 버스트 스팸 방지)
const REALERT_SUPPRESS_MIN = 60;
// 페이지네이션 상한 (1000건 × maxPages) — 50~100명 규모 10분 구간엔 충분
const MAX_PAGES = 12;

const STATE_COLLECTION = 'securityScanState';
const STATE_DOC_ID = 'readAnomaly';

function getServiceAccountJson(): ServiceAccount & { client_email: string; private_key: string } {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY 환경변수가 없습니다.');
  return JSON.parse(raw);
}

function getAdminApp() {
  if (getApps().length > 0) return getApp();
  return initializeApp({ credential: cert(getServiceAccountJson() as ServiceAccount) });
}

/** 서비스 계정으로 Cloud Logging read 액세스 토큰 발급 */
async function getLoggingAccessToken(): Promise<string> {
  const sa = getServiceAccountJson();
  const auth = new GoogleAuth({
    credentials: { client_email: sa.client_email, private_key: sa.private_key },
    scopes: ['https://www.googleapis.com/auth/logging.read'],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) throw new Error('Cloud Logging 액세스 토큰 발급 실패');
  return token.token;
}

interface ReadEntry {
  email: string;
  uid: string;
  ip: string;
  collection: string;
}

/** 최근 windowMin 분간 평가 컬렉션 read 로그 조회 (페이지네이션) */
async function fetchEvalReadEntries(token: string, windowMin: number): Promise<ReadEntry[]> {
  const sinceIso = new Date(Date.now() - windowMin * 60_000).toISOString();

  const queryClauses = SENSITIVE_COLLECTIONS
    .map(c => `protoPayload.request.addTarget.query.structuredQuery.from.collectionId="${c}"`);
  const docClauses = SENSITIVE_COLLECTIONS
    .map(c => `protoPayload.request.addTarget.documents.documents:"/${c}/"`);

  const filter = [
    `logName="projects/${PROJECT_ID}/logs/cloudaudit.googleapis.com%2Fdata_access"`,
    `protoPayload.serviceName="firestore.googleapis.com"`,
    `timestamp>="${sinceIso}"`,
    `(${[...queryClauses, ...docClauses].join(' OR ')})`,
  ].join(' AND ');

  const entries: ReadEntry[] = [];
  let pageToken: string | undefined;
  let pages = 0;

  do {
    const res = await fetch('https://logging.googleapis.com/v2/entries:list', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resourceNames: [`projects/${PROJECT_ID}`],
        filter,
        orderBy: 'timestamp desc',
        pageSize: 1000,
        pageToken,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Cloud Logging 조회 실패 (${res.status}): ${text.slice(0, 300)}`);
    }
    const data: any = await res.json();
    for (const e of data.entries ?? []) {
      const p = e.protoPayload ?? {};
      const payload = p.authenticationInfo?.thirdPartyPrincipal?.payload;
      // thirdPartyPrincipal 가 없으면 서버(Admin SDK) read → 최종 사용자 아님, 제외
      if (!payload?.email && !payload?.user_id) continue;
      // 사용된 컬렉션 식별
      let coll = '';
      const from = p.request?.addTarget?.query?.structuredQuery?.from;
      if (Array.isArray(from) && from[0]?.collectionId) coll = from[0].collectionId;
      if (!coll) {
        const docs: string[] = p.request?.addTarget?.documents?.documents ?? [];
        for (const d of docs) {
          const hit = SENSITIVE_COLLECTIONS.find(c => d.includes(`/${c}/`));
          if (hit) { coll = hit; break; }
        }
      }
      entries.push({
        email: payload.email ?? '(이메일 없음)',
        uid: payload.user_id ?? payload.sub ?? '',
        ip: p.requestMetadata?.callerIp ?? '',
        collection: coll || '(미상)',
      });
    }
    pageToken = data.nextPageToken;
    pages++;
  } while (pageToken && pages < MAX_PAGES);

  return entries;
}

interface Anomaly {
  email: string;
  uid: string;
  count: number;
  ips: string[];
  byCollection: Record<string, number>;
}

/** 전체 사용자별 집계 (내림차순 정렬) */
function aggregate(entries: ReadEntry[]): Anomaly[] {
  const map = new Map<string, Anomaly>();
  for (const e of entries) {
    const key = e.uid || e.email;
    let a = map.get(key);
    if (!a) { a = { email: e.email, uid: e.uid, count: 0, ips: [], byCollection: {} }; map.set(key, a); }
    a.count++;
    if (e.ip && !a.ips.includes(e.ip)) a.ips.push(e.ip);
    a.byCollection[e.collection] = (a.byCollection[e.collection] ?? 0) + 1;
  }
  return Array.from(map.values()).sort((x, y) => y.count - x.count);
}

async function notifyAnomaly(
  db: Firestore,
  a: Anomaly,
  windowMin: number,
  threshold: number,
): Promise<number> {
  const mastersSnap = await db.collection('users')
    .where('isHrMaster', '==', true)
    .where('isActive', '==', true)
    .get();

  const collSummary = Object.entries(a.byCollection)
    .map(([c, n]) => `${c} ${n}건`).join(', ');
  const message =
    `${a.email} 계정이 최근 ${windowMin}분간 평가 데이터를 ${a.count}건 조회했습니다 ` +
    `(임계값 ${threshold}건). 내역: ${collSummary}. IP: ${a.ips.join(', ') || '미상'}. ` +
    `정상 업무인지 확인이 필요합니다.`;

  const now = FieldValue.serverTimestamp();
  const batch = db.batch();
  let count = 0;
  for (const m of mastersSnap.docs) {
    const ref = db.collection('notifications').doc();
    batch.set(ref, {
      userId: m.id,
      type: 'SECURITY_READ_ANOMALY',
      category: 'SECURITY',
      title: '평가 데이터 대량 조회 감지',
      message,
      link: '/admin/audit-log',
      read: false,
      createdAt: now,
    });
    count++;
  }
  const auditRef = db.collection('auditLogs').doc();
  batch.set(auditRef, {
    action: 'READ_ANOMALY_DETECTED',
    actorId: a.uid || a.email,
    actorName: a.email,
    details: message,
    createdAt: now,
  });
  await batch.commit();
  return count;
}

export async function POST(req: NextRequest) {
  try {
    const app = getAdminApp();
    const auth = getAuth(app);
    const db = getFirestore(app);

    const authHeader = req.headers.get('authorization') ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    let isHrMasterCaller = false;
    let actorName = '자동 스캔 (Cloud Scheduler)';

    // Firebase ID 토큰(HR 마스터) → 실패 시 Cloud Scheduler OIDC 토큰
    try {
      const decoded = await auth.verifyIdToken(token);
      const userDoc = await db.collection('users').doc(decoded.uid).get();
      const userData = userDoc.data();
      if (!userData?.isHrMaster) {
        return NextResponse.json({ error: 'forbidden: HR master required' }, { status: 403 });
      }
      isHrMasterCaller = true;
      actorName = userData.name ?? decoded.email ?? '알 수 없음';
    } catch {
      const expectedAud = process.env.SCHEDULER_OIDC_AUDIENCE;
      const expectedEmail = process.env.SCHEDULER_SA_EMAIL;
      if (!expectedAud || !expectedEmail) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
      }
      const parts = token.split('.');
      if (parts.length !== 3) return NextResponse.json({ error: 'invalid token' }, { status: 401 });
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      if (payload.iss !== 'https://accounts.google.com') return NextResponse.json({ error: 'invalid issuer' }, { status: 401 });
      if (payload.email !== expectedEmail) return NextResponse.json({ error: 'invalid email' }, { status: 401 });
      if (payload.aud !== expectedAud) return NextResponse.json({ error: 'invalid audience' }, { status: 401 });
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return NextResponse.json({ error: 'token expired' }, { status: 401 });
    }

    // 테스트용 파라미터는 HR 마스터 수동 호출에서만 허용
    const url = new URL(req.url);
    const windowMin = isHrMasterCaller && url.searchParams.get('windowMin')
      ? Math.max(1, Math.min(60, Number(url.searchParams.get('windowMin'))))
      : DEFAULT_WINDOW_MIN;
    const threshold = isHrMasterCaller && url.searchParams.get('threshold')
      ? Math.max(1, Number(url.searchParams.get('threshold')))
      : DEFAULT_THRESHOLD;
    // report=1: 현황 조회 전용 — 알림/감사로그/상태 기록을 남기지 않음 (수동 '지금 스캔')
    const report = isHrMasterCaller && url.searchParams.get('report') === '1';
    const dryRun = report || (isHrMasterCaller && url.searchParams.get('dryRun') === '1');

    // 1) 로그 조회
    const logToken = await getLoggingAccessToken();
    const entries = await fetchEvalReadEntries(logToken, windowMin);

    // 2) 사용자별 집계 → 임계 초과 탐지
    const allUsers = aggregate(entries);
    const anomalies = allUsers.filter(a => a.count >= threshold);

    // 3) 재알림 억제 상태 로드
    const stateRef = db.collection(STATE_COLLECTION).doc(STATE_DOC_ID);
    const stateSnap = await stateRef.get();
    const lastAlerted: Record<string, string> = (stateSnap.data()?.lastAlerted ?? {}) as Record<string, string>;
    const nowMs = Date.now();

    const alerted: Array<{ email: string; count: number; notified: number }> = [];
    const suppressed: string[] = [];

    for (const a of anomalies) {
      const key = a.uid || a.email;
      const prev = lastAlerted[key] ? Date.parse(lastAlerted[key]) : 0;
      if (prev && nowMs - prev < REALERT_SUPPRESS_MIN * 60_000) {
        suppressed.push(a.email);
        continue;
      }
      if (!dryRun) {
        const notified = await notifyAnomaly(db, a, windowMin, threshold);
        lastAlerted[key] = new Date(nowMs).toISOString();
        alerted.push({ email: a.email, count: a.count, notified });
      } else {
        alerted.push({ email: a.email, count: a.count, notified: 0 });
      }
    }

    if (!dryRun && alerted.length > 0) {
      await stateRef.set({ lastAlerted, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }

    return NextResponse.json({
      ok: true,
      windowMin,
      threshold,
      dryRun,
      report,
      scannedEntries: entries.length,
      anomalyCount: anomalies.length,
      anomalies: anomalies.map(a => ({ email: a.email, count: a.count, ips: a.ips, byCollection: a.byCollection })),
      // 수동 스캔/현황 표시용 — 임계 무관 상위 사용자 (최대 50명)
      topUsers: allUsers.slice(0, 50).map(a => ({ email: a.email, count: a.count, ips: a.ips, byCollection: a.byCollection })),
      alerted,
      suppressed,
      actorName,
    });
  } catch (e: any) {
    console.error('[read-anomaly-scan] failed:', e?.message, e?.stack);
    return NextResponse.json({ error: e?.message ?? 'failed' }, { status: 500 });
  }
}

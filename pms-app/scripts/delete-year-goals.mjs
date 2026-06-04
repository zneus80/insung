/**
 * 특정 연도(cycleYear) 핵심목표 일괄 삭제 — 일회성 admin SDK 스크립트.
 *
 * 조직 전체의 해당 연도 goals 문서 + 연관 progressUpdates·goalHistories 를 완전 삭제한다.
 * ⚠️ 비가역. 실행 전 반드시 관리자 화면 '데이터 백업' 으로 스냅샷을 저장할 것.
 *
 * 실행:
 *   node scripts/delete-year-goals.mjs            # DRY-RUN (건수만 출력, 삭제 안 함)
 *   node scripts/delete-year-goals.mjs --year=2026
 *   node scripts/delete-year-goals.mjs --year=2026 --confirm   # 실제 삭제
 *
 * 필요: .env.local 의 FIREBASE_SERVICE_ACCOUNT_KEY
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

// .env.local 로드
const envText = readFileSync('.env.local', 'utf8');
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.+)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const args = process.argv.slice(2);
const yearArg = args.find(a => a.startsWith('--year='));
const YEAR = yearArg ? Number(yearArg.split('=')[1]) : 2026;
const CONFIRM = args.includes('--confirm');

if (!Number.isInteger(YEAR)) { console.error('잘못된 연도:', YEAR); process.exit(1); }

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
initializeApp({ credential: cert(sa) });
const db = getFirestore();

console.log(`\n=== ${YEAR}년 핵심목표 ${CONFIRM ? '삭제' : 'DRY-RUN'} ===\n`);

// 1) 대상 goals 조회
const goalsSnap = await db.collection('goals').where('cycleYear', '==', YEAR).get();
const goals = goalsSnap.docs;
console.log(`[goals] cycleYear=${YEAR} 문서: ${goals.length}건`);

// 상태/사용자 분포
const byStatus = {};
const users = new Set();
for (const d of goals) {
  const x = d.data();
  byStatus[x.status ?? '(none)'] = (byStatus[x.status ?? '(none)'] ?? 0) + 1;
  if (x.userId) users.add(x.userId);
}
console.log('  상태별:', byStatus);
console.log(`  작성자 수: ${users.size}명`);

// 2) 연관 데이터 수집 (goalId 기준)
const goalIds = goals.map(d => d.id);
let progressCount = 0, historyCount = 0;
const progressRefs = [];
const historyRefs = [];
for (const gid of goalIds) {
  const [pu, gh] = await Promise.all([
    db.collection('progressUpdates').where('goalId', '==', gid).get(),
    db.collection('goalHistories').where('goalId', '==', gid).get(),
  ]);
  progressCount += pu.size; pu.docs.forEach(d => progressRefs.push(d.ref));
  historyCount += gh.size; gh.docs.forEach(d => historyRefs.push(d.ref));
}
console.log(`[progressUpdates] 연관: ${progressCount}건`);
console.log(`[goalHistories]   연관: ${historyCount}건`);
console.log(`\n총 삭제 예정: goals ${goals.length} + progressUpdates ${progressCount} + goalHistories ${historyCount} = ${goals.length + progressCount + historyCount}건`);

if (!CONFIRM) {
  console.log('\n※ DRY-RUN 입니다. 실제 삭제하려면 --confirm 을 붙여 다시 실행하세요.');
  console.log('  예: node scripts/delete-year-goals.mjs --year=' + YEAR + ' --confirm\n');
  process.exit(0);
}

// 3) 실제 삭제 (배치 ≤ 400)
const allRefs = [...goals.map(d => d.ref), ...progressRefs, ...historyRefs];
console.log(`\n삭제 시작 — 총 ${allRefs.length}건...`);
let deleted = 0;
for (let i = 0; i < allRefs.length; i += 400) {
  const batch = db.batch();
  for (const ref of allRefs.slice(i, i + 400)) batch.delete(ref);
  await batch.commit();
  deleted += Math.min(400, allRefs.length - i);
  console.log(`  ${deleted}/${allRefs.length} 삭제됨`);
}
console.log(`\n✓ 완료 — ${YEAR}년 핵심목표 및 연관 데이터 ${deleted}건 삭제.\n`);
process.exit(0);

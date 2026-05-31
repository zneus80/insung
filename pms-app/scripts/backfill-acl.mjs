/**
 * 가시성 ACL 백필 — 일회성 admin SDK 스크립트 (v0.9.1)
 *
 * 4개 평가 컬렉션의 모든 doc 에 viewableBy 필드를 추가.
 * 이미 viewableBy 가 있으면 스킵 (idempotent).
 *
 * 실행: node scripts/backfill-acl.mjs
 * 필요: .env.local 의 FIREBASE_SERVICE_ACCOUNT_KEY
 */
import 'dotenv/config';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

// .env.local 로드
const envText = readFileSync('.env.local', 'utf8');
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.+)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
initializeApp({ credential: cert(sa) });
const db = getFirestore();

const COLLECTIONS = ['individualEvaluations', 'selfEvaluations', 'yearEndEvals', 'mentoringForms'];

// 전체 조직 1회 로드
console.log('[1/3] 조직 트리 로드...');
const orgsSnap = await db.collection('organizations').get();
const orgsById = new Map();
orgsSnap.docs.forEach(d => {
  const data = d.data();
  orgsById.set(d.id, { parentId: data.parentId ?? null, leaderId: data.leaderId ?? null });
});
console.log(`  → ${orgsById.size}개 조직`);

// 사용자 캐시
console.log('[2/3] 사용자 organizationId 캐시 로드...');
const usersSnap = await db.collection('users').get();
const userOrgById = new Map();
usersSnap.docs.forEach(d => userOrgById.set(d.id, d.data().organizationId ?? null));
console.log(`  → ${userOrgById.size}명 사용자`);

function computeViewableBy(userId, organizationId) {
  const viewers = new Set([userId]);
  if (!organizationId) return [...viewers];
  const visited = new Set();
  let cur = organizationId;
  while (cur && !visited.has(cur)) {
    visited.add(cur);
    const org = orgsById.get(cur);
    if (!org) break;
    if (org.leaderId) viewers.add(org.leaderId);
    cur = org.parentId;
  }
  return [...viewers];
}

console.log('[3/3] 4개 컬렉션 백필...');
const totals = { total: 0, skip: 0, updated: 0, failed: 0 };

for (const collName of COLLECTIONS) {
  const snap = await db.collection(collName).get();
  const stat = { total: snap.size, skip: 0, updated: 0, failed: 0 };
  const batch = [];
  for (const d of snap.docs) {
    const data = d.data();
    if (Array.isArray(data.viewableBy) && data.viewableBy.length > 0) {
      stat.skip++;
      continue;
    }
    const userId = data.userId;
    if (!userId) {
      stat.failed++;
      console.warn(`  ⚠ ${collName}/${d.id}: userId 누락`);
      continue;
    }
    const orgId = data.organizationId ?? userOrgById.get(userId) ?? null;
    const viewableBy = orgId ? computeViewableBy(userId, orgId) : [userId];
    batch.push(d.ref.update({ viewableBy }));
    stat.updated++;
  }
  // 병렬 실행 (Firestore admin SDK 알아서 throttle)
  await Promise.all(batch);
  console.log(`  ${collName.padEnd(22)} 전체 ${stat.total} / 스킵 ${stat.skip} / 갱신 ${stat.updated} / 실패 ${stat.failed}`);
  totals.total += stat.total;
  totals.skip += stat.skip;
  totals.updated += stat.updated;
  totals.failed += stat.failed;
}

console.log('\n✅ 완료');
console.log(`총 ${totals.total}개 / 스킵 ${totals.skip} / 갱신 ${totals.updated} / 실패 ${totals.failed}`);

// 감사 로그
await db.collection('auditLogs').add({
  action: 'BACKUP_RESTORE',  // 가장 가까운 분류
  actorId: 'system',
  actorName: '시스템 (admin script)',
  details: `viewableBy 백필 자동 실행 — 갱신 ${totals.updated}건 / 실패 ${totals.failed}건`,
  createdAt: new Date(),
});

process.exit(0);

/**
 * 가시성 ACL (viewableBy) 보안 검증 테스트 — v0.9.1
 *
 * 두 가지를 한꺼번에 검증:
 *  1. computeViewableBy 로직 — 조직 트리 따라 본인 + 상위 리더 ID 산출이 올바른가
 *  2. Firestore 보안 규칙 — viewableBy 안에 없는 사용자가 평가 doc 을 읽으면 거부되는가
 *
 * 실행:
 *   firebase emulators:start --only firestore --project demo-pms (별도 터미널)
 *   npx vitest run tests/security-acl.test.mjs
 */
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { setDoc, doc, getDoc, getDocs, collection } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { describe, it, beforeAll, afterAll, expect } from 'vitest';

const PROJECT_ID = 'demo-pms-acl';
let env;

const ORGS = [
  { id: 'org-company', name: '회사', type: 'COMPANY', parentId: null, leaderId: null },
  { id: 'org-div',     name: '영업부문', type: 'DIVISION', parentId: 'org-company', leaderId: 'u-div-head' },
  { id: 'org-hq',      name: '마케팅본부', type: 'HEADQUARTERS', parentId: 'org-div', leaderId: 'u-hq-head' },
  { id: 'org-team',    name: '디지털팀', type: 'TEAM', parentId: 'org-hq', leaderId: 'u-team-lead' },
];

const USERS = [
  { id: 'u-member',    name: '김팀원',   role: 'MEMBER',    organizationId: 'org-team', isActive: true },
  { id: 'u-team-lead', name: '박팀장',   role: 'TEAM_LEAD', organizationId: 'org-team', isActive: true },
  { id: 'u-hq-head',   name: '이본부장', role: 'TEAM_LEAD', organizationId: 'org-hq',   isActive: true },
  { id: 'u-div-head',  name: '최부문장', role: 'EXECUTIVE', organizationId: 'org-div',  isActive: true },
  { id: 'u-other',     name: '남영업',   role: 'TEAM_LEAD', organizationId: 'org-other-team', isActive: true },
  { id: 'u-ceo',       name: '강대표',   role: 'CEO',       organizationId: 'org-company', isActive: true },
  { id: 'u-hr-admin',  name: '정HR',     role: 'MEMBER',    organizationId: 'org-team', isActive: true, isHrAdmin: true },     // HR관리자(팀원 role) — 본인 조직 viewableBy 안에 있음
  { id: 'u-hr-admin-other', name: '한HR',  role: 'MEMBER', organizationId: 'org-other-team', isActive: true, isHrAdmin: true }, // HR관리자(무관 조직) — viewableBy 에 없음 → 거부 검증용
  { id: 'u-hr-master', name: '윤마스터', role: 'MEMBER',    organizationId: 'org-team', isActive: true, isHrAdmin: true, isHrMaster: true },
];

function computeViewableBy(userId, organizationId, orgsArr) {
  const viewers = new Set([userId]);
  const byId = new Map(orgsArr.map(o => [o.id, o]));
  const visited = new Set();
  let cur = organizationId;
  while (cur && !visited.has(cur)) {
    visited.add(cur);
    const org = byId.get(cur);
    if (!org) break;
    if (org.leaderId) viewers.add(org.leaderId);
    cur = org.parentId;
  }
  return [...viewers];
}

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync('firestore.rules.v0.9.1.draft', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });

  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const o of ORGS) await setDoc(doc(db, 'organizations', o.id), o);
    for (const u of USERS) await setDoc(doc(db, 'users', u.id), u);

    const memberViewers = computeViewableBy('u-member', 'org-team', ORGS);
    await setDoc(doc(db, 'individualEvaluations', 'ie-member-2025'), {
      userId: 'u-member',
      organizationId: 'org-team',
      cycleYear: 2025,
      execGrade: 'A',
      execComment: '비밀 평가의견',
      viewableBy: memberViewers,
    });
    await setDoc(doc(db, 'selfEvaluations', 'u-member_2025'), {
      userId: 'u-member',
      cycleYear: 2025,
      viewableBy: memberViewers,
    });
    // legacy (viewableBy 없는 doc)
    await setDoc(doc(db, 'individualEvaluations', 'ie-legacy'), {
      userId: 'u-member',
      organizationId: 'org-team',
      cycleYear: 2024,
      execGrade: 'B',
    });
    // 육성면담서 — HR관리자 운영 흐름 검증용
    await setDoc(doc(db, 'mentoringForms', 'u-member_2025'), {
      userId: 'u-member',
      organizationId: 'org-team',
      cycleYear: 2025,
      viewableBy: memberViewers,
    });
  });
}, 30000);

afterAll(async () => {
  if (env) await env.cleanup();
});

describe('1. computeViewableBy 로직', () => {
  it('팀원: 본인 + 팀장 + 본부장 + 부문장', () => {
    expect(computeViewableBy('u-member', 'org-team', ORGS).sort()).toEqual(
      ['u-div-head', 'u-hq-head', 'u-member', 'u-team-lead'].sort()
    );
  });
  it('팀장 본인: 본인(=팀장) + 본부장 + 부문장', () => {
    expect(computeViewableBy('u-team-lead', 'org-team', ORGS).sort()).toEqual(
      ['u-div-head', 'u-hq-head', 'u-team-lead'].sort()
    );
  });
  it('부문장 본인: 본인만', () => {
    expect(computeViewableBy('u-div-head', 'org-div', ORGS).sort()).toEqual(['u-div-head']);
  });
  it('순환 참조 안전', () => {
    const cyclic = [
      { id: 'A', parentId: 'B', leaderId: 'u-a' },
      { id: 'B', parentId: 'A', leaderId: 'u-b' },
    ];
    expect(computeViewableBy('u-x', 'A', cyclic).sort()).toEqual(['u-a', 'u-b', 'u-x'].sort());
  });
  it('organizationId 없음: 본인만', () => {
    expect(computeViewableBy('u-x', null, ORGS)).toEqual(['u-x']);
  });
});

describe('2. Firestore 규칙 — individualEvaluations', () => {
  it('✅ 본인 read 가능', async () => {
    await assertSucceeds(getDoc(doc(env.authenticatedContext('u-member').firestore(), 'individualEvaluations', 'ie-member-2025')));
  });
  it('✅ 팀장 read 가능 (viewableBy 포함)', async () => {
    await assertSucceeds(getDoc(doc(env.authenticatedContext('u-team-lead').firestore(), 'individualEvaluations', 'ie-member-2025')));
  });
  it('✅ 본부장 read 가능 (조직트리 상위)', async () => {
    await assertSucceeds(getDoc(doc(env.authenticatedContext('u-hq-head').firestore(), 'individualEvaluations', 'ie-member-2025')));
  });
  it('✅ 부문장 read 가능 (최상위)', async () => {
    await assertSucceeds(getDoc(doc(env.authenticatedContext('u-div-head').firestore(), 'individualEvaluations', 'ie-member-2025')));
  });
  it('🛑 무관한 다른 팀장 read 거부', async () => {
    await assertFails(getDoc(doc(env.authenticatedContext('u-other').firestore(), 'individualEvaluations', 'ie-member-2025')));
  });
  it('✅ CEO read 가능', async () => {
    await assertSucceeds(getDoc(doc(env.authenticatedContext('u-ceo').firestore(), 'individualEvaluations', 'ie-member-2025')));
  });
  it('🛑 HR관리자(같은 조직 팀원 role): 다른 사람 평가 read 거부 (해석 A — 본인 role 에 맞춰서)', async () => {
    // HR관리자 라도 본인 role(팀원)에 해당하는 viewableBy 범위 외 평가는 차단
    await assertFails(getDoc(doc(env.authenticatedContext('u-hr-admin').firestore(), 'individualEvaluations', 'ie-member-2025')));
  });
  it('🛑 HR관리자(무관 조직): 평가 read 거부', async () => {
    await assertFails(getDoc(doc(env.authenticatedContext('u-hr-admin-other').firestore(), 'individualEvaluations', 'ie-member-2025')));
  });
  it('✅ HR마스터: 평가 read 가능 (전체 권한)', async () => {
    await assertSucceeds(getDoc(doc(env.authenticatedContext('u-hr-master').firestore(), 'individualEvaluations', 'ie-member-2025')));
  });
  it('🛑 무관 사용자: 컬렉션 listing 우회 시도 거부', async () => {
    await assertFails(getDocs(collection(env.authenticatedContext('u-other').firestore(), 'individualEvaluations')));
  });
  it('🛑 비인증 read 거부', async () => {
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'individualEvaluations', 'ie-member-2025')));
  });
});

describe('3. selfEvaluations (docId 패턴 + viewableBy)', () => {
  it('✅ 본인 read', async () => {
    await assertSucceeds(getDoc(doc(env.authenticatedContext('u-member').firestore(), 'selfEvaluations', 'u-member_2025')));
  });
  it('✅ 팀장 read (viewableBy)', async () => {
    await assertSucceeds(getDoc(doc(env.authenticatedContext('u-team-lead').firestore(), 'selfEvaluations', 'u-member_2025')));
  });
  it('🛑 다른 팀장 read 거부', async () => {
    await assertFails(getDoc(doc(env.authenticatedContext('u-other').firestore(), 'selfEvaluations', 'u-member_2025')));
  });
});

describe('3-B. mentoringForms (HR관리자 예외 운영 흐름)', () => {
  it('✅ 본인 read', async () => {
    await assertSucceeds(getDoc(doc(env.authenticatedContext('u-member').firestore(), 'mentoringForms', 'u-member_2025')));
  });
  it('✅ 팀장 read (viewableBy)', async () => {
    await assertSucceeds(getDoc(doc(env.authenticatedContext('u-team-lead').firestore(), 'mentoringForms', 'u-member_2025')));
  });
  it('🛑 다른 팀장 read 거부', async () => {
    await assertFails(getDoc(doc(env.authenticatedContext('u-other').firestore(), 'mentoringForms', 'u-member_2025')));
  });
  it('✅ HR관리자 read 가능 (육성면담서 예외 — 수정요청 처리 등)', async () => {
    await assertSucceeds(getDoc(doc(env.authenticatedContext('u-hr-admin-other').firestore(), 'mentoringForms', 'u-member_2025')));
  });
  it('✅ HR마스터 read', async () => {
    await assertSucceeds(getDoc(doc(env.authenticatedContext('u-hr-master').firestore(), 'mentoringForms', 'u-member_2025')));
  });
});

describe('4. legacy doc (viewableBy 없음) — 백필 강제 검증', () => {
  it('✅ 본인은 viewableBy 없어도 read 가능 (소유자 fallback)', async () => {
    await assertSucceeds(getDoc(doc(env.authenticatedContext('u-member').firestore(), 'individualEvaluations', 'ie-legacy')));
  });
  it('🛑 팀장이라도 viewableBy 없는 legacy doc read 거부 (백필 강제)', async () => {
    await assertFails(getDoc(doc(env.authenticatedContext('u-team-lead').firestore(), 'individualEvaluations', 'ie-legacy')));
  });
  it('✅ HR마스터는 legacy doc 도 read 가능', async () => {
    await assertSucceeds(getDoc(doc(env.authenticatedContext('u-hr-master').firestore(), 'individualEvaluations', 'ie-legacy')));
  });
});

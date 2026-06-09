/**
 * Firestore 컬렉션/문서 헬퍼
 * 모든 DB 접근은 이 파일을 통해 이루어진다.
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
  Timestamp,
  arrayUnion,
  onSnapshot,
  QueryConstraint,
  DocumentData,
} from 'firebase/firestore';
import { db, auth } from './firebase';
import { USE_EVAL_READ_PROXY } from './feature-flags';
import type { User, Organization, Goal, GoalHistory, ProgressUpdate, OneOnOne, OneOnOneQuestion, OrganizationEvaluation, IndividualEvaluation, IndividualEvalStatus, SelfEvaluation, SelfEvalGoalEntry, EvaluationCycle, Mileage, AnnualGoal, Invitation, OrgGradeHistory, DivisionGradeQuota, EvaluationGrade, YearEndEval, MentoringForm, Announcement, Award, AppNotification, WeeklyTask, WeeklyTaskItem, LeadCommentEntry, SimpleTaskItem, InnovationActivity, WeightChangeRequest } from '@/types';

// ─── Collection 이름 상수 ─────────────────────
export const COLLECTIONS = {
  USERS: 'users',
  ORGANIZATIONS: 'organizations',
  GOALS: 'goals',
  GOAL_HISTORIES: 'goalHistories',
  PROGRESS_UPDATES: 'progressUpdates',
  ONE_ON_ONES: 'oneOnOnes',
  ORG_EVALUATIONS: 'orgEvaluations',
  INDIVIDUAL_EVALUATIONS: 'individualEvaluations',
  EVALUATION_CYCLES: 'evaluationCycles',
  GRADE_QUOTAS: 'gradeQuotas',
  MILEAGES: 'mileages',
  ANNUAL_GOALS: 'annualGoals',
  ONE_ON_ONE_QUESTIONS: 'questions',  // oneOnOnes/{id}/questions 서브컬렉션
  INVITATIONS: 'invitations',
  ORG_GRADE_HISTORIES: 'orgGradeHistories',
  DIVISION_GRADE_QUOTAS: 'divisionGradeQuotas',
  SELF_EVALUATIONS: 'selfEvaluations',
  YEAR_END_EVALS: 'yearEndEvals',
  MENTORING_FORMS: 'mentoringForms',
  ANNOUNCEMENTS: 'announcements',
  AUDIT_LOGS: 'auditLogs',
  AWARDS: 'awards',
  SYSTEM_SETTINGS: 'systemSettings',
  BACKUPS: 'backups',
  NOTIFICATIONS: 'notifications',
  WEEKLY_TASKS: 'weeklyTasks',
  INNOVATION_ACTIVITIES: 'innovationActivities',
} as const;

// ─── Timestamp 변환 유틸 ──────────────────────
export function fromTimestamp(ts: Timestamp | undefined): Date | undefined {
  return ts?.toDate();
}

// ─── 사용자 ───────────────────────────────────
export async function getUser(uid: string): Promise<User | null> {
  const snap = await getDoc(doc(db, COLLECTIONS.USERS, uid));
  if (!snap.exists()) return null;
  const data = snap.data();
  return {
    ...data,
    id: snap.id,
    passwordChangedAt: fromTimestamp(data.passwordChangedAt),
    createdAt: fromTimestamp(data.createdAt) ?? new Date(),
    updatedAt: fromTimestamp(data.updatedAt) ?? new Date(),
  } as User;
}

export async function createUser(uid: string, data: Omit<User, 'id' | 'createdAt' | 'updatedAt'>) {
  const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
  await setDoc(doc(db, COLLECTIONS.USERS, uid), {
    ...clean,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateUser(uid: string, data: Partial<User>) {
  // v0.9.1: organizationId 변경 감지 → 본인 평가 4종 viewableBy 재계산
  let needAclRecompute = false;
  if (data.organizationId !== undefined) {
    const prevSnap = await getDoc(doc(db, COLLECTIONS.USERS, uid));
    if (prevSnap.exists()) {
      const prev = prevSnap.data();
      if (data.organizationId !== prev.organizationId) needAclRecompute = true;
    }
  }
  await updateDoc(doc(db, COLLECTIONS.USERS, uid), {
    ...data,
    updatedAt: serverTimestamp(),
  });
  if (needAclRecompute) {
    // user 도큐가 갱신된 후 호출해야 새 organizationId 가 반영됨
    recomputeViewableByForUser(uid).catch(err => {
      console.warn('[updateUser] viewableBy 재계산 실패:', err);
    });
  }
}

export async function updateUserProfile(userId: string, data: { position?: string; hireDate?: string; rank?: string }) {
  await updateDoc(doc(db, COLLECTIONS.USERS, userId), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteUser(uid: string) {
  await deleteDoc(doc(db, COLLECTIONS.USERS, uid));
}

export async function getUsersByOrganization(orgId: string): Promise<User[]> {
  const q = query(
    collection(db, COLLECTIONS.USERS),
    where('organizationId', '==', orgId),
    where('isActive', '==', true)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({
    ...d.data(),
    id: d.id,
    createdAt: fromTimestamp(d.data().createdAt) ?? new Date(),
    updatedAt: fromTimestamp(d.data().updatedAt) ?? new Date(),
  } as User));
}

export async function getAllUsers(): Promise<User[]> {
  const snap = await getDocs(collection(db, COLLECTIONS.USERS));
  return snap.docs.map(d => ({
    ...d.data(),
    id: d.id,
    createdAt: fromTimestamp(d.data().createdAt) ?? new Date(),
    updatedAt: fromTimestamp(d.data().updatedAt) ?? new Date(),
  } as User));
}

// ─── 조직 ─────────────────────────────────────
export async function getOrganizations(): Promise<Organization[]> {
  const snap = await getDocs(collection(db, COLLECTIONS.ORGANIZATIONS));
  return snap.docs.map(d => ({
    ...d.data(),
    id: d.id,
    archivedAt: fromTimestamp(d.data().archivedAt) ?? null,
    createdAt: fromTimestamp(d.data().createdAt) ?? new Date(),
    updatedAt: fromTimestamp(d.data().updatedAt) ?? new Date(),
  } as Organization));
}

/** 활성 조직만 (보관/아카이브 제외) — 조직 선택·배정·트리 관리에서 사용. */
export async function getActiveOrganizations(): Promise<Organization[]> {
  return (await getOrganizations()).filter(o => !o.archivedAt);
}

export async function createOrganization(data: Omit<Organization, 'id' | 'createdAt' | 'updatedAt'>) {
  const ref = await addDoc(collection(db, COLLECTIONS.ORGANIZATIONS), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateOrganization(id: string, data: Partial<Organization>) {
  // v0.9.1: leader/parent 변경 감지 → 영향받는 평가 viewableBy 재계산
  let needAclRecompute = false;
  if (data.leaderId !== undefined || data.parentId !== undefined) {
    const prevSnap = await getDoc(doc(db, COLLECTIONS.ORGANIZATIONS, id));
    if (prevSnap.exists()) {
      const prev = prevSnap.data();
      if (data.leaderId !== undefined && data.leaderId !== (prev.leaderId ?? null)) needAclRecompute = true;
      if (data.parentId !== undefined && data.parentId !== (prev.parentId ?? null)) needAclRecompute = true;
    }
  }
  await updateDoc(doc(db, COLLECTIONS.ORGANIZATIONS, id), {
    ...data,
    updatedAt: serverTimestamp(),
  });
  if (needAclRecompute) {
    // 영향 범위: 해당 조직 + 산하 모든 조직 사용자들의 모든 평가
    // 비동기 백그라운드로 실행 (UI 블로킹 방지). 에러는 콘솔 경고만.
    recomputeViewableByForOrgTree(id).catch(err => {
      console.warn('[updateOrganization] viewableBy 재계산 실패:', err);
    });
  }
}

export async function deleteOrganization(id: string) {
  // 서버측 안전 가드 — 소속 사용자/하위 조직이 남아 있으면 삭제 거부 (고아 데이터 방지).
  // UI 단 검사 우회(스크립트·직접 호출) 시에도 최소한의 무결성 보장.
  const [usersSnap, childSnap] = await Promise.all([
    getDocs(query(collection(db, COLLECTIONS.USERS), where('organizationId', '==', id))),
    getDocs(query(collection(db, COLLECTIONS.ORGANIZATIONS), where('parentId', '==', id))),
  ]);
  if (!usersSnap.empty) {
    throw new Error(`조직 삭제 불가: 소속 사용자 ${usersSnap.size}명이 남아 있습니다. 먼저 이동/삭제하세요.`);
  }
  if (!childSnap.empty) {
    throw new Error(`조직 삭제 불가: 하위 조직 ${childSnap.size}개가 남아 있습니다. 먼저 정리하세요.`);
  }
  // 과거 연도 데이터(목표·평가 등)가 이 조직을 참조하면 doc 을 삭제하지 않고 보관(soft-archive).
  // → 과거 화면에서 조직명이 깨지지 않도록 이름 해석용으로 doc 을 보존. (연도 무관 트리, 경량 보정안)
  const refs = await countOrgReferences(id);
  const historicalRefs = refs.goals + refs.weeklyTasks + refs.annualGoals + refs.orgEvaluations
    + refs.individualEvals + refs.selfEvals + refs.mentoringForms + refs.yearEndEvals
    + refs.oneOnOnes + refs.orgGradeHistories + refs.divisionGradeQuotas;
  if (historicalRefs > 0) {
    await updateDoc(doc(db, COLLECTIONS.ORGANIZATIONS, id), {
      archivedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return { archived: true, references: historicalRefs };
  }
  // 참조가 전혀 없는 빈 조직만 완전 삭제
  await deleteDoc(doc(db, COLLECTIONS.ORGANIZATIONS, id));
  return { archived: false, references: 0 };
}

/**
 * 조직 삭제 전 영향 받는 데이터 카운트 확인용 (v0.75 B14).
 * goals / weeklyTasks / annualGoals / organizationEvaluations 에서
 * 해당 organizationId 를 참조하는 문서 수를 한 번에 조회.
 */
export async function countOrgReferences(orgId: string): Promise<{
  goals: number;
  weeklyTasks: number;
  annualGoals: number;
  orgEvaluations: number;
  users: number;            // 이 조직 소속 사용자 (가장 치명적 — 0 이어야 삭제 안전)
  childOrgs: number;        // 이 조직을 parent 로 하는 하위 조직
  individualEvals: number;
  selfEvals: number;
  mentoringForms: number;
  yearEndEvals: number;
  oneOnOnes: number;
  orgGradeHistories: number;
  divisionGradeQuotas: number;
}> {
  // 컬렉션별 권한 규칙이 달라(예: oneOnOnes 는 당사자만 list 가능) 일부 쿼리가
  // permission-denied 로 거부될 수 있다. 한 컬렉션이 막혀도 전체 카운트가 실패하지 않도록
  // 쿼리별로 안전하게 size 를 집계(거부/오류 시 0). 조직 삭제 가드는 users/childOrgs 가 핵심.
  const safeCount = async (col: string): Promise<number> => {
    try {
      const field = col === COLLECTIONS.ORGANIZATIONS ? 'parentId' : 'organizationId';
      return (await getDocs(query(collection(db, col), where(field, '==', orgId)))).size;
    } catch {
      return 0;
    }
  };
  const [goals, weeklyTasks, annualGoals, orgEvaluations, users, childOrgs,
         individualEvals, selfEvals, mentoringForms, yearEndEvals, oneOnOnes,
         orgGradeHistories, divisionGradeQuotas] = await Promise.all([
    safeCount(COLLECTIONS.GOALS),
    safeCount(COLLECTIONS.WEEKLY_TASKS),
    safeCount(COLLECTIONS.ANNUAL_GOALS),
    safeCount(COLLECTIONS.ORG_EVALUATIONS),
    safeCount(COLLECTIONS.USERS),
    safeCount(COLLECTIONS.ORGANIZATIONS),
    safeCount(COLLECTIONS.INDIVIDUAL_EVALUATIONS),
    safeCount(COLLECTIONS.SELF_EVALUATIONS),
    safeCount(COLLECTIONS.MENTORING_FORMS),
    safeCount(COLLECTIONS.YEAR_END_EVALS),
    safeCount(COLLECTIONS.ONE_ON_ONES),
    safeCount(COLLECTIONS.ORG_GRADE_HISTORIES),
    safeCount(COLLECTIONS.DIVISION_GRADE_QUOTAS),
  ]);
  return {
    goals,
    weeklyTasks,
    annualGoals,
    orgEvaluations,
    users,
    childOrgs,
    individualEvals,
    selfEvals,
    mentoringForms,
    yearEndEvals,
    oneOnOnes,
    orgGradeHistories,
    divisionGradeQuotas,
  };
}

/**
 * 특정 조직의 모든 목표를 포기 확정 + 휴지통 이동 처리 (v0.75 B14)
 * 조직 변경 시 옵션 "예"를 선택했을 때 사용.
 */
export async function abandonGoalsForOrg(orgId: string, approvedBy: string): Promise<number> {
  const snap = await getDocs(query(collection(db, COLLECTIONS.GOALS), where('organizationId', '==', orgId)));
  const now = new Date();
  let processed = 0;
  await Promise.all(snap.docs.map(async d => {
    const data = d.data();
    if (data.status === 'ABANDONED' && data.trashedAt) return;
    await updateDoc(d.ref, {
      status: 'ABANDONED',
      approvedBy,
      approvedAt: Timestamp.fromDate(now),
      trashedAt: Timestamp.fromDate(now),
      autoAbandonedByOrgChange: true,  // 시스템 자동 이관 표시 — 본인 복구 가능
      updatedAt: serverTimestamp(),
    });
    processed += 1;
  }));
  return processed;
}

const ACTIVE_GOAL_STATUSES = ['DRAFT','PENDING_APPROVAL','LEAD_APPROVED','APPROVED','IN_PROGRESS','PENDING_ABANDON','PENDING_MODIFY','REJECTED','COMPLETED'] as const;

/**
 * 특정 사용자의 진행 중 목표(완료·포기 확정 제외)를 포기 확정 + 휴지통 이동 처리 (v0.75 B14).
 * 사용자 조직 변경 시 옵션 "예"를 선택했을 때 사용.
 */
export async function abandonActiveGoalsForUser(userId: string, approvedBy: string): Promise<number> {
  const snap = await getDocs(query(collection(db, COLLECTIONS.GOALS), where('userId', '==', userId)));
  const now = new Date();
  let processed = 0;
  await Promise.all(snap.docs.map(async d => {
    const data = d.data();
    // 이미 포기 확정(approvedBy 있는 ABANDONED) 또는 휴지통 처리된 것은 스킵
    if (data.status === 'ABANDONED' && data.approvedBy) return;
    if (data.trashedAt) return;
    await updateDoc(d.ref, {
      status: 'ABANDONED',
      approvedBy,
      approvedAt: Timestamp.fromDate(now),
      trashedAt: Timestamp.fromDate(now),
      autoAbandonedByOrgChange: true,  // 시스템 자동 이관 표시 — 본인 복구 가능
      updatedAt: serverTimestamp(),
    });
    processed += 1;
  }));
  return processed;
}

/**
 * 특정 사용자의 진행 중 목표를 상위 권한자에게 강제 이관 (사용자 삭제와 동일 패턴).
 * 조직 변경 시 사용자가 더 이상 그 조직의 일원이 아니지만 목표는 보존하면서 다음 권한자가 처리하게 함.
 * 대상 권한자: 사용자의 현재 조직 부모 체인을 따라 가장 먼저 발견되는 leaderId (본인 제외) 또는 같은 조직 TEAM_LEAD/EXECUTIVE 폴백.
 */
export async function transferActiveGoalsToUpstreamLeader(
  userId: string,
  userOrgId: string,
  userName: string,
  changedBy: string,
): Promise<{ transferred: number; targetUserId: string | null; targetOrgId: string | null }> {
  const [orgsSnap, usersSnap] = await Promise.all([
    getDocs(collection(db, COLLECTIONS.ORGANIZATIONS)),
    getDocs(collection(db, COLLECTIONS.USERS)),
  ]);
  const orgsById = new Map<string, any>();
  orgsSnap.docs.forEach(d => orgsById.set(d.id, { id: d.id, ...d.data() }));
  const allUsers = usersSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

  function findLeaderInOrg(orgId: string): string | null {
    const cand = allUsers.find(u =>
      u.id !== userId &&
      u.organizationId === orgId &&
      u.isActive !== false &&
      (u.role === 'TEAM_LEAD' || u.role === 'EXECUTIVE'),
    );
    return cand?.id ?? null;
  }

  // 부모 체인을 따라 leader 찾기
  let current: any = orgsById.get(userOrgId);
  let target: { targetUserId: string; targetOrgId: string } | null = null;
  while (current) {
    if (current.leaderId && current.leaderId !== userId) {
      target = { targetUserId: current.leaderId, targetOrgId: current.id };
      break;
    }
    const fb = findLeaderInOrg(current.id);
    if (fb) { target = { targetUserId: fb, targetOrgId: current.id }; break; }
    if (!current.parentId) break;
    current = orgsById.get(current.parentId);
  }
  if (!target) return { transferred: 0, targetUserId: null, targetOrgId: null };

  // 활성 목표 이관
  const snap = await getDocs(query(collection(db, COLLECTIONS.GOALS), where('userId', '==', userId)));
  let processed = 0;
  await Promise.all(snap.docs.map(async d => {
    const data = d.data();
    if (data.status === 'COMPLETED' && data.completionExecApprovedBy) return;
    if (data.status === 'ABANDONED' && data.approvedBy) return;
    if (data.trashedAt) return;
    // 옛 소속 org(이관 전 organizationId·userOrgId) 제거 후 새 조직 추가 — 옛 조직 쿼리 잔류 방지
    const prevOrg = data.organizationId;
    const newRelated = Array.from(new Set([
      ...((data.relatedOrgIds ?? []).filter((id: string) => id !== prevOrg && id !== userOrgId)),
      target!.targetOrgId,
    ]));
    await updateDoc(d.ref, {
      userId: target!.targetUserId,
      organizationId: target!.targetOrgId,
      relatedOrgIds: newRelated,
      previousOwnerId: userId,
      previousOwnerName: userName,
      transferredAt: serverTimestamp(),
      needsReassignment: true,
      updatedAt: serverTimestamp(),
    });
    await addDoc(collection(db, COLLECTIONS.GOAL_HISTORIES), {
      goalId: d.id,
      changedBy,
      changeType: 'OWNER_TRANSFERRED',
      previousStatus: data.status,
      newStatus: data.status,
      comment: `조직 변경으로 인한 이관: ${userName} → 수행자 재지정 대기`,
      createdAt: serverTimestamp(),
    });
    processed += 1;
  }));
  return { transferred: processed, targetUserId: target.targetUserId, targetOrgId: target.targetOrgId };
}

/**
 * 특정 사용자의 진행 중 목표(완료·포기 확정 제외)의 organizationId 를 새 조직으로 이전 (v0.75 B14).
 * 사용자 조직 변경 시 옵션 "아니오" (재구성) 를 선택했을 때 사용.
 * 완료/포기 확정된 historical 데이터는 그대로 유지하여 인사평가 자료 보존.
 */
export async function migrateActiveGoalsToNewOrg(userId: string, newOrgId: string): Promise<number> {
  const snap = await getDocs(query(collection(db, COLLECTIONS.GOALS), where('userId', '==', userId)));
  let processed = 0;
  await Promise.all(snap.docs.map(async d => {
    const data = d.data();
    // 완료(COMPLETED + completionExecApprovedBy) 또는 포기 확정(ABANDONED + approvedBy)은 그대로 유지
    if (data.status === 'COMPLETED' && data.completionExecApprovedBy) return;
    if (data.status === 'ABANDONED' && data.approvedBy) return;
    if (data.trashedAt) return; // 휴지통 안의 것도 그대로
    // relatedOrgIds 에서 옛 소속 org 제거 + 새 org 추가 (옛 조직 쿼리에 계속 잡혀 중복 노출되는 문제 방지)
    const prevOrg = data.organizationId;
    const newRelated = Array.from(new Set([
      ...((data.relatedOrgIds ?? []).filter((id: string) => id !== prevOrg)),
      newOrgId,
    ]));
    await updateDoc(d.ref, {
      organizationId: newOrgId,
      relatedOrgIds: newRelated,
      updatedAt: serverTimestamp(),
    });
    processed += 1;
  }));
  return processed;
}

// ─── 목표 ─────────────────────────────────────
export async function createGoal(data: Omit<Goal, 'id' | 'createdAt' | 'updatedAt'>) {
  const ref = await addDoc(collection(db, COLLECTIONS.GOALS), {
    ...data,
    dueDate: Timestamp.fromDate(data.dueDate),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateGoal(id: string, data: Partial<Goal>) {
  const updateData: DocumentData = { ...data, updatedAt: serverTimestamp() };
  if (data.dueDate) updateData.dueDate = Timestamp.fromDate(data.dueDate);
  await updateDoc(doc(db, COLLECTIONS.GOALS, id), updateData);
}

export async function deleteGoal(id: string) {
  await deleteDoc(doc(db, COLLECTIONS.GOALS, id));
}

export async function getGoalsByUser(userId: string, year?: number): Promise<Goal[]> {
  // 본인 owner 목표 + 본인이 collaborator 로 포함된 목표(임원 승인 후) 병합
  const ownerQuery: QueryConstraint[] = [where('userId', '==', userId)];
  if (year) ownerQuery.push(where('cycleYear', '==', year));
  const collabQuery: QueryConstraint[] = [where('collaboratorIds', 'array-contains', userId)];
  if (year) collabQuery.push(where('cycleYear', '==', year));
  const [ownerSnap, collabSnap] = await Promise.all([
    getDocs(query(collection(db, COLLECTIONS.GOALS), ...ownerQuery)),
    // collaboratorIds 필드가 존재하지 않는 구버전 문서는 array-contains 에서 자동 제외됨
    getDocs(query(collection(db, COLLECTIONS.GOALS), ...collabQuery)),
  ]);
  function mapDoc(d: any): Goal {
    return {
      ...d.data(),
      id: d.id,
      dueDate: fromTimestamp(d.data().dueDate) ?? new Date(),
      createdAt: fromTimestamp(d.data().createdAt) ?? new Date(),
      updatedAt: fromTimestamp(d.data().updatedAt) ?? new Date(),
      approvedAt: fromTimestamp(d.data().approvedAt),
      leadApprovedAt: fromTimestamp(d.data().leadApprovedAt),
      trashedAt: fromTimestamp(d.data().trashedAt),
      softDeletedAt: fromTimestamp(d.data().softDeletedAt),
      completionLeadApprovedAt: fromTimestamp(d.data().completionLeadApprovedAt),
      completionHqApprovedAt: fromTimestamp(d.data().completionHqApprovedAt),
      completionExecApprovedAt: fromTimestamp(d.data().completionExecApprovedAt),
      autoAbandonedByOrgChange: d.data().autoAbandonedByOrgChange ?? false,
    } as Goal;
  }
  const owned = ownerSnap.docs.map(mapDoc);
  // collaborator 목표는 임원 최종 승인 이후 (APPROVED / IN_PROGRESS / COMPLETED) 만 노출
  const COLLAB_VISIBLE = new Set(['APPROVED', 'IN_PROGRESS', 'COMPLETED', 'PENDING_ABANDON']);
  const collab = collabSnap.docs.map(mapDoc).filter(g =>
    g.userId !== userId && COLLAB_VISIBLE.has(g.status) && !g.trashedAt && !g.softDeletedAt,
  );
  const seen = new Set<string>();
  const merged: Goal[] = [];
  for (const g of [...owned, ...collab]) {
    if (!seen.has(g.id)) { seen.add(g.id); merged.push(g); }
  }
  return merged.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export async function getAllGoalsByYear(year: number): Promise<Goal[]> {
  const snap = await getDocs(query(
    collection(db, COLLECTIONS.GOALS),
    where('cycleYear', '==', year),
  ));
  const goals = snap.docs.map(d => ({
    ...d.data(), id: d.id,
    dueDate: fromTimestamp(d.data().dueDate) ?? new Date(),
    createdAt: fromTimestamp(d.data().createdAt) ?? new Date(),
    updatedAt: fromTimestamp(d.data().updatedAt) ?? new Date(),
    approvedAt: fromTimestamp(d.data().approvedAt),
    leadApprovedAt: fromTimestamp(d.data().leadApprovedAt),
    trashedAt: fromTimestamp(d.data().trashedAt),
    softDeletedAt: fromTimestamp(d.data().softDeletedAt),
    completionLeadApprovedAt: fromTimestamp(d.data().completionLeadApprovedAt),
    completionHqApprovedAt: fromTimestamp(d.data().completionHqApprovedAt),
    completionExecApprovedAt: fromTimestamp(d.data().completionExecApprovedAt),
    autoAbandonedByOrgChange: d.data().autoAbandonedByOrgChange ?? false,
  } as Goal));
  return goals.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

function mapGoalDoc(d: any): Goal {
  return {
    ...d.data(),
    id: d.id,
    dueDate: fromTimestamp(d.data().dueDate) ?? new Date(),
    createdAt: fromTimestamp(d.data().createdAt) ?? new Date(),
    updatedAt: fromTimestamp(d.data().updatedAt) ?? new Date(),
    approvedAt: fromTimestamp(d.data().approvedAt),
    leadApprovedAt: fromTimestamp(d.data().leadApprovedAt),
    trashedAt: fromTimestamp(d.data().trashedAt),
    softDeletedAt: fromTimestamp(d.data().softDeletedAt),
    completionLeadApprovedAt: fromTimestamp(d.data().completionLeadApprovedAt),
    completionHqApprovedAt: fromTimestamp(d.data().completionHqApprovedAt),
    completionExecApprovedAt: fromTimestamp(d.data().completionExecApprovedAt),
    autoAbandonedByOrgChange: d.data().autoAbandonedByOrgChange ?? false,
  } as Goal;
}

export async function getGoalsByOrganization(orgId: string, year?: number): Promise<Goal[]> {
  // organizationId 또는 relatedOrgIds 에 포함된 목표를 합쳐 반환 (공동 수행자 소속 조직 포함)
  const orgConstraints: QueryConstraint[] = [where('organizationId', '==', orgId)];
  const relConstraints: QueryConstraint[] = [where('relatedOrgIds', 'array-contains', orgId)];
  if (year) {
    orgConstraints.push(where('cycleYear', '==', year));
    relConstraints.push(where('cycleYear', '==', year));
  }
  const [snapByOrg, snapByRel] = await Promise.all([
    getDocs(query(collection(db, COLLECTIONS.GOALS), ...orgConstraints)),
    getDocs(query(collection(db, COLLECTIONS.GOALS), ...relConstraints)),
  ]);
  const seen = new Set<string>();
  const merged: Goal[] = [];
  for (const d of [...snapByOrg.docs, ...snapByRel.docs]) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    merged.push(mapGoalDoc(d));
  }
  return merged.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

// 여러 조직의 목표 조회 (임원/CEO용) — 10개 초과 시 배치 처리. relatedOrgIds 도 함께 매칭.
export async function getGoalsByOrganizations(orgIds: string[], year?: number): Promise<Goal[]> {
  if (orgIds.length === 0) return [];
  const CHUNK = 10;
  const seen = new Set<string>();
  const merged: Goal[] = [];
  for (let i = 0; i < orgIds.length; i += CHUNK) {
    const chunk = orgIds.slice(i, i + CHUNK);
    const baseConstraintsOrg: QueryConstraint[] = [where('organizationId', 'in', chunk)];
    const baseConstraintsRel: QueryConstraint[] = [where('relatedOrgIds', 'array-contains-any', chunk)];
    if (year) {
      baseConstraintsOrg.push(where('cycleYear', '==', year));
      baseConstraintsRel.push(where('cycleYear', '==', year));
    }
    const [snapByOrg, snapByRel] = await Promise.all([
      getDocs(query(collection(db, COLLECTIONS.GOALS), ...baseConstraintsOrg)),
      getDocs(query(collection(db, COLLECTIONS.GOALS), ...baseConstraintsRel)),
    ]);
    for (const d of [...snapByOrg.docs, ...snapByRel.docs]) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      merged.push(mapGoalDoc(d));
    }
  }
  return merged.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

// 팀장: 승인 대기 목표 조회
export async function getPendingGoalsByOrganization(orgId: string): Promise<Goal[]> {
  return getPendingGoalsByOrganizations([orgId]);
}

// 여러 조직의 승인 대기 목표 조회 (임원용) — 10개 초과 시 배치 처리
export async function getPendingGoalsByOrganizations(orgIds: string[]): Promise<Goal[]> {
  if (orgIds.length === 0) return [];

  function mapGoal(d: DocumentData & { id: string }): Goal {
    const data = (d as any).data ? (d as any).data() : d;
    const docId = (d as any).id ?? '';
    return {
      ...data, id: docId,
      dueDate: fromTimestamp(data.dueDate) ?? new Date(),
      createdAt: fromTimestamp(data.createdAt) ?? new Date(),
      updatedAt: fromTimestamp(data.updatedAt) ?? new Date(),
      approvedAt: fromTimestamp(data.approvedAt),
      leadApprovedAt: fromTimestamp(data.leadApprovedAt),
      trashedAt: fromTimestamp(data.trashedAt),
      softDeletedAt: fromTimestamp(data.softDeletedAt),
      completionLeadApprovedAt: fromTimestamp(data.completionLeadApprovedAt),
      completionHqApprovedAt: fromTimestamp(data.completionHqApprovedAt),
      completionExecApprovedAt: fromTimestamp(data.completionExecApprovedAt),
      autoAbandonedByOrgChange: data.autoAbandonedByOrgChange ?? false,
    } as Goal;
  }

  const PENDING_STATUSES = new Set(['PENDING_APPROVAL', 'LEAD_APPROVED', 'PENDING_ABANDON', 'COMPLETED']);
  const CHUNK = 10;
  const results: Goal[] = [];
  for (let i = 0; i < orgIds.length; i += CHUNK) {
    const chunk = orgIds.slice(i, i + CHUNK);
    // status 'in' 조건을 쿼리에서 제거하고 JS에서 필터링
    // (organizationId in × status in 복합 시 disjunctions 40개 초과 → Firestore 한계 30개)
    const snap = await getDocs(query(
      collection(db, COLLECTIONS.GOALS),
      where('organizationId', 'in', chunk),
    ));
    results.push(...snap.docs
      .filter(d => PENDING_STATUSES.has(d.data().status))
      .map(d => {
        const data = d.data();
        return {
          ...data, id: d.id,
          dueDate: fromTimestamp(data.dueDate) ?? new Date(),
          createdAt: fromTimestamp(data.createdAt) ?? new Date(),
          updatedAt: fromTimestamp(data.updatedAt) ?? new Date(),
          approvedAt: fromTimestamp(data.approvedAt),
          leadApprovedAt: fromTimestamp(data.leadApprovedAt),
      trashedAt: fromTimestamp(data.trashedAt),
      softDeletedAt: fromTimestamp(data.softDeletedAt),
      completionLeadApprovedAt: fromTimestamp(data.completionLeadApprovedAt),
      completionHqApprovedAt: fromTimestamp(data.completionHqApprovedAt),
      completionExecApprovedAt: fromTimestamp(data.completionExecApprovedAt),
      autoAbandonedByOrgChange: data.autoAbandonedByOrgChange ?? false,
          hqApprovedAt: fromTimestamp(data.hqApprovedAt),
        } as Goal;
      }));
  }
  return results.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

// ─── 목표 이력 ────────────────────────────────
export async function addGoalHistory(data: Omit<GoalHistory, 'id' | 'createdAt'>) {
  // Firestore 는 undefined 값을 거부하므로 undefined 필드는 제거
  const cleaned: Record<string, any> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) cleaned[k] = v;
  }
  await addDoc(collection(db, COLLECTIONS.GOAL_HISTORIES), {
    ...cleaned,
    createdAt: serverTimestamp(),
  });
}

export async function getGoalHistories(goalId: string): Promise<GoalHistory[]> {
  const snap = await getDocs(query(
    collection(db, COLLECTIONS.GOAL_HISTORIES),
    where('goalId', '==', goalId),
  ));
  const items = snap.docs.map(d => ({
    ...d.data(),
    id: d.id,
    createdAt: fromTimestamp(d.data().createdAt) ?? new Date(),
  } as GoalHistory));
  // 최신순 정렬
  return items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

// ─── 진행상황 ──────────────────────────────────
export async function addProgressUpdate(data: Omit<ProgressUpdate, 'id' | 'createdAt'>) {
  const ref = await addDoc(collection(db, COLLECTIONS.PROGRESS_UPDATES), {
    ...data,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function getProgressUpdates(goalId: string): Promise<ProgressUpdate[]> {
  const snap = await getDocs(query(
    collection(db, COLLECTIONS.PROGRESS_UPDATES),
    where('goalId', '==', goalId),
  ));
  const items = snap.docs.map(d => ({
    ...d.data(),
    id: d.id,
    createdAt: fromTimestamp(d.data().createdAt) ?? new Date(),
  } as ProgressUpdate));
  return items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

// ─── 자기평가 (SelfEvaluation) ────────────────
function selfEvalDocId(userId: string, year: number) {
  return `${userId}_${year}`;
}

function mapSelfEval(id: string, d: DocumentData): SelfEvaluation {
  return {
    ...d,
    id,
    goalEvals: (d.goalEvals ?? []) as SelfEvalGoalEntry[],
    submittedAt: fromTimestamp(d.submittedAt),
    createdAt: fromTimestamp(d.createdAt) ?? new Date(),
    updatedAt: fromTimestamp(d.updatedAt) ?? new Date(),
  } as SelfEvaluation;
}

export async function getSelfEvaluation(userId: string, year: number): Promise<SelfEvaluation | null> {
  if (USE_EVAL_READ_PROXY) {
    const docs = await proxyReadForms('selfEvaluations', { mode: 'single', userId, year });
    return docs[0] ? reviveSelfEval(docs[0]) : null;
  }
  const snap = await getDoc(doc(db, COLLECTIONS.SELF_EVALUATIONS, selfEvalDocId(userId, year)));
  if (!snap.exists()) return null;
  return mapSelfEval(snap.id, snap.data());
}

export async function upsertSelfEvaluation(
  userId: string,
  year: number,
  data: Partial<Omit<SelfEvaluation, 'id' | 'userId' | 'cycleYear' | 'createdAt' | 'updatedAt'>>
) {
  const id = selfEvalDocId(userId, year);
  const existing = await getDoc(doc(db, COLLECTIONS.SELF_EVALUATIONS, id));
  // viewableBy 산출 — 우선순위:
  //  1) data.organizationId (호출 측이 명시) → 시즌 정확도 보장
  //  2) 기존 doc 의 organizationId (다년도 — 작성 시점 조직 보존)
  //  3) 본인 현재 조직 (최초 신규 작성)
  const existingData = existing.exists() ? existing.data() : null;
  const orgIdForAcl =
    data.organizationId ??
    (existingData?.organizationId as string | undefined) ??
    (await getUser(userId))?.organizationId ??
    '';
  const viewableBy = orgIdForAcl
    ? await computeViewableBy(userId, orgIdForAcl)
    : [userId];

  if (existing.exists()) {
    await updateDoc(doc(db, COLLECTIONS.SELF_EVALUATIONS, id), {
      ...data,
      ...(orgIdForAcl && !existingData?.organizationId ? { organizationId: orgIdForAcl } : {}),
      ...(data.submittedAt ? { submittedAt: Timestamp.fromDate(data.submittedAt) } : {}),
      viewableBy,
      updatedAt: serverTimestamp(),
    });
  } else {
    await setDoc(doc(db, COLLECTIONS.SELF_EVALUATIONS, id), {
      userId,
      cycleYear: year,
      goalEvals: [],
      status: 'DRAFT',
      ...(orgIdForAcl ? { organizationId: orgIdForAcl } : {}),
      ...data,
      ...(data.submittedAt ? { submittedAt: Timestamp.fromDate(data.submittedAt) } : {}),
      viewableBy,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
}

export async function getSelfEvaluationsByUsers(userIds: string[], year: number): Promise<SelfEvaluation[]> {
  if (userIds.length === 0) return [];
  if (USE_EVAL_READ_PROXY) {
    const docs = await proxyReadForms('selfEvaluations', { mode: 'byUsers', userIds, year });
    return docs.map(reviveSelfEval);
  }
  const results = await Promise.all(
    userIds.map(uid => getSelfEvaluation(uid, year))
  );
  return results.filter((s): s is SelfEvaluation => s !== null);
}

// ─── 가시성 ACL (viewableBy) ───────────────────
// v0.9.1: 평가 데이터의 read 권한을 Firestore 규칙 레벨에서 차단하기 위한 ACL 헬퍼.
// individualEvaluations / selfEvaluations / yearEndEvals / mentoringForms 의
// 저장 함수에서 자동으로 본인 + 조직 트리 상위 리더들의 userId 를 viewableBy 배열에 저장.
//
// CEO·HR관리자/마스터는 어차피 규칙에서 무조건 허용하므로 배열에 포함하지 않는다.
// HR 권한 부여/회수 시점에는 viewableBy 갱신 불필요.

/** 조직 트리 캐시 — leader/parent 만 추출한 가벼운 맵 */
export type OrgTreeCache = Map<string, { id: string; parentId: string | null; leaderId: string | null }>;

/** 조직별 leader-role 사용자 목록 캐시 — 같은 조직에 소속된 TEAM_LEAD/EXECUTIVE 의 userId 목록 */
export type OrgLeadersCache = Map<string, string[]>;

/** 전체 조직을 한 번에 로드해 캐시 맵을 반환 — caller 가 여러 computeViewableBy 호출에 재사용 */
export async function loadOrgTreeCache(): Promise<OrgTreeCache> {
  const snap = await getDocs(collection(db, COLLECTIONS.ORGANIZATIONS));
  const map: OrgTreeCache = new Map();
  snap.docs.forEach(d => {
    const data = d.data() as { parentId?: string | null; leaderId?: string | null };
    map.set(d.id, { id: d.id, parentId: data.parentId ?? null, leaderId: data.leaderId ?? null });
  });
  return map;
}

/**
 * 조직별 TEAM_LEAD/EXECUTIVE role 활성 사용자 목록 로드.
 * leaderId 가 명시되지 않은 조직에서도 "팀장 직급 사용자가 본인 소속 팀 평가를 봐야 한다" 는
 * 기존 UI 가정과 일치시키기 위한 fallback.
 */
export async function loadOrgLeadersCache(): Promise<OrgLeadersCache> {
  const snap = await getDocs(collection(db, COLLECTIONS.USERS));
  const map: OrgLeadersCache = new Map();
  snap.docs.forEach(d => {
    const data = d.data() as { role?: string; organizationId?: string; isActive?: boolean };
    if (data.isActive === false) return;
    if (data.role !== 'TEAM_LEAD' && data.role !== 'EXECUTIVE') return;
    if (!data.organizationId) return;
    const arr = map.get(data.organizationId) ?? [];
    arr.push(d.id);
    map.set(data.organizationId, arr);
  });
  return map;
}

/**
 * 평가 대상자 본인과 가시성 원칙에 따른 viewer 들을 모은다.
 *
 * 가시성 (CLAUDE.md §6-1):
 *  - 본인
 *  - 본인 소속 조직 → parent → parent ... 루트까지 거슬러 올라가며 각 조직의:
 *    a) leaderId (명시적 리더)
 *    b) 그 조직에 소속된 TEAM_LEAD/EXECUTIVE role 사용자 (UI 의 home-org 가정과 일치)
 *
 * 케이스:
 *  - 일반팀장: 본인 팀의 TEAM_LEAD = 본인. 자기 자신 + 상위 본부장·임원이 viewer.
 *  - 본부장(TEAM_LEAD@HQ): 산하 팀원의 평가에 본부장 UID 가 포함됨 (산하 팀의 parent 가 HQ 이므로).
 *  - 임원(EXECUTIVE@DIVISION): 산하 본부·팀 모든 평가에 임원 UID 포함.
 *  - leaderId 가 비어있어도 (b) 조건으로 본인 소속 leader role 이 자동 viewer 됨.
 *
 * @param orgsCache 선택 — 미리 로드한 OrgTreeCache. 대량 재계산 시 N×Orgs read 방지용.
 * @param leadersCache 선택 — 미리 로드한 OrgLeadersCache. 대량 재계산 시 N×Users read 방지용.
 */
export async function computeViewableBy(
  userId: string,
  organizationId: string,
  orgsCache?: OrgTreeCache,
  leadersCache?: OrgLeadersCache,
): Promise<string[]> {
  const viewers = new Set<string>();
  viewers.add(userId);
  if (!organizationId) return Array.from(viewers);

  const orgsById = orgsCache ?? await loadOrgTreeCache();
  const leadersByOrg = leadersCache ?? await loadOrgLeadersCache();
  const visited = new Set<string>();
  let cur: string | null = organizationId;
  while (cur && !visited.has(cur)) {
    visited.add(cur);
    const org = orgsById.get(cur);
    if (!org) break;
    // (a) 명시적 leaderId
    if (org.leaderId) viewers.add(org.leaderId);
    // (b) 같은 조직 소속 leader role 사용자 (home-org fallback)
    const sameOrgLeaders = leadersByOrg.get(cur) ?? [];
    for (const uid of sameOrgLeaders) viewers.add(uid);
    cur = org.parentId;
  }
  return Array.from(viewers);
}

/**
 * 한 사용자의 모든 평가(4종) viewableBy 를 재계산. 사용자 조직 이동 시 호출.
 * 호출 전 user.organizationId 가 새 조직으로 갱신된 상태여야 한다.
 *
 * @param orgsCache 선택 — 대량 호출 시 호출자가 주입.
 */
export async function recomputeViewableByForUser(
  userId: string,
  orgsCache?: OrgTreeCache,
  leadersCache?: OrgLeadersCache,
): Promise<{ updated: number }> {
  const user = await getUser(userId);
  if (!user) return { updated: 0 };
  const oCache = orgsCache ?? await loadOrgTreeCache();
  const lCache = leadersCache ?? await loadOrgLeadersCache();
  let updated = 0;

  // individualEvaluations
  const ieSnap = await getDocs(query(
    collection(db, COLLECTIONS.INDIVIDUAL_EVALUATIONS),
    where('userId', '==', userId),
  ));
  for (const d of ieSnap.docs) {
    const data = d.data();
    const orgId = data.organizationId ?? user.organizationId;
    const viewableBy = await computeViewableBy(userId, orgId, oCache, lCache);
    await updateDoc(d.ref, { viewableBy, updatedAt: serverTimestamp() });
    updated++;
  }

  // selfEvaluations — doc 의 organizationId 우선 (다년도 보존)
  const seSnap = await getDocs(query(
    collection(db, COLLECTIONS.SELF_EVALUATIONS),
    where('userId', '==', userId),
  ));
  for (const d of seSnap.docs) {
    const data = d.data();
    const orgId = (data.organizationId as string | undefined) ?? user.organizationId;
    const viewableBy = await computeViewableBy(userId, orgId, oCache, lCache);
    await updateDoc(d.ref, { viewableBy, updatedAt: serverTimestamp() });
    updated++;
  }

  // yearEndEvals
  const yeSnap = await getDocs(query(
    collection(db, COLLECTIONS.YEAR_END_EVALS),
    where('userId', '==', userId),
  ));
  for (const d of yeSnap.docs) {
    const data = d.data();
    const orgId = data.organizationId ?? user.organizationId;
    const viewableBy = await computeViewableBy(userId, orgId, oCache, lCache);
    await updateDoc(d.ref, { viewableBy, updatedAt: serverTimestamp() });
    updated++;
  }

  // mentoringForms
  const mfSnap = await getDocs(query(
    collection(db, COLLECTIONS.MENTORING_FORMS),
    where('userId', '==', userId),
  ));
  for (const d of mfSnap.docs) {
    const data = d.data();
    const orgId = data.organizationId ?? user.organizationId;
    const viewableBy = await computeViewableBy(userId, orgId, oCache, lCache);
    await updateDoc(d.ref, { viewableBy, updatedAt: serverTimestamp() });
    updated++;
  }
  return { updated };
}

/**
 * 한 조직과 그 산하 모든 조직의 모든 평가 viewableBy 를 재계산. 조직 leader 변경 시 호출.
 * 한 번의 조직 fetch 를 재사용하여 N×Orgs read 를 1×Orgs 로 줄임.
 */
export async function recomputeViewableByForOrgTree(rootOrgId: string): Promise<{ users: number; docs: number }> {
  const cache = await loadOrgTreeCache();
  const leadersCache = await loadOrgLeadersCache();

  // rootOrgId 의 산하 조직 ID 집합 (BFS)
  const descendantIds = new Set<string>([rootOrgId]);
  let changed = true;
  while (changed) {
    changed = false;
    cache.forEach((org, id) => {
      if (!descendantIds.has(id) && org.parentId && descendantIds.has(org.parentId)) {
        descendantIds.add(id);
        changed = true;
      }
    });
  }

  // 영향받는 사용자 — organizationId 가 산하 조직 집합에 속한 모두
  const usersSnap = await getDocs(collection(db, COLLECTIONS.USERS));
  const affectedUserIds = usersSnap.docs
    .filter(d => {
      const data = d.data();
      return data.organizationId && descendantIds.has(data.organizationId);
    })
    .map(d => d.id);

  let totalDocs = 0;
  for (const uid of affectedUserIds) {
    const { updated } = await recomputeViewableByForUser(uid, cache, leadersCache);  // C-4: 캐시 재사용
    totalDocs += updated;
  }
  return { users: affectedUserIds.length, docs: totalDocs };
}

// ─── 개인 평가 ────────────────────────────────
// ── 개인평가 읽기 프록시 (옵션 E, feature-flags.USE_EVAL_READ_PROXY) ──────────
/** 프록시 API 응답(ISO 문자열 날짜)을 IndividualEvaluation(Date) 으로 복원 */
function reviveProxyEval(e: any): IndividualEvaluation {
  return {
    ...e,
    createdAt: e.createdAt ? new Date(e.createdAt) : new Date(),
    updatedAt: e.updatedAt ? new Date(e.updatedAt) : new Date(),
    leadSubmittedAt: e.leadSubmittedAt ? new Date(e.leadSubmittedAt) : undefined,
    hqReviewedAt: e.hqReviewedAt ? new Date(e.hqReviewedAt) : undefined,
    execConfirmedAt: e.execConfirmedAt ? new Date(e.execConfirmedAt) : undefined,
  } as IndividualEvaluation;
}

async function proxyReadIndividualEvals(
  body: { mode: 'single' | 'org' | 'all'; userId?: string; orgId?: string; year: number },
): Promise<IndividualEvaluation[]> {
  const fbUser = auth.currentUser;
  if (!fbUser) throw new Error('로그인이 필요합니다.');
  const idToken = await fbUser.getIdToken();
  const res = await fetch('/api/evaluation/individual', {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? '평가 조회 실패');
  return (data.evals ?? []).map(reviveProxyEval);
}

// ── 평가 부속 문서(자기평가·연말평가·육성면담서) 읽기 프록시 (Phase 3) ──
function reviveDate(v: any): Date | undefined { return v ? new Date(v) : undefined; }

async function proxyReadForms(
  collection: 'selfEvaluations' | 'yearEndEvals' | 'mentoringForms',
  body: { mode: 'single' | 'byUsers'; userId?: string; userIds?: string[]; year: number },
): Promise<any[]> {
  const fbUser = auth.currentUser;
  if (!fbUser) throw new Error('로그인이 필요합니다.');
  const idToken = await fbUser.getIdToken();
  const res = await fetch('/api/evaluation/forms', {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ collection, ...body }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? '평가 조회 실패');
  return data.docs ?? [];
}

function reviveSelfEval(o: any): SelfEvaluation {
  return {
    ...o,
    goalEvals: (o.goalEvals ?? []) as SelfEvalGoalEntry[],
    submittedAt: reviveDate(o.submittedAt),
    createdAt: reviveDate(o.createdAt) ?? new Date(),
    updatedAt: reviveDate(o.updatedAt) ?? new Date(),
  } as SelfEvaluation;
}
function reviveYearEndEval(o: any): YearEndEval {
  return {
    ...o,
    submittedAt: reviveDate(o.submittedAt),
    createdAt: reviveDate(o.createdAt) ?? new Date(),
    updatedAt: reviveDate(o.updatedAt) ?? new Date(),
  } as YearEndEval;
}
function reviveMentoringForm(o: any): MentoringForm {
  return {
    ...o,
    submittedAt: reviveDate(o.submittedAt),
    editRequestedAt: reviveDate(o.editRequestedAt),
    editRequestApprovedAt: reviveDate(o.editRequestApprovedAt),
    createdAt: reviveDate(o.createdAt) ?? new Date(),
    updatedAt: reviveDate(o.updatedAt) ?? new Date(),
  } as MentoringForm;
}

function mapIndividualEval(id: string, d: DocumentData): IndividualEvaluation {
  return {
    ...d,
    id,
    createdAt: fromTimestamp(d.createdAt) ?? new Date(),
    updatedAt: fromTimestamp(d.updatedAt) ?? new Date(),
    leadSubmittedAt: fromTimestamp(d.leadSubmittedAt),
    hqReviewedAt: fromTimestamp(d.hqReviewedAt),
    execConfirmedAt: fromTimestamp(d.execConfirmedAt),
  } as IndividualEvaluation;
}

export async function getIndividualEvaluation(userId: string, year: number): Promise<IndividualEvaluation | null> {
  if (USE_EVAL_READ_PROXY) {
    const evals = await proxyReadIndividualEvals({ mode: 'single', userId, year });
    return evals[0] ?? null;
  }
  const snap = await getDocs(query(
    collection(db, COLLECTIONS.INDIVIDUAL_EVALUATIONS),
    where('userId', '==', userId),
    where('cycleYear', '==', year)
  ));
  if (snap.empty) return null;
  const d = snap.docs[0];
  return mapIndividualEval(d.id, d.data());
}

export async function upsertIndividualEvaluation(
  userId: string,
  year: number,
  data: Partial<IndividualEvaluation>
) {
  const existing = await getIndividualEvaluation(userId, year);
  const safeData = { ...data };
  if (safeData.leadSubmittedAt) {
    (safeData as any).leadSubmittedAt = Timestamp.fromDate(safeData.leadSubmittedAt);
  }
  if (safeData.hqReviewedAt) {
    (safeData as any).hqReviewedAt = Timestamp.fromDate(safeData.hqReviewedAt);
  }
  if (safeData.execConfirmedAt) {
    (safeData as any).execConfirmedAt = Timestamp.fromDate(safeData.execConfirmedAt);
  }
  if (existing) {
    // 데이터 힐링: 기존 문서가 organizationId 없이 저장된 경우(과거 버그 영향)
    //   현재 data 에 organizationId 가 있으면 보강 저장. 한 번 저장된 organizationId 가 있으면 변경하지 않음.
    const patch: any = { ...safeData, updatedAt: serverTimestamp() };
    if (!existing.organizationId && safeData.organizationId) {
      patch.organizationId = safeData.organizationId;
    }
    // viewableBy 자동 계산 — 최종 organizationId 기준 (patch 없으면 existing 기준)
    const finalOrgId = patch.organizationId ?? existing.organizationId;
    if (finalOrgId) {
      patch.viewableBy = await computeViewableBy(userId, finalOrgId);
    }
    // D-3: 등급 변경 audit — leadGrade/hqGrade/execGrade 중 하나라도 값이 바뀌면 기록
    const changes: string[] = [];
    if (safeData.leadGrade !== undefined && safeData.leadGrade !== existing.leadGrade) {
      changes.push(`leadGrade: ${existing.leadGrade ?? '∅'} → ${safeData.leadGrade ?? '∅'}`);
    }
    if (safeData.hqGrade !== undefined && safeData.hqGrade !== existing.hqGrade) {
      changes.push(`hqGrade: ${existing.hqGrade ?? '∅'} → ${safeData.hqGrade ?? '∅'}`);
    }
    if (safeData.execGrade !== undefined && safeData.execGrade !== existing.execGrade) {
      changes.push(`execGrade: ${existing.execGrade ?? '∅'} → ${safeData.execGrade ?? '∅'}`);
    }
    if (changes.length > 0) {
      const actorId = safeData.execConfirmedBy ?? safeData.hqReviewedBy ?? safeData.leadSubmittedBy ?? 'unknown';
      createAuditLog({
        action: 'EVAL_GRADE_CHANGE',
        actorId,
        actorName: actorId, // 호출 측에서 name 모름 → 후처리로 lookup 가능 (audit 화면에서 조회)
        targetId: userId,
        targetName: '',
        details: `${year}년 평가 / ${changes.join(', ')}`,
      }).catch(err => console.warn('[D-3 audit] 실패:', err));
    }
    await updateDoc(doc(db, COLLECTIONS.INDIVIDUAL_EVALUATIONS, existing.id), patch);
  } else {
    if (!safeData.organizationId) {
      // organizationId 가 없으면 getIndividualEvaluationsByOrg 쿼리에 잡히지 않아 화면에 표시되지 않음.
      // 데이터 무결성 보장을 위해 새 문서 생성을 거부.
      throw new Error('[upsertIndividualEvaluation] organizationId 가 필요합니다. (호출 위치에서 member.organizationId 전달 누락)');
    }
    const viewableBy = await computeViewableBy(userId, safeData.organizationId);
    await addDoc(collection(db, COLLECTIONS.INDIVIDUAL_EVALUATIONS), {
      userId,
      cycleYear: year,
      status: 'NOT_STARTED',
      ...safeData,
      viewableBy,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
}

export async function getAllIndividualEvaluations(year: number): Promise<IndividualEvaluation[]> {
  if (USE_EVAL_READ_PROXY) {
    return proxyReadIndividualEvals({ mode: 'all', year });
  }
  const snap = await getDocs(query(
    collection(db, COLLECTIONS.INDIVIDUAL_EVALUATIONS),
    where('cycleYear', '==', year)
  ));
  return snap.docs.map(d => mapIndividualEval(d.id, d.data()));
}

/**
 * 평가 시즌 IE 일괄 시드 (Q2).
 * 해당 연도에 IE doc 가 없는 활성 사용자(CEO 제외) 전원에 대해 NOT_STARTED IE 생성.
 * 이미 IE 가 있는 사용자는 건너뜀 (재실행 안전).
 * 반환: 생성 건수.
 */
export async function seedIndividualEvaluations(year: number): Promise<{ created: number; skipped: number }> {
  const [usersSnap, ieSnap, orgsCache, leadersCache] = await Promise.all([
    getDocs(collection(db, COLLECTIONS.USERS)),
    getDocs(query(collection(db, COLLECTIONS.INDIVIDUAL_EVALUATIONS), where('cycleYear', '==', year))),
    loadOrgTreeCache(),
    loadOrgLeadersCache(),
  ]);
  const haveIE = new Set(ieSnap.docs.map(d => d.data().userId));
  let created = 0, skipped = 0;
  const tasks: Promise<any>[] = [];
  for (const d of usersSnap.docs) {
    const u = d.data() as User;
    if (u.isActive === false) { skipped++; continue; }
    // CEO·임원(EXECUTIVE)은 평가 권한자이지 평가 대상자가 아님 — 시드 제외
    if (u.role === 'CEO' || u.role === 'EXECUTIVE') { skipped++; continue; }
    if (!u.organizationId) { skipped++; continue; }
    if (haveIE.has(d.id)) { skipped++; continue; }
    const viewableBy = await computeViewableBy(d.id, u.organizationId, orgsCache, leadersCache);
    tasks.push(addDoc(collection(db, COLLECTIONS.INDIVIDUAL_EVALUATIONS), {
      userId: d.id,
      cycleYear: year,
      organizationId: u.organizationId,
      status: 'NOT_STARTED',
      viewableBy,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
    created++;
  }
  await Promise.all(tasks);
  return { created, skipped };
}

/**
 * 사용자 조직 이동 시 당해년도 평가 doc 의 organizationId 이전 (Q3).
 * IE / selfEvaluations / mentoringForms 중 cycleYear === year 인 것만 새 조직으로 갱신.
 * (다년도 과거 데이터는 작성 시점 조직 보존 — 손대지 않음)
 * 반환: 갱신 건수.
 */
export async function migrateCurrentYearEvalOrg(userId: string, newOrgId: string, year: number): Promise<{ updated: number }> {
  const oCache = await loadOrgTreeCache();
  const lCache = await loadOrgLeadersCache();
  const viewableBy = await computeViewableBy(userId, newOrgId, oCache, lCache);
  let updated = 0;

  // individualEvaluations
  const ieSnap = await getDocs(query(
    collection(db, COLLECTIONS.INDIVIDUAL_EVALUATIONS),
    where('userId', '==', userId),
    where('cycleYear', '==', year),
  ));
  for (const d of ieSnap.docs) {
    await updateDoc(d.ref, { organizationId: newOrgId, viewableBy, updatedAt: serverTimestamp() });
    updated++;
  }

  // selfEvaluations (docId = userId_year)
  const seId = selfEvalDocId(userId, year);
  const seDoc = await getDoc(doc(db, COLLECTIONS.SELF_EVALUATIONS, seId));
  if (seDoc.exists()) {
    await updateDoc(seDoc.ref, { organizationId: newOrgId, viewableBy, updatedAt: serverTimestamp() });
    updated++;
  }

  // mentoringForms (docId = userId_year)
  const mfId = mentoringDocId(userId, year);
  const mfDoc = await getDoc(doc(db, COLLECTIONS.MENTORING_FORMS, mfId));
  if (mfDoc.exists()) {
    await updateDoc(mfDoc.ref, { organizationId: newOrgId, viewableBy, updatedAt: serverTimestamp() });
    updated++;
  }

  // yearEndEvals (docId = userId_year)
  const yeId = yearEndEvalDocId(userId, year);
  const yeDoc = await getDoc(doc(db, COLLECTIONS.YEAR_END_EVALS, yeId));
  if (yeDoc.exists()) {
    await updateDoc(yeDoc.ref, { organizationId: newOrgId, viewableBy, updatedAt: serverTimestamp() });
    updated++;
  }

  return { updated };
}

/**
 * 팀장 1차 의견 회수: leadGrade/leadComment/leadSubmittedBy/leadSubmittedAt 제거.
 * 상위 단계(HQ_REVIEWED / EXEC_CONFIRMED / PUBLISHED) 진입 후에는 호출자가 차단할 것.
 * status 는 SELF_SUBMITTED (자기평가 제출 상태) 로 복귀 — 평가 대상자가 자기평가도 회수할 수 있게 한다.
 */
export async function withdrawLeadOpinion(ie: IndividualEvaluation) {
  const { deleteField: del } = await import('firebase/firestore');
  await updateDoc(doc(db, COLLECTIONS.INDIVIDUAL_EVALUATIONS, ie.id), {
    status: 'SELF_SUBMITTED',
    leadGrade: del(),
    leadComment: del(),
    leadSubmittedBy: del(),
    leadSubmittedAt: del(),
    updatedAt: serverTimestamp(),
  });
  // D-3: 등급 회수 audit (이전 등급이 있었을 때만)
  if (ie.leadGrade) {
    createAuditLog({
      action: 'EVAL_GRADE_CHANGE',
      actorId: ie.leadSubmittedBy ?? 'unknown',
      actorName: ie.leadSubmittedBy ?? 'unknown',
      targetId: ie.userId,
      targetName: '',
      details: `${ie.cycleYear}년 평가 / 팀장 의견 회수 (leadGrade: ${ie.leadGrade} → ∅)`,
    }).catch(err => console.warn('[D-3 audit] withdrawLeadOpinion 실패:', err));
  }
}

/**
 * 본부장 2차 의견 회수: hqGrade/hqComment/hqReviewedBy/hqReviewedAt 제거.
 * 임원 확정 후에는 호출자가 차단할 것.
 * status 는 leadSubmittedBy 있으면 LEAD_REVIEWED, 없으면 SELF_SUBMITTED 로 복귀.
 */
export async function withdrawHqOpinion(ie: IndividualEvaluation) {
  const { deleteField: del } = await import('firebase/firestore');
  const revertStatus: IndividualEvalStatus = ie.leadSubmittedBy ? 'LEAD_REVIEWED' : 'SELF_SUBMITTED';
  await updateDoc(doc(db, COLLECTIONS.INDIVIDUAL_EVALUATIONS, ie.id), {
    status: revertStatus,
    hqGrade: del(),
    hqComment: del(),
    hqReviewedBy: del(),
    hqReviewedAt: del(),
    updatedAt: serverTimestamp(),
  });
  if (ie.hqGrade) {
    createAuditLog({
      action: 'EVAL_GRADE_CHANGE',
      actorId: ie.hqReviewedBy ?? 'unknown',
      actorName: ie.hqReviewedBy ?? 'unknown',
      targetId: ie.userId,
      targetName: '',
      details: `${ie.cycleYear}년 평가 / 본부장 의견 회수 (hqGrade: ${ie.hqGrade} → ∅)`,
    }).catch(err => console.warn('[D-3 audit] withdrawHqOpinion 실패:', err));
  }
}

/**
 * 임원 확정 등급 무효화: execGrade/execComment/execConfirmedBy/execConfirmedAt 제거.
 * status 는 이전 단계로 자동 복원 — hqReviewedBy 있으면 HQ_REVIEWED, leadSubmittedBy 있으면 LEAD_REVIEWED, 모두 없으면 NOT_STARTED.
 * 쿼터 재조정 시 호출되어 임원이 다시 등급을 부여하도록 강제한다.
 */
export async function clearExecConfirmation(ie: IndividualEvaluation) {
  const { deleteField: del } = await import('firebase/firestore');
  const revertStatus: IndividualEvalStatus = ie.hqReviewedBy
    ? 'HQ_REVIEWED'
    : ie.leadSubmittedBy
      ? 'LEAD_REVIEWED'
      : 'NOT_STARTED';
  await updateDoc(doc(db, COLLECTIONS.INDIVIDUAL_EVALUATIONS, ie.id), {
    status: revertStatus,
    execGrade: del(),
    execComment: del(),
    execConfirmedBy: del(),
    execConfirmedAt: del(),
    updatedAt: serverTimestamp(),
  });
  if (ie.execGrade) {
    createAuditLog({
      action: 'EVAL_GRADE_CHANGE',
      actorId: ie.execConfirmedBy ?? 'unknown',
      actorName: ie.execConfirmedBy ?? 'unknown',
      targetId: ie.userId,
      targetName: '',
      details: `${ie.cycleYear}년 평가 / 임원 확정 무효화 (execGrade: ${ie.execGrade} → ∅)`,
    }).catch(err => console.warn('[D-3 audit] clearExecConfirmation 실패:', err));
  }
}

// ─── 1on1 ─────────────────────────────────────
function mapOneOnOne(id: string, d: DocumentData): OneOnOne {
  return {
    ...d, id,
    hiddenFor: (d.hiddenFor as string[] | undefined) ?? [],
    lastMessageAt: fromTimestamp(d.lastMessageAt),
    createdAt: fromTimestamp(d.createdAt) ?? new Date(),
    updatedAt: fromTimestamp(d.updatedAt) ?? new Date(),
  } as OneOnOne;
}

/** 본인 화면에서만 1on1 대화방 숨김 (상대방은 별도 처리). 데이터는 보존됨 */
export async function hideOneOnOneForUser(oneOnOneId: string, userId: string) {
  await updateDoc(doc(db, COLLECTIONS.ONE_ON_ONES, oneOnOneId), {
    hiddenFor: arrayUnion(userId),
    updatedAt: serverTimestamp(),
  });
}

export async function createOneOnOne(data: Omit<OneOnOne, 'id' | 'createdAt' | 'updatedAt'>) {
  const ref = await addDoc(collection(db, COLLECTIONS.ONE_ON_ONES), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateOneOnOne(id: string, data: Partial<OneOnOne>) {
  await updateDoc(doc(db, COLLECTIONS.ONE_ON_ONES, id), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

export async function getOneOnOnesByMember(memberId: string): Promise<OneOnOne[]> {
  const snap = await getDocs(query(
    collection(db, COLLECTIONS.ONE_ON_ONES),
    where('memberId', '==', memberId),
  ));
  return snap.docs.map(d => mapOneOnOne(d.id, d.data()))
    // 본인 화면에서 숨김 처리한 대화방은 제외
    .filter(o => !(o.hiddenFor ?? []).includes(memberId))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export async function getOneOnOnesByLeader(leaderId: string): Promise<OneOnOne[]> {
  const snap = await getDocs(query(
    collection(db, COLLECTIONS.ONE_ON_ONES),
    where('leaderId', '==', leaderId),
  ));
  return snap.docs.map(d => mapOneOnOne(d.id, d.data()))
    // 본인 화면에서 숨김 처리한 대화방은 제외
    .filter(o => !(o.hiddenFor ?? []).includes(leaderId))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/**
 * 사용자가 참여한 모든 1on1 (leader/member 양방향 병합).
 * 역할(role) 무관하게 시작한 쪽·받는 쪽 모두 표시 — 대시보드·목록 공통 사용.
 */
export async function getOneOnOnesForUser(userId: string): Promise<OneOnOne[]> {
  const [asLeader, asMember] = await Promise.all([
    getOneOnOnesByLeader(userId),
    getOneOnOnesByMember(userId),
  ]);
  const map = new Map<string, OneOnOne>();
  [...asLeader, ...asMember].forEach(r => map.set(r.id, r));
  return Array.from(map.values())
    .sort((a, b) => {
      const ta = a.lastMessageAt ?? a.createdAt;
      const tb = b.lastMessageAt ?? b.createdAt;
      return tb.getTime() - ta.getTime();
    });
}

export async function getOneOnOne(id: string): Promise<OneOnOne | null> {
  const snap = await getDoc(doc(db, COLLECTIONS.ONE_ON_ONES, id));
  if (!snap.exists()) return null;
  return mapOneOnOne(snap.id, snap.data());
}

// ─── 1on1 Q&A (서브컬렉션) ────────────────────
function questionsRef(oneOnOneId: string) {
  return collection(doc(db, COLLECTIONS.ONE_ON_ONES, oneOnOneId), COLLECTIONS.ONE_ON_ONE_QUESTIONS);
}

export async function addOneOnOneQuestion(
  oneOnOneId: string,
  data: { askerId: string; question: string }
) {
  await addDoc(questionsRef(oneOnOneId), { ...data, createdAt: serverTimestamp() });
  await updateDoc(doc(db, COLLECTIONS.ONE_ON_ONES, oneOnOneId), {
    lastMessageAt: serverTimestamp(),
    lastMessagePreview: `Q: ${data.question.slice(0, 50)}`,
    updatedAt: serverTimestamp(),
  });
}

export async function answerOneOnOneQuestion(
  oneOnOneId: string,
  questionId: string,
  data: { answer: string; answeredBy: string }
) {
  await updateDoc(doc(questionsRef(oneOnOneId), questionId), {
    ...data,
    answeredAt: serverTimestamp(),
  });
  await updateDoc(doc(db, COLLECTIONS.ONE_ON_ONES, oneOnOneId), {
    lastMessageAt: serverTimestamp(),
    lastMessagePreview: `A: ${data.answer.slice(0, 50)}`,
    updatedAt: serverTimestamp(),
  });
}

export async function getOneOnOneQuestions(oneOnOneId: string): Promise<OneOnOneQuestion[]> {
  const snap = await getDocs(query(questionsRef(oneOnOneId), orderBy('createdAt', 'asc')));
  return snap.docs.map(d => ({
    ...d.data(),
    id: d.id,
    answeredAt: fromTimestamp(d.data().answeredAt),
    createdAt: fromTimestamp(d.data().createdAt) ?? new Date(),
  } as OneOnOneQuestion));
}

/**
 * 1on1 질문·답변 삭제 (본인에게만 숨김 처리)
 * 상대방은 영향 없음 — 본인이 별도로 삭제해야 함
 */
export async function deleteOneOnOneQuestion(
  oneOnOneId: string,
  questionId: string,
  userId: string,
) {
  await updateDoc(doc(questionsRef(oneOnOneId), questionId), {
    hiddenFor: arrayUnion(userId),
  });
}

// ─── 조직 평가 ────────────────────────────────
export async function getOrgEvaluations(year: number): Promise<OrganizationEvaluation[]> {
  const snap = await getDocs(query(
    collection(db, COLLECTIONS.ORG_EVALUATIONS),
    where('cycleYear', '==', year),
  ));
  return snap.docs.map(d => ({
    ...d.data(), id: d.id,
    createdAt: fromTimestamp(d.data().createdAt) ?? new Date(),
    updatedAt: fromTimestamp(d.data().updatedAt) ?? new Date(),
    approvedAt: fromTimestamp(d.data().approvedAt),
  } as OrganizationEvaluation)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export async function upsertOrgEvaluation(
  orgId: string, year: number,
  data: Partial<OrganizationEvaluation>
) {
  const snap = await getDocs(query(
    collection(db, COLLECTIONS.ORG_EVALUATIONS),
    where('organizationId', '==', orgId),
    where('cycleYear', '==', year)
  ));
  if (!snap.empty) {
    await updateDoc(doc(db, COLLECTIONS.ORG_EVALUATIONS, snap.docs[0].id), {
      ...data, updatedAt: serverTimestamp(),
    });
    return snap.docs[0].id;
  }
  const ref = await addDoc(collection(db, COLLECTIONS.ORG_EVALUATIONS), {
    organizationId: orgId, cycleYear: year,
    status: 'DRAFT', ...data,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateOrgEvaluation(id: string, data: Partial<OrganizationEvaluation>) {
  const updateData: DocumentData = { ...data, updatedAt: serverTimestamp() };
  if (data.approvedAt) updateData.approvedAt = Timestamp.fromDate(data.approvedAt);
  await updateDoc(doc(db, COLLECTIONS.ORG_EVALUATIONS, id), updateData);
}

export async function getIndividualEvaluationsByOrg(orgId: string, year: number): Promise<IndividualEvaluation[]> {
  if (USE_EVAL_READ_PROXY) {
    return proxyReadIndividualEvals({ mode: 'org', orgId, year });
  }
  const snap = await getDocs(query(
    collection(db, COLLECTIONS.INDIVIDUAL_EVALUATIONS),
    where('organizationId', '==', orgId),
    where('cycleYear', '==', year)
  ));
  return snap.docs.map(d => mapIndividualEval(d.id, d.data()));
}

export async function getGradeQuotas() {
  const snap = await getDocs(collection(db, COLLECTIONS.GRADE_QUOTAS));
  return snap.docs.map(d => ({ ...d.data(), id: d.id }));
}

// ─── 평가 사이클 ──────────────────────────────
// v0.75: evaluationPeriods 컬렉션과 통합. 평가기간 관리에서 설정한 startDate/endDate 를
//        evalStartDate/evalEndDate 로 매핑하여 반환.
// v0.76: 인자로 연도를 받으면 해당 연도의 cycle 을 직접 조회한다 (activeYear 와 항상 일치 보장).
//        인자 미지정 시 기존 동작 — 미공개(active) 우선, 그 후 연도 내림차순.
export async function getActiveCycle(year?: number): Promise<EvaluationCycle | null> {
  // 연도가 명시되면 해당 doc 만 직접 조회 — 연도 전환·재지정 시 안내문이 활성 연도와 어긋나지 않도록
  if (typeof year === 'number') {
    const docRef = doc(db, 'evaluationPeriods', `${year}`);
    const single = await getDoc(docRef);
    if (!single.exists()) return null;
    const d = single.data() as any;
    return {
      id: single.id,
      year: d.year ?? year,
      evalStartDate: fromTimestamp(d.startDate) ?? new Date(),
      evalEndDate: fromTimestamp(d.endDate) ?? new Date(),
      isActive: !d.isPublished,
      createdAt: fromTimestamp(d.updatedAt) ?? new Date(),
    } as EvaluationCycle;
  }

  const snap = await getDocs(collection(db, 'evaluationPeriods'));
  if (snap.empty) return null;
  const docs = snap.docs.map(d => ({ id: d.id, ...d.data() } as any))
    .sort((a, b) => {
      const aActive = !a.isPublished ? 1 : 0;
      const bActive = !b.isPublished ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      return (b.year ?? 0) - (a.year ?? 0);
    });
  const d = docs[0];
  return {
    id: d.id,
    year: d.year,
    evalStartDate: fromTimestamp(d.startDate) ?? new Date(),
    evalEndDate: fromTimestamp(d.endDate) ?? new Date(),
    isActive: !d.isPublished,
    createdAt: fromTimestamp(d.updatedAt) ?? new Date(),
  } as EvaluationCycle;
}

// ─── 마일리지 ─────────────────────────────────
function mapMileage(id: string, data: DocumentData): Mileage {
  // entries 안의 createdAt 도 Timestamp → Date 변환
  const entries = Array.isArray(data.entries)
    ? data.entries.map((e: any) => ({
        ...e,
        createdAt: fromTimestamp(e.createdAt) ?? new Date(),
      }))
    : undefined;
  return {
    ...data,
    id,
    ...(entries ? { entries } : {}),
    updatedAt: fromTimestamp(data.updatedAt) ?? new Date(),
  } as Mileage;
}

export async function getMileage(userId: string): Promise<Mileage | null> {
  const snap = await getDoc(doc(db, COLLECTIONS.MILEAGES, userId));
  if (!snap.exists()) return null;
  return mapMileage(snap.id, snap.data());
}

export async function setMileage(userId: string, data: Omit<Mileage, 'id' | 'updatedAt'>) {
  const { memo, entries, ...rest } = data;
  // entries 의 Date → Timestamp 변환
  const entriesForFirestore = entries
    ? entries.map(e => ({ ...e, createdAt: Timestamp.fromDate(new Date(e.createdAt)) }))
    : undefined;
  await setDoc(doc(db, COLLECTIONS.MILEAGES, userId), {
    ...rest,
    ...(memo !== undefined ? { memo } : {}),
    ...(entriesForFirestore !== undefined ? { entries: entriesForFirestore } : {}),
    updatedAt: serverTimestamp(),
  });
}

export async function getAllMileages(): Promise<Mileage[]> {
  const snap = await getDocs(collection(db, COLLECTIONS.MILEAGES));
  return snap.docs.map(d => mapMileage(d.id, d.data()));
}

// ─── 연간 목표 ────────────────────────────────
function annualGoalDocId(type: 'company' | 'org', year: number, orgId?: string) {
  return type === 'company' ? `company_${year}` : `org_${orgId}_${year}`;
}

function mapAnnualGoal(id: string, d: DocumentData): AnnualGoal {
  return { ...d, id, updatedAt: fromTimestamp(d.updatedAt) ?? new Date() } as AnnualGoal;
}

export async function getAnnualGoal(type: 'company' | 'org', year: number, orgId?: string): Promise<AnnualGoal | null> {
  const snap = await getDoc(doc(db, COLLECTIONS.ANNUAL_GOALS, annualGoalDocId(type, year, orgId)));
  if (!snap.exists()) return null;
  return mapAnnualGoal(snap.id, snap.data());
}

export async function setAnnualGoal(
  type: 'company' | 'org',
  year: number,
  data: {
    content?: string;
    /** v0.9+ : subject/detail. 구버전 호환을 위해 content 도 받음 */
    items?: { id: string; subject?: string; detail?: string; content?: string }[];
    updatedBy: string;
    organizationId?: string;
  }
) {
  const id = annualGoalDocId(type, year, data.organizationId);
  // items → content 합성 (구버전 단일 텍스트 호환). subject 우선, 없으면 content.
  function itemText(i: { subject?: string; detail?: string; content?: string }): string {
    const head = i.subject ?? i.content ?? '';
    const body = i.detail ?? '';
    return [head, body].filter(s => s && s.trim()).join('\n');
  }
  const content = data.content ?? (data.items && data.items.length > 0
    ? data.items.map(itemText).filter(Boolean).join('\n\n')
    : '');
  await setDoc(doc(db, COLLECTIONS.ANNUAL_GOALS, id), {
    type, year,
    ...(data.organizationId ? { organizationId: data.organizationId } : {}),
    content,
    ...(data.items !== undefined ? { items: data.items } : {}),
    updatedBy: data.updatedBy,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function getAllOrgAnnualGoals(year: number): Promise<AnnualGoal[]> {
  const snap = await getDocs(query(
    collection(db, COLLECTIONS.ANNUAL_GOALS),
    where('type', '==', 'org'),
    where('year', '==', year)
  ));
  return snap.docs.map(d => mapAnnualGoal(d.id, d.data()));
}

// ─── 초대 ──────────────────────────────────────
export async function createInvitation(data: Omit<Invitation, 'id' | 'createdAt' | 'expiresAt'>) {
  const token = crypto.randomUUID();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7); // 7일 유효
  await setDoc(doc(db, COLLECTIONS.INVITATIONS, token), {
    ...data,
    expiresAt: Timestamp.fromDate(expiresAt),
    createdAt: serverTimestamp(),
  });
  return token;
}

export async function getInvitation(token: string): Promise<Invitation | null> {
  const snap = await getDoc(doc(db, COLLECTIONS.INVITATIONS, token));
  if (!snap.exists()) return null;
  const d = snap.data();
  return {
    ...d,
    id: snap.id,
    expiresAt: fromTimestamp(d.expiresAt) ?? new Date(),
    usedAt: fromTimestamp(d.usedAt),
    createdAt: fromTimestamp(d.createdAt) ?? new Date(),
  } as Invitation;
}

export async function markInvitationUsed(token: string, uid: string) {
  await updateDoc(doc(db, COLLECTIONS.INVITATIONS, token), {
    usedAt: serverTimestamp(),
    userId: uid,
  });
}

// ─── 부문/공장 등급 이력 ──────────────────────
export async function addOrgGradeHistory(
  organizationId: string,
  cycleYear: number,
  grade: EvaluationGrade,
  previousGrade: EvaluationGrade | undefined,
  assignedBy: string,
  comment?: string
) {
  await addDoc(collection(db, COLLECTIONS.ORG_GRADE_HISTORIES), {
    organizationId,
    cycleYear,
    grade,
    ...(previousGrade ? { previousGrade } : {}),
    assignedBy,
    ...(comment ? { comment } : {}),
    createdAt: serverTimestamp(),
  });
}

export async function getOrgGradeHistories(organizationId: string, cycleYear: number): Promise<OrgGradeHistory[]> {
  const snap = await getDocs(query(
    collection(db, COLLECTIONS.ORG_GRADE_HISTORIES),
    where('organizationId', '==', organizationId),
    where('cycleYear', '==', cycleYear),
    orderBy('createdAt', 'desc')
  ));
  return snap.docs.map(d => ({
    ...d.data(),
    id: d.id,
    createdAt: fromTimestamp(d.data().createdAt) ?? new Date(),
  } as OrgGradeHistory));
}

// ─── 부문/공장별 개인 등급 쿼터 ──────────────
function divisionQuotaDocId(organizationId: string, cycleYear: number) {
  return `${organizationId}_${cycleYear}`;
}

export async function getDivisionGradeQuota(organizationId: string, cycleYear: number): Promise<DivisionGradeQuota | null> {
  const snap = await getDoc(doc(db, COLLECTIONS.DIVISION_GRADE_QUOTAS, divisionQuotaDocId(organizationId, cycleYear)));
  if (!snap.exists()) return null;
  const d = snap.data();
  return {
    ...d,
    id: snap.id,
    updatedAt: fromTimestamp(d.updatedAt) ?? new Date(),
    confirmedAt: fromTimestamp(d.confirmedAt),
  } as DivisionGradeQuota;
}

export async function upsertDivisionGradeQuota(
  organizationId: string,
  cycleYear: number,
  data: Omit<DivisionGradeQuota, 'id' | 'organizationId' | 'cycleYear' | 'updatedAt' | 'confirmedAt'> & { confirmedAt?: Date }
) {
  const id = divisionQuotaDocId(organizationId, cycleYear);
  await setDoc(doc(db, COLLECTIONS.DIVISION_GRADE_QUOTAS, id), {
    organizationId,
    cycleYear,
    ...data,
    updatedAt: serverTimestamp(),
    ...(data.confirmedAt ? { confirmedAt: Timestamp.fromDate(data.confirmedAt) } : {}),
  });
}

export async function getAllDivisionGradeQuotas(cycleYear: number): Promise<DivisionGradeQuota[]> {
  const snap = await getDocs(query(
    collection(db, COLLECTIONS.DIVISION_GRADE_QUOTAS),
    where('cycleYear', '==', cycleYear)
  ));
  return snap.docs.map(d => ({
    ...d.data(),
    id: d.id,
    updatedAt: fromTimestamp(d.data().updatedAt) ?? new Date(),
    confirmedAt: fromTimestamp(d.data().confirmedAt),
  } as DivisionGradeQuota));
}

// ─── 연말 인사평가 (YearEndEval) ──────────────
function yearEndEvalDocId(userId: string, year: number) {
  return `${userId}_${year}`;
}

export async function getYearEndEval(userId: string, year: number): Promise<YearEndEval | null> {
  if (USE_EVAL_READ_PROXY) {
    const docs = await proxyReadForms('yearEndEvals', { mode: 'single', userId, year });
    return docs[0] ? reviveYearEndEval(docs[0]) : null;
  }
  const snap = await getDoc(doc(db, COLLECTIONS.YEAR_END_EVALS, yearEndEvalDocId(userId, year)));
  if (!snap.exists()) return null;
  const d = snap.data();
  return {
    ...d,
    id: snap.id,
    submittedAt: fromTimestamp(d.submittedAt),
    createdAt: fromTimestamp(d.createdAt) ?? new Date(),
    updatedAt: fromTimestamp(d.updatedAt) ?? new Date(),
  } as YearEndEval;
}

export async function upsertYearEndEval(
  userId: string,
  year: number,
  data: Omit<YearEndEval, 'id' | 'createdAt' | 'updatedAt'>
) {
  const id = yearEndEvalDocId(userId, year);
  const ref = doc(db, COLLECTIONS.YEAR_END_EVALS, id);
  const existing = await getDoc(ref);
  // viewableBy 자동 계산 — data.organizationId 우선, 없으면 본인 user.organizationId
  let orgIdForAcl = data.organizationId;
  if (!orgIdForAcl) {
    const me = await getUser(userId);
    orgIdForAcl = me?.organizationId ?? '';
  }
  const viewableBy = orgIdForAcl ? await computeViewableBy(userId, orgIdForAcl) : [userId];

  if (existing.exists()) {
    await updateDoc(ref, { ...data, viewableBy, updatedAt: serverTimestamp() });
  } else {
    await setDoc(ref, { ...data, viewableBy, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  }
}

// ─── 육성면담서 ────────────────────────────────
function mentoringDocId(userId: string, year: number) {
  return `${userId}_${year}`;
}

export async function getMentoringForm(userId: string, year: number): Promise<MentoringForm | null> {
  if (USE_EVAL_READ_PROXY) {
    const docs = await proxyReadForms('mentoringForms', { mode: 'single', userId, year });
    return docs[0] ? reviveMentoringForm(docs[0]) : null;
  }
  const snap = await getDoc(doc(db, COLLECTIONS.MENTORING_FORMS, mentoringDocId(userId, year)));
  if (!snap.exists()) return null;
  const d = snap.data();
  return {
    ...d,
    id: snap.id,
    submittedAt: fromTimestamp(d.submittedAt),
    editRequestedAt: fromTimestamp(d.editRequestedAt),
    editRequestApprovedAt: fromTimestamp(d.editRequestApprovedAt),
    createdAt: fromTimestamp(d.createdAt) ?? new Date(),
    updatedAt: fromTimestamp(d.updatedAt) ?? new Date(),
  } as MentoringForm;
}

// ── 육성면담서 수정 요청 워크플로 (A4) ──────────────────
/** 개인 → HR: 제출된 폼의 수정 요청. 폼은 SUBMITTED 상태 유지, editRequestPending=true */
export async function requestMentoringFormEdit(
  userId: string,
  year: number,
  reason: string,
) {
  const ref = doc(db, COLLECTIONS.MENTORING_FORMS, mentoringDocId(userId, year));
  await updateDoc(ref, {
    editRequestPending: true,
    editRequestReason: reason,
    editRequestedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/** 개인이 자신의 수정 요청 회수 (HR 처리 전) */
export async function withdrawMentoringFormEditRequest(userId: string, year: number) {
  const ref = doc(db, COLLECTIONS.MENTORING_FORMS, mentoringDocId(userId, year));
  const { deleteField: del } = await import('firebase/firestore');
  await updateDoc(ref, {
    editRequestPending: false,
    editRequestReason: del(),
    editRequestedAt: del(),
    updatedAt: serverTimestamp(),
  });
}

/** HR → 개인: 수정 허가 → 폼을 DRAFT 로 되돌림, 요청 필드 초기화 */
export async function approveMentoringFormEdit(
  userId: string,
  year: number,
  hrUserId: string,
) {
  const ref = doc(db, COLLECTIONS.MENTORING_FORMS, mentoringDocId(userId, year));
  const { deleteField: del } = await import('firebase/firestore');
  await updateDoc(ref, {
    status: 'DRAFT',
    editRequestPending: false,
    editRequestReason: del(),
    editRequestedAt: del(),
    editRequestApprovedBy: hrUserId,
    editRequestApprovedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/** HR → 개인: 수정 거절 → 폼은 SUBMITTED 유지, 요청 필드만 초기화 */
export async function rejectMentoringFormEdit(userId: string, year: number) {
  const ref = doc(db, COLLECTIONS.MENTORING_FORMS, mentoringDocId(userId, year));
  const { deleteField: del } = await import('firebase/firestore');
  await updateDoc(ref, {
    editRequestPending: false,
    editRequestReason: del(),
    editRequestedAt: del(),
    updatedAt: serverTimestamp(),
  });
}

// ── 자기평가 수정요청 (육성면담서와 동일 로직: 개인 → HR, 확정 전까지 수정 허가받아 재개방) ──
/** 개인 → HR: 자기평가 수정 요청 (SUBMITTED 잠금 유지, 요청 플래그만 ON) */
export async function requestSelfEvalEdit(userId: string, year: number, reason: string) {
  const ref = doc(db, COLLECTIONS.SELF_EVALUATIONS, selfEvalDocId(userId, year));
  await updateDoc(ref, {
    editRequestPending: true,
    editRequestReason: reason,
    editRequestedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/** 개인이 자신의 수정 요청 회수 (HR 처리 전) */
export async function withdrawSelfEvalEditRequest(userId: string, year: number) {
  const ref = doc(db, COLLECTIONS.SELF_EVALUATIONS, selfEvalDocId(userId, year));
  const { deleteField: del } = await import('firebase/firestore');
  await updateDoc(ref, {
    editRequestPending: false,
    editRequestReason: del(),
    editRequestedAt: del(),
    updatedAt: serverTimestamp(),
  });
}

/** HR → 개인: 수정 허가 → 자기평가를 DRAFT 로 되돌림, 요청 필드 초기화 */
export async function approveSelfEvalEdit(userId: string, year: number, hrUserId: string) {
  const ref = doc(db, COLLECTIONS.SELF_EVALUATIONS, selfEvalDocId(userId, year));
  const { deleteField: del } = await import('firebase/firestore');
  await updateDoc(ref, {
    status: 'DRAFT',
    editRequestPending: false,
    editRequestReason: del(),
    editRequestedAt: del(),
    editRequestApprovedBy: hrUserId,
    editRequestApprovedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/** HR → 개인: 수정 거절 → SUBMITTED 유지, 요청 필드만 초기화 */
export async function rejectSelfEvalEdit(userId: string, year: number) {
  const ref = doc(db, COLLECTIONS.SELF_EVALUATIONS, selfEvalDocId(userId, year));
  const { deleteField: del } = await import('firebase/firestore');
  await updateDoc(ref, {
    editRequestPending: false,
    editRequestReason: del(),
    editRequestedAt: del(),
    updatedAt: serverTimestamp(),
  });
}

/** HR 관리자 (isHrAdmin === true) 목록 */
export async function getHrAdmins(): Promise<User[]> {
  const snap = await getDocs(query(
    collection(db, COLLECTIONS.USERS),
    where('isHrAdmin', '==', true),
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as User)).filter(u => u.isActive !== false);
}

export async function upsertMentoringForm(
  userId: string,
  year: number,
  data: Omit<MentoringForm, 'id' | 'createdAt' | 'updatedAt'>
) {
  const id = mentoringDocId(userId, year);
  const ref = doc(db, COLLECTIONS.MENTORING_FORMS, id);
  const existing = await getDoc(ref);
  // viewableBy 자동 계산
  let orgIdForAcl = data.organizationId;
  if (!orgIdForAcl) {
    const me = await getUser(userId);
    orgIdForAcl = me?.organizationId ?? '';
  }
  const viewableBy = orgIdForAcl ? await computeViewableBy(userId, orgIdForAcl) : [userId];

  if (existing.exists()) {
    await updateDoc(ref, { ...data, viewableBy, updatedAt: serverTimestamp() });
  } else {
    await setDoc(ref, { ...data, viewableBy, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  }
}

export async function getMentoringFormsByUsers(userIds: string[], year: number): Promise<MentoringForm[]> {
  if (userIds.length === 0) return [];
  if (USE_EVAL_READ_PROXY) {
    const docs = await proxyReadForms('mentoringForms', { mode: 'byUsers', userIds, year });
    return docs.map(reviveMentoringForm);
  }
  const results = await Promise.all(
    userIds.map(uid => getMentoringForm(uid, year))
  );
  return results.filter((f): f is MentoringForm => f !== null);
}

// ─── 공지사항 ──────────────────────────────────
function mapAnnouncement(id: string, d: DocumentData): Announcement {
  return {
    ...d,
    id,
    isPinned: d.isPinned ?? false,
    expiresAt: fromTimestamp(d.expiresAt),
    createdAt: fromTimestamp(d.createdAt) ?? new Date(),
    updatedAt: fromTimestamp(d.updatedAt) ?? new Date(),
  } as Announcement;
}

export async function getAnnouncements(): Promise<Announcement[]> {
  const snap = await getDocs(query(
    collection(db, COLLECTIONS.ANNOUNCEMENTS),
    orderBy('createdAt', 'desc'),
  ));
  const items = snap.docs.map(d => mapAnnouncement(d.id, d.data()));
  // 게시 종료일 지난 항목 자동 삭제 (lazy cleanup) — 백그라운드로
  const now = new Date();
  const expired = items.filter(a => a.expiresAt && a.expiresAt.getTime() <= now.getTime());
  if (expired.length > 0) {
    Promise.all(expired.map(a => deleteDoc(doc(db, COLLECTIONS.ANNOUNCEMENTS, a.id))))
      .catch(err => console.error('[공지사항 만료 자동삭제] 실패:', err));
  }
  const active = items.filter(a => !a.expiresAt || a.expiresAt.getTime() > now.getTime());
  // isPinned true 먼저, 그 다음 최신순
  return active.sort((a, b) => {
    if (a.isPinned === b.isPinned) return b.createdAt.getTime() - a.createdAt.getTime();
    return a.isPinned ? -1 : 1;
  });
}

export async function createAnnouncement(data: Omit<Announcement, 'id' | 'createdAt' | 'updatedAt'>) {
  const payload: any = { ...data };
  if (data.expiresAt instanceof Date) payload.expiresAt = Timestamp.fromDate(data.expiresAt);
  const ref = await addDoc(collection(db, COLLECTIONS.ANNOUNCEMENTS), {
    ...payload,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateAnnouncement(id: string, data: Partial<Omit<Announcement, 'id' | 'createdAt' | 'updatedAt'>>) {
  const { deleteField } = await import('firebase/firestore');
  const payload: any = { ...data };
  if (data.expiresAt instanceof Date) payload.expiresAt = Timestamp.fromDate(data.expiresAt);
  else if ('expiresAt' in data && data.expiresAt === undefined) payload.expiresAt = deleteField();
  await updateDoc(doc(db, COLLECTIONS.ANNOUNCEMENTS, id), {
    ...payload,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteAnnouncement(id: string) {
  await deleteDoc(doc(db, COLLECTIONS.ANNOUNCEMENTS, id));
}

// ─── 포상 이력 ────────────────────────────────
export async function getAwardsByUser(userId: string): Promise<Award[]> {
  const snap = await getDocs(query(
    collection(db, COLLECTIONS.AWARDS),
    where('userId', '==', userId),
    orderBy('awardDate', 'desc'),
  ));
  return snap.docs.map(d => ({
    ...d.data(),
    id: d.id,
    createdAt: fromTimestamp(d.data().createdAt) ?? new Date(),
    updatedAt: fromTimestamp(d.data().updatedAt) ?? new Date(),
  } as Award));
}

/** 전체 포상 이력 — 전사 인원현황 등 대량 조회용. awardDate 내림차순 정렬. */
export async function getAllAwards(): Promise<Award[]> {
  const snap = await getDocs(query(
    collection(db, COLLECTIONS.AWARDS),
    orderBy('awardDate', 'desc'),
  ));
  return snap.docs.map(d => ({
    ...d.data(),
    id: d.id,
    createdAt: fromTimestamp(d.data().createdAt) ?? new Date(),
    updatedAt: fromTimestamp(d.data().updatedAt) ?? new Date(),
  } as Award));
}

/** 연도 범위로 포상 이력 조회 (awardDate 가 YYYY-MM-DD 문자열) */
export async function getAwardsByYearRange(startYear: number, endYear: number): Promise<Award[]> {
  const snap = await getDocs(query(
    collection(db, COLLECTIONS.AWARDS),
    where('awardDate', '>=', `${startYear}-01-01`),
    where('awardDate', '<=', `${endYear}-12-31`),
    orderBy('awardDate', 'desc'),
  ));
  return snap.docs.map(d => ({
    ...d.data(),
    id: d.id,
    createdAt: fromTimestamp(d.data().createdAt) ?? new Date(),
    updatedAt: fromTimestamp(d.data().updatedAt) ?? new Date(),
  } as Award));
}

/** 특정 연도의 모든 포상 이력 조회 */
export async function getAwardsByYear(year: number): Promise<Award[]> {
  return getAwardsByYearRange(year, year);
}

export async function createAward(data: Omit<Award, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
  const ref = await addDoc(collection(db, COLLECTIONS.AWARDS), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function deleteAward(id: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTIONS.AWARDS, id));
}

// ─── 시스템 설정 ──────────────────────────────
export interface SystemSettings {
  activeYear: number;
  /** 확정(잠금)된 연도 목록 — 해당 연도 데이터는 전 화면 읽기 전용. */
  lockedYears?: number[];
  updatedBy?: string;
  updatedAt?: Date;
}

/**
 * 연도 확정(잠금) — 해당 연도의 모든 연도별 데이터를 읽기 전용으로 전환(UI 게이팅).
 * HR 관리자 이상이 호출. 잠금 해제는 unlockEvaluationYear (HR 마스터 전용 UI).
 */
export async function lockEvaluationYear(year: number, by: { id: string; name?: string }): Promise<void> {
  const cur = await getSystemSettings();
  const set = new Set(cur?.lockedYears ?? []);
  set.add(year);
  await updateSystemSettings({ lockedYears: [...set].sort((a, b) => a - b), updatedBy: by.id });
  // 경량 B — 확정 시점의 조직 트리를 그 연도로 스냅샷 저장(과거 연도 조직명·계층을 그 해 기준으로 표시).
  // 보관 조직 포함 전체를 저장(과거 이름 해석용). 재확정 시 덮어쓰기.
  try {
    const orgs = await getOrganizations();
    await setDoc(doc(db, 'orgSnapshots', String(year)), {
      year,
      orgs: orgs.map(o => ({
        id: o.id,
        name: o.name,
        parentId: o.parentId ?? null,
        leaderId: o.leaderId ?? null,
        type: o.type,
        displayOrder: o.displayOrder ?? null,
      })),
      createdBy: by.id,
      createdAt: serverTimestamp(),
    });
  } catch (e) { console.error('[연도확정] 조직 스냅샷 저장 실패:', e); }
  await createAuditLog({
    action: 'YEAR_LOCK',
    actorId: by.id,
    actorName: by.name ?? '',
    details: `${year}년 평가/데이터 확정(읽기 전용 전환) + 조직 스냅샷 저장`,
  }).catch(() => { /* 무시 */ });
}

/**
 * 확정 연도의 조직 스냅샷 조회 — 과거 연도 화면에서 그 해 조직명·계층 해석용(경량 B).
 * 스냅샷이 없으면 null (→ 호출 측은 라이브 트리로 폴백).
 */
export async function getOrgSnapshot(year: number): Promise<Organization[] | null> {
  const snap = await getDoc(doc(db, 'orgSnapshots', String(year)));
  if (!snap.exists()) return null;
  const arr = (snap.data().orgs ?? []) as Array<Partial<Organization>>;
  const now = new Date();
  return arr.map(o => ({
    id: o.id!, name: o.name ?? '', type: o.type as Organization['type'],
    parentId: o.parentId ?? null, leaderId: o.leaderId ?? null,
    displayOrder: o.displayOrder ?? undefined,
    archivedAt: null, createdAt: now, updatedAt: now,
  } as Organization));
}

/**
 * 연도-스코프 화면용 조직 목록 — 확정 연도면 그 해 스냅샷(정책 ②: 그 해 구조·이름),
 * 아니면 라이브(보관 조직 제외). 과거 연도 화면 전반의 조직명·계층 표시 일관화용.
 * ※ 등급 가시성(§6-1)은 평가 doc 의 viewableBy ACL 로 별도 보장 — 본 함수는 표시/그룹핑용.
 */
export async function getOrganizationsForYear(year: number): Promise<Organization[]> {
  const snap = await getOrgSnapshot(year);
  if (snap && snap.length > 0) return snap;
  return (await getOrganizations()).filter(o => !o.archivedAt);
}

// ─── 핵심목표 가중치 배분 변경 요청 (직속 1인 약식 승인) ───────────────
function weightReqId(userId: string, year: number) { return `${userId}_${year}`; }

function reviveWeightReq(id: string, d: DocumentData): WeightChangeRequest {
  return {
    id,
    userId: d.userId, userName: d.userName, organizationId: d.organizationId,
    cycleYear: d.cycleYear,
    before: d.before ?? {}, after: d.after ?? {}, titles: d.titles ?? {},
    status: d.status ?? 'PENDING',
    approverId: d.approverId,
    requestedAt: fromTimestamp(d.requestedAt) ?? new Date(),
    decidedBy: d.decidedBy, decidedAt: fromTimestamp(d.decidedAt) ?? undefined,
    comment: d.comment,
    createdAt: fromTimestamp(d.createdAt) ?? new Date(),
    updatedAt: fromTimestamp(d.updatedAt) ?? new Date(),
  } as WeightChangeRequest;
}

export async function getWeightChangeRequest(userId: string, year: number): Promise<WeightChangeRequest | null> {
  const snap = await getDoc(doc(db, 'weightChangeRequests', weightReqId(userId, year)));
  return snap.exists() ? reviveWeightReq(snap.id, snap.data()) : null;
}

export async function getPendingWeightChangeRequestsForApprover(approverId: string): Promise<WeightChangeRequest[]> {
  const snap = await getDocs(query(
    collection(db, 'weightChangeRequests'),
    where('approverId', '==', approverId),
    where('status', '==', 'PENDING'),
  ));
  return snap.docs.map(d => reviveWeightReq(d.id, d.data()));
}

/** 가중치 배분안 제출 — 직속 승인자에게 약식 승인 요청 (PENDING 1건, 덮어쓰기) */
export async function submitWeightChangeRequest(req: {
  userId: string; userName?: string; organizationId?: string; cycleYear: number;
  before: Record<string, number>; after: Record<string, number>; titles?: Record<string, string>;
  approverId?: string;
}): Promise<void> {
  const id = weightReqId(req.userId, req.cycleYear);
  await setDoc(doc(db, 'weightChangeRequests', id), {
    userId: req.userId, userName: req.userName ?? '', organizationId: req.organizationId ?? '',
    cycleYear: req.cycleYear,
    before: req.before, after: req.after, titles: req.titles ?? {},
    status: 'PENDING',
    approverId: req.approverId ?? null,
    requestedAt: serverTimestamp(),
    decidedBy: null, decidedAt: null, comment: null,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }, { merge: true });
  if (req.approverId) {
    await createNotification({
      userId: req.approverId,
      type: 'GOAL_COMMENT',
      category: 'GOAL',
      title: `${req.userName ?? ''}님 가중치 변경 요청`,
      message: `${req.userName ?? ''}님이 ${req.cycleYear}년 핵심목표 가중치 배분 변경을 요청했습니다.`,
      link: '/approvals',
      read: false,
    } as any).catch(() => { /* 무시 */ });
  }
}

/** 가중치 배분안 승인 — after 가중치를 각 목표에 반영 */
export async function approveWeightChangeRequest(userId: string, year: number, decidedBy: string): Promise<void> {
  const id = weightReqId(userId, year);
  const snap = await getDoc(doc(db, 'weightChangeRequests', id));
  if (!snap.exists()) throw new Error('가중치 변경 요청을 찾을 수 없습니다.');
  const req = reviveWeightReq(snap.id, snap.data());
  if (req.status !== 'PENDING') throw new Error('이미 처리된 요청입니다.');
  // after 가중치를 각 목표의 "사람별 가중치 맵(weights[userId])"에 적용 (공동 목표에서 사람마다 다른 기여도)
  await Promise.all(Object.entries(req.after).map(([goalId, w]) =>
    updateGoal(goalId, { [`weights.${req.userId}`]: w } as Partial<Goal>)
      .catch(e => console.error('[가중치 적용] 실패', goalId, e))
  ));
  await updateDoc(doc(db, 'weightChangeRequests', id), {
    status: 'APPROVED', decidedBy, decidedAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  await createNotification({
    userId: req.userId, type: 'GOAL_COMMENT', category: 'GOAL',
    title: '가중치 변경 승인됨',
    message: `${year}년 핵심목표 가중치 배분 변경이 승인되었습니다.`,
    link: '/goals', read: false,
  } as any).catch(() => {});
}

export async function rejectWeightChangeRequest(userId: string, year: number, decidedBy: string, comment?: string): Promise<void> {
  const id = weightReqId(userId, year);
  await updateDoc(doc(db, 'weightChangeRequests', id), {
    status: 'REJECTED', decidedBy, decidedAt: serverTimestamp(), comment: comment ?? null, updatedAt: serverTimestamp(),
  });
  await createNotification({
    userId, type: 'GOAL_COMMENT', category: 'GOAL',
    title: '가중치 변경 반려됨',
    message: `${year}년 핵심목표 가중치 배분 변경이 반려되었습니다.${comment ? ` (${comment})` : ''}`,
    link: '/goals', read: false,
  } as any).catch(() => {});
}

export async function unlockEvaluationYear(year: number, by: { id: string; name?: string }): Promise<void> {
  const cur = await getSystemSettings();
  const next = (cur?.lockedYears ?? []).filter(y => y !== year);
  await updateSystemSettings({ lockedYears: next, updatedBy: by.id });
  await createAuditLog({
    action: 'YEAR_UNLOCK',
    actorId: by.id,
    actorName: by.name ?? '',
    details: `${year}년 확정 해제(편집 재개방)`,
  }).catch(() => { /* 무시 */ });
}

export async function getSystemSettings(): Promise<SystemSettings | null> {
  const snap = await getDoc(doc(db, COLLECTIONS.SYSTEM_SETTINGS, 'global'));
  if (!snap.exists()) return null;
  const d = snap.data();
  return {
    activeYear: d.activeYear ?? new Date().getFullYear(),
    lockedYears: Array.isArray(d.lockedYears) ? d.lockedYears : [],
    updatedBy: d.updatedBy,
    updatedAt: d.updatedAt ? (d.updatedAt as Timestamp).toDate() : undefined,
  };
}

export async function updateSystemSettings(settings: Partial<SystemSettings> & { updatedBy: string }): Promise<void> {
  await setDoc(doc(db, COLLECTIONS.SYSTEM_SETTINGS, 'global'), {
    ...settings,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

// ─── 백업 ─────────────────────────────────────────
export interface BackupRecord {
  id: string;
  year: number;
  createdBy: string;
  createdByName?: string;
  createdAt: Date;
  /** 실제 스냅샷 JSON 의 Firebase Storage 경로 (구버전 메타데이터-only 백업은 undefined) */
  storagePath?: string;
  sizeBytes?: number;
  isAuto?: boolean;
  stats: {
    goals: number;
    users: number;
    orgEvaluations: number;
    individualEvaluations: number;
    mentoringForms: number;
    /** 전체 컬렉션별 카운트 (신규 스냅샷 백업만 채워짐) */
    all?: Record<string, number>;
  };
}

export async function getBackups(): Promise<BackupRecord[]> {
  const snap = await getDocs(query(
    collection(db, COLLECTIONS.BACKUPS),
    orderBy('createdAt', 'desc'),
  ));
  return snap.docs.map(d => {
    const data = d.data();
    return {
      id: d.id,
      year: data.year,
      createdBy: data.createdBy,
      createdByName: data.createdByName,
      isAuto: data.isAuto,
      storagePath: data.storagePath,
      sizeBytes: data.sizeBytes,
      createdAt: (data.createdAt as Timestamp).toDate(),
      stats: data.stats ?? {},
    };
  });
}

export async function createBackup(year: number, createdBy: string, stats: BackupRecord['stats']): Promise<string> {
  const ref = await addDoc(collection(db, COLLECTIONS.BACKUPS), {
    year,
    createdBy,
    stats,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function deleteBackup(id: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTIONS.BACKUPS, id));
}

// ─── 주간 업무 (v0.9 팀 공유 문서) ────────────────────────────────
// 문서 1개 = 팀(조직) × 1주차. docId = `${teamOrgId}_${year}_Wnn`.
// 각 항목(SimpleTaskItem)에 authorId/authorName 가 붙어 입력자를 표시한다.
// 레거시(개인별) 문서 `${userId}_${year}_Wnn` 와 공존하며, 평가 조회는 양쪽을 병합한다.
function weeklyTaskDocId(ownerId: string, year: number, week: number): string {
  return `${ownerId}_${year}_W${String(week).padStart(2, '0')}`;
}
// 팀 문서 id (의미 명시용 별칭 — ownerId 자리에 팀 조직 id)
const teamWeeklyDocId = weeklyTaskDocId;

function toWeeklyTask(snap: { id: string; data(): DocumentData }): WeeklyTask {
  const d = snap.data();
  // leadComments 배열 파싱 (구버전 leadComment 문자열 하위 호환)
  let leadComments: LeadCommentEntry[] = [];
  if (Array.isArray(d.leadComments)) {
    leadComments = (d.leadComments as any[]).map(c => ({
      id: c.id ?? '',
      text: c.text ?? '',
      authorId: c.authorId ?? '',
      authorName: c.authorName ?? '',
      createdAt: c.createdAt instanceof Timestamp ? c.createdAt.toDate() : new Date(c.createdAt ?? 0),
      ...(c.editedAt ? { editedAt: c.editedAt instanceof Timestamp ? c.editedAt.toDate() : new Date(c.editedAt) } : {}),
    }));
  } else if (typeof d.leadComment === 'string' && d.leadComment) {
    // 구버전 단일 문자열 → 1건 배열로 변환
    leadComments = [{ id: 'legacy', text: d.leadComment, authorId: '', authorName: '팀장', createdAt: new Date(0) }];
  }
  return {
    id: snap.id,
    userId: d.userId ?? '',
    organizationId: d.organizationId,
    teamOrgId: d.teamOrgId ?? undefined,
    year: d.year,
    weekNumber: d.weekNumber,
    weekStart: fromTimestamp(d.weekStart) ?? new Date(),
    weekEnd:   fromTimestamp(d.weekEnd)   ?? new Date(),
    items:        (d.items         ?? []) as WeeklyTaskItem[],
    hasDoneItems: (d.hasDoneItems  ?? []) as SimpleTaskItem[],
    willDoItems:  (d.willDoItems   ?? []) as SimpleTaskItem[],
    summary:      d.summary ?? '',
    leadComments,
    goalProgress: (d.goalProgress ?? {}) as Record<string, number>,
    updatedAt: fromTimestamp(d.updatedAt) ?? new Date(),
  };
}

/** 레거시 개인 문서 단건 조회 (마이그레이션·하위호환용). */
export async function getWeeklyTask(
  userId: string, year: number, week: number
): Promise<WeeklyTask | null> {
  const snap = await getDoc(doc(db, COLLECTIONS.WEEKLY_TASKS, weeklyTaskDocId(userId, year, week)));
  if (!snap.exists()) return null;
  return toWeeklyTask(snap);
}

/** 팀 공유 주간 문서 단건 조회. */
export async function getTeamWeeklyTask(
  orgId: string, year: number, week: number
): Promise<WeeklyTask | null> {
  const snap = await getDoc(doc(db, COLLECTIONS.WEEKLY_TASKS, teamWeeklyDocId(orgId, year, week)));
  if (!snap.exists()) return null;
  return toWeeklyTask(snap);
}

/** 팀 공유 주간 문서 실시간 구독 — 동시 편집 반영. unsubscribe 반환. */
export function subscribeTeamWeeklyTask(
  orgId: string, year: number, week: number,
  cb: (t: WeeklyTask | null) => void,
): () => void {
  return onSnapshot(
    doc(db, COLLECTIONS.WEEKLY_TASKS, teamWeeklyDocId(orgId, year, week)),
    snap => cb(snap.exists() ? toWeeklyTask(snap) : null),
    err => console.error('[주간 구독] 실패:', err),
  );
}

/** 팀 공유 주간 문서 저장 (본문 — hasDone/willDo/진행률). leadComments 는 merge 로 보존. */
export async function upsertTeamWeeklyTask(
  orgId: string, year: number, week: number,
  weekStart: Date, weekEnd: Date,
  hasDoneItems: SimpleTaskItem[],
  willDoItems: SimpleTaskItem[],
  goalProgress?: Record<string, number>,
): Promise<void> {
  const docId = teamWeeklyDocId(orgId, year, week);
  const payload: DocumentData = {
    userId: '', organizationId: orgId, teamOrgId: orgId, year, weekNumber: week,
    weekStart: Timestamp.fromDate(weekStart),
    weekEnd:   Timestamp.fromDate(weekEnd),
    hasDoneItems, willDoItems,
    updatedAt: serverTimestamp(),
  };
  if (goalProgress) payload.goalProgress = goalProgress;
  await setDoc(doc(db, COLLECTIONS.WEEKLY_TASKS, docId), payload, { merge: true });
}

export async function upsertWeeklyTask(
  userId: string, year: number, week: number,
  orgId: string, weekStart: Date, weekEnd: Date,
  items: WeeklyTaskItem[],
  summary = '',
): Promise<void> {
  const docId = weeklyTaskDocId(userId, year, week);
  await setDoc(doc(db, COLLECTIONS.WEEKLY_TASKS, docId), {
    userId, organizationId: orgId, year, weekNumber: week,
    weekStart: Timestamp.fromDate(weekStart),
    weekEnd:   Timestamp.fromDate(weekEnd),
    items, summary,
    updatedAt: serverTimestamp(),
  }, { merge: true });  // leadComment는 덮어쓰지 않도록 merge
}

export async function upsertWeeklyTaskSections(
  userId: string, year: number, week: number,
  orgId: string, weekStart: Date, weekEnd: Date,
  hasDoneItems: SimpleTaskItem[],
  willDoItems: SimpleTaskItem[],
  summary = '',
  goalProgress?: Record<string, number>,
): Promise<void> {
  const docId = weeklyTaskDocId(userId, year, week);
  const payload: DocumentData = {
    userId, organizationId: orgId, year, weekNumber: week,
    weekStart: Timestamp.fromDate(weekStart),
    weekEnd:   Timestamp.fromDate(weekEnd),
    hasDoneItems, willDoItems, summary,
    updatedAt: serverTimestamp(),
  };
  if (goalProgress) payload.goalProgress = goalProgress;
  await setDoc(doc(db, COLLECTIONS.WEEKLY_TASKS, docId), payload, { merge: true });
}

/**
 * 주간보고 → 핵심목표 진행률 역류.
 * 주간에 입력한 목표별 진행률(%)을 해당 Goal.progress 로 반영하고,
 * 변경된 목표에 progressUpdate(weekNumber 태그)를 1건 남긴다.
 * comment 는 그 주 해당 목표의 Has Done 요약(호출 측 전달).
 */
export async function syncWeeklyGoalProgress(params: {
  orgId: string;       // 팀 문서 소유 조직 — 공동과제(같은 조직 목표) 판정용
  actorId: string;     // 진행률을 입력/저장한 사용자 (progressUpdate 기록 주체)
  year: number;
  week: number;
  goalProgress: Record<string, number>;
  goalComments?: Record<string, string>;
}): Promise<void> {
  const { orgId, actorId, year, week, goalProgress, goalComments = {} } = params;
  const entries = Object.entries(goalProgress);
  for (const [goalId, pct] of entries) {
    if (!goalId || typeof pct !== 'number' || pct < 0 || pct > 100) continue;
    const goalSnap = await getDoc(doc(db, COLLECTIONS.GOALS, goalId));
    if (!goalSnap.exists()) continue;
    const g = goalSnap.data();
    // 공동과제: 같은 팀(조직)의 목표면 팀원 누구나 역류 허용. 또는 소유자/공동수행자.
    const allowed =
      g.organizationId === orgId ||
      g.userId === actorId ||
      (Array.isArray(g.collaboratorIds) && g.collaboratorIds.includes(actorId));
    if (!allowed) continue;
    if ((g.progress ?? 0) === pct) continue; // 변동 없으면 skip
    await updateDoc(goalSnap.ref, {
      progress: pct,
      status: g.status === 'APPROVED' ? 'IN_PROGRESS' : g.status,
      updatedAt: serverTimestamp(),
    });
    await addDoc(collection(db, COLLECTIONS.PROGRESS_UPDATES), {
      goalId, userId: actorId, progress: pct,
      comment: goalComments[goalId] ?? `${year}년 ${week}주차 주간보고`,
      weekNumber: week, weekYear: year,
      createdAt: serverTimestamp(),
    });
  }
}

export async function addLeadComment(
  ownerId: string, year: number, week: number,
  authorId: string, authorName: string, text: string
): Promise<LeadCommentEntry> {
  const docId = weeklyTaskDocId(ownerId, year, week);
  const entry = {
    id: crypto.randomUUID(),
    text,
    authorId,
    authorName,
    createdAt: Timestamp.now(),
  };
  await updateDoc(doc(db, COLLECTIONS.WEEKLY_TASKS, docId), {
    leadComments: arrayUnion(entry),
    updatedAt: serverTimestamp(),
  });
  // 반환용: createdAt을 Date로 변환
  return { ...entry, createdAt: entry.createdAt.toDate() };
}

// v0.76 A2: 팀 코멘트 수정 — 동일 commentId 의 텍스트 갱신
export async function updateLeadComment(
  ownerId: string, year: number, week: number,
  commentId: string, newText: string,
): Promise<void> {
  const docId = weeklyTaskDocId(ownerId, year, week);
  const ref = doc(db, COLLECTIONS.WEEKLY_TASKS, docId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const data = snap.data();
  const list = (data.leadComments ?? []) as any[];
  const updated = list.map(c => c.id === commentId ? { ...c, text: newText, editedAt: Timestamp.now() } : c);
  await updateDoc(ref, { leadComments: updated, updatedAt: serverTimestamp() });
}

// v0.76 A2: 팀 코멘트 삭제
export async function deleteLeadComment(
  ownerId: string, year: number, week: number,
  commentId: string,
): Promise<void> {
  const docId = weeklyTaskDocId(ownerId, year, week);
  const ref = doc(db, COLLECTIONS.WEEKLY_TASKS, docId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const data = snap.data();
  const list = (data.leadComments ?? []) as any[];
  const next = list.filter(c => c.id !== commentId);
  await updateDoc(ref, { leadComments: next, updatedAt: serverTimestamp() });
}

/** 여러 팀(조직)의 특정 주차 팀 문서 — 읽기전용 팀/조직 현황 뷰용. */
export async function getTeamWeeklyTasksByOrgsAndWeek(
  orgIds: string[], year: number, week: number
): Promise<WeeklyTask[]> {
  const ids = [...new Set(orgIds.filter(Boolean))].map(o => teamWeeklyDocId(o, year, week));
  if (!ids.length) return [];
  const snaps = await Promise.all(ids.map(id => getDoc(doc(db, COLLECTIONS.WEEKLY_TASKS, id))));
  return snaps.filter(s => s.exists()).map(s => toWeeklyTask(s));
}

type WeeklyMember = { id: string; organizationId: string };

/** 팀 문서를 멤버별 WeeklyTask[] 로 분해 — 항목을 authorId 로 귀속. 레거시 개인 문서는 미커버 (member,week)만 보강. */
function explodeTeamDocsToMembers(
  teamDocs: WeeklyTask[], legacyDocs: WeeklyTask[], members: WeeklyMember[],
): WeeklyTask[] {
  const out: WeeklyTask[] = [];
  const seen = new Set<string>(); // `${memberId}_${week}`
  for (const m of members) {
    for (const td of teamDocs) {
      if (td.organizationId !== m.organizationId) continue;
      const owns = (i: SimpleTaskItem) => (i.authorId ?? td.userId) === m.id;
      const hd = (td.hasDoneItems ?? []).filter(owns);
      const wd = (td.willDoItems ?? []).filter(owns);
      if (hd.length === 0 && wd.length === 0) continue;
      out.push({ ...td, id: weeklyTaskDocId(m.id, td.year, td.weekNumber), userId: m.id, hasDoneItems: hd, willDoItems: wd, summary: '' });
      seen.add(`${m.id}_${td.weekNumber}`);
    }
  }
  // 레거시 개인 문서 — 팀 문서로 커버되지 않은 (member,week) 만 보강
  const memberIds = new Set(members.map(m => m.id));
  for (const ld of legacyDocs) {
    if (!ld.userId || !memberIds.has(ld.userId)) continue;
    if (seen.has(`${ld.userId}_${ld.weekNumber}`)) continue;
    out.push(ld);
    seen.add(`${ld.userId}_${ld.weekNumber}`);
  }
  return out.sort((a, b) => a.weekNumber - b.weekNumber);
}

/** 멤버들의 연간 주간실적 — 팀 문서(authorId 귀속) + 레거시 개인 문서 병합. 평가/AI 조회용. */
export async function getWeeklyTasksByMembersAndYear(
  members: WeeklyMember[], year: number
): Promise<WeeklyTask[]> {
  if (!members.length) return [];
  const orgIds = [...new Set(members.map(m => m.organizationId).filter(Boolean))];
  const memberIds = members.map(m => m.id);
  // 팀 문서: orgId × 1..53 직접 조회(인덱스 불필요)
  const teamIds: string[] = [];
  for (const o of orgIds) for (let w = 1; w <= 53; w++) teamIds.push(teamWeeklyDocId(o, year, w));
  const teamSnapsP = Promise.all(teamIds.map(id => getDoc(doc(db, COLLECTIONS.WEEKLY_TASKS, id))));
  // 레거시 개인 문서: userId in chunk && year
  const chunks: string[][] = [];
  for (let i = 0; i < memberIds.length; i += 30) chunks.push(memberIds.slice(i, i + 30));
  const legacyP = Promise.all(chunks.map(chunk =>
    getDocs(query(
      collection(db, COLLECTIONS.WEEKLY_TASKS),
      where('userId', 'in', chunk),
      where('year', '==', year),
    ))
  ));
  const [teamSnaps, legacyResults] = await Promise.all([teamSnapsP, legacyP]);
  const teamDocs = teamSnaps.filter(s => s.exists()).map(s => toWeeklyTask(s)).filter(t => !!t.teamOrgId);
  const legacyDocs = legacyResults.flatMap(snap => snap.docs.map(d => toWeeklyTask(d))).filter(t => !t.teamOrgId);
  return explodeTeamDocsToMembers(teamDocs, legacyDocs, members);
}

/**
 * 마이그레이션 — 해당 연도의 레거시 개인별 주간문서를 팀(조직) 문서로 병합.
 * 각 항목에 authorId/authorName 주입, goalProgress·leadComments 병합. 기존 개인 문서는 삭제하지 않음.
 * 반환: { teamDocs, sourceDocs } 처리 건수.
 */
export async function migrateWeeklyTasksToTeamDocs(
  year: number
): Promise<{ teamDocs: number; sourceDocs: number }> {
  const [snap, allUsers] = await Promise.all([
    getDocs(query(collection(db, COLLECTIONS.WEEKLY_TASKS), where('year', '==', year))),
    getAllUsers(),
  ]);
  const nameById = new Map(allUsers.map(u => [u.id, u.name]));
  // 레거시 개인 문서만 (teamOrgId 없음 + userId 있음)
  const legacy = snap.docs.map(d => toWeeklyTask(d)).filter(t => !t.teamOrgId && !!t.userId);
  // (orgId, week) 그룹핑
  const groups = new Map<string, WeeklyTask[]>();
  for (const t of legacy) {
    if (!t.organizationId) continue;
    const key = `${t.organizationId}__${t.weekNumber}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(t);
  }
  let teamDocs = 0;
  for (const [key, docs] of groups) {
    const [orgId, weekStr] = key.split('__');
    const week = Number(weekStr);
    const stamp = (i: SimpleTaskItem, uid: string): SimpleTaskItem =>
      ({ ...i, authorId: i.authorId ?? uid, authorName: i.authorName ?? nameById.get(uid) ?? '' });
    const hasDoneItems = docs.flatMap(d => (d.hasDoneItems ?? []).map(i => stamp(i, d.userId)));
    const willDoItems  = docs.flatMap(d => (d.willDoItems  ?? []).map(i => stamp(i, d.userId)));
    const goalProgress: Record<string, number> = {};
    for (const d of docs) for (const [g, p] of Object.entries(d.goalProgress ?? {})) goalProgress[g] = p;
    const leadCommentsRaw = docs.flatMap(d => d.leadComments ?? []);
    const seenC = new Set<string>();
    const leadComments = leadCommentsRaw
      .filter(c => (c.id && !seenC.has(c.id)) ? (seenC.add(c.id), true) : false)
      .map(c => ({
        id: c.id, text: c.text, authorId: c.authorId, authorName: c.authorName,
        createdAt: Timestamp.fromDate(c.createdAt instanceof Date ? c.createdAt : new Date(c.createdAt ?? 0)),
        ...(c.editedAt ? { editedAt: Timestamp.fromDate(c.editedAt as Date) } : {}),
      }));
    const ref = doc(db, COLLECTIONS.WEEKLY_TASKS, teamWeeklyDocId(orgId, year, week));
    await setDoc(ref, {
      userId: '', organizationId: orgId, teamOrgId: orgId, year, weekNumber: week,
      weekStart: Timestamp.fromDate(docs[0].weekStart),
      weekEnd:   Timestamp.fromDate(docs[0].weekEnd),
      hasDoneItems, willDoItems, goalProgress, leadComments,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    teamDocs += 1;
  }
  return { teamDocs, sourceDocs: legacy.length };
}

// ─── 감사 로그 (Audit Log) — HR 마스터 보안 액션 추적 ──
import type { AuditLog, AuditLogAction } from '@/types';

export async function createAuditLog(data: Omit<AuditLog, 'id' | 'createdAt'>): Promise<void> {
  await addDoc(collection(db, COLLECTIONS.AUDIT_LOGS), {
    ...data,
    createdAt: serverTimestamp(),
  });
}

export async function listAuditLogs(limit = 200): Promise<AuditLog[]> {
  const snap = await getDocs(query(
    collection(db, COLLECTIONS.AUDIT_LOGS),
    orderBy('createdAt', 'desc'),
  ));
  return snap.docs.slice(0, limit).map(d => {
    const data = d.data();
    return {
      ...data,
      id: d.id,
      createdAt: fromTimestamp(data.createdAt) ?? new Date(),
    } as AuditLog;
  });
}

// ─── 알림 (Notification) ──────────────────────
// link/title/category 는 신규 호출은 명시, 구버전 호출(goalId/goalTitle 만)은 자동 보강
type CreateNotificationInput =
  Omit<AppNotification, 'id' | 'createdAt' | 'link' | 'title' | 'category'>
  & Partial<Pick<AppNotification, 'link' | 'title' | 'category'>>;

/** 사용자당 알림 보관 상한 — 초과 시 오래된 것부터 자동 삭제 */
const NOTIFICATION_CAP = 100;

export async function createNotification(data: CreateNotificationInput) {
  const link = data.link ?? (data.goalId ? `/goals/${data.goalId}` : '');
  const title = data.title ?? data.goalTitle ?? '';
  const category = data.category ?? 'GOAL';
  await addDoc(collection(db, COLLECTIONS.NOTIFICATIONS), {
    ...data,
    link,
    title,
    category,
    createdAt: serverTimestamp(),
  });
  // 상한 초과 시 오래된 것부터 정리 (백그라운드, 실패 무시)
  trimNotifications(data.userId).catch(err => console.error('[알림] 정리 실패:', err));
}

async function trimNotifications(userId: string): Promise<void> {
  const snap = await getDocs(query(
    collection(db, COLLECTIONS.NOTIFICATIONS),
    where('userId', '==', userId),
    orderBy('createdAt', 'desc'),
  ));
  if (snap.size <= NOTIFICATION_CAP) return;
  const excess = snap.docs.slice(NOTIFICATION_CAP); // 정렬 desc 라 인덱스 100 이후가 오래된 것들
  await Promise.all(excess.map(d => deleteDoc(d.ref)));
}

export async function getNotifications(userId: string): Promise<AppNotification[]> {
  const snap = await getDocs(query(
    collection(db, COLLECTIONS.NOTIFICATIONS),
    where('userId', '==', userId),
    orderBy('createdAt', 'desc'),
  ));
  return snap.docs.map(d => {
    const data = d.data();
    // 구버전 호환: link / title / category 자동 보강
    return {
      ...data,
      id: d.id,
      title: data.title ?? data.goalTitle ?? '',
      link: data.link ?? (data.goalId ? `/goals/${data.goalId}` : ''),
      category: data.category ?? 'GOAL',
      createdAt: fromTimestamp(data.createdAt) ?? new Date(),
    } as AppNotification;
  });
}

export async function getUnreadNotificationCount(userId: string): Promise<number> {
  const snap = await getDocs(query(
    collection(db, COLLECTIONS.NOTIFICATIONS),
    where('userId', '==', userId),
    where('read', '==', false),
  ));
  return snap.size;
}

export async function markNotificationRead(id: string) {
  await updateDoc(doc(db, COLLECTIONS.NOTIFICATIONS, id), { read: true });
}

export async function markAllNotificationsRead(userId: string) {
  const snap = await getDocs(query(
    collection(db, COLLECTIONS.NOTIFICATIONS),
    where('userId', '==', userId),
    where('read', '==', false),
  ));
  await Promise.all(snap.docs.map(d => updateDoc(d.ref, { read: true })));
}

export async function deleteNotification(id: string) {
  await deleteDoc(doc(db, COLLECTIONS.NOTIFICATIONS, id));
}

export async function deleteNotifications(ids: string[]) {
  await Promise.all(ids.map(id => deleteDoc(doc(db, COLLECTIONS.NOTIFICATIONS, id))));
}

export async function deleteAllNotifications(userId: string) {
  const snap = await getDocs(query(
    collection(db, COLLECTIONS.NOTIFICATIONS),
    where('userId', '==', userId),
  ));
  await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
}

// ─── 혁신활동 (HR 입력, 전사 공유) ────────────────────────
export async function listInnovationActivities(year: number): Promise<InnovationActivity[]> {
  const snap = await getDocs(query(
    collection(db, COLLECTIONS.INNOVATION_ACTIVITIES),
    where('year', '==', year),
  ));
  return snap.docs.map(d => {
    const data = d.data();
    return {
      ...data,
      id: d.id,
      createdAt: fromTimestamp(data.createdAt) ?? new Date(),
      updatedAt: fromTimestamp(data.updatedAt) ?? new Date(),
    } as InnovationActivity;
  });
}

/** 전체 연도 혁신활동 — 승진 요건(누적 PM 실적)처럼 연도 무관 집계에 사용. */
export async function listAllInnovationActivities(): Promise<InnovationActivity[]> {
  const snap = await getDocs(collection(db, COLLECTIONS.INNOVATION_ACTIVITIES));
  return snap.docs.map(d => {
    const data = d.data();
    return {
      ...data,
      id: d.id,
      createdAt: fromTimestamp(data.createdAt) ?? new Date(),
      updatedAt: fromTimestamp(data.updatedAt) ?? new Date(),
    } as InnovationActivity;
  });
}

export async function listInnovationActivitiesByYearRange(startYear: number, endYear: number): Promise<InnovationActivity[]> {
  const snap = await getDocs(query(
    collection(db, COLLECTIONS.INNOVATION_ACTIVITIES),
    where('year', '>=', startYear),
    where('year', '<=', endYear),
  ));
  return snap.docs.map(d => {
    const data = d.data();
    return {
      ...data,
      id: d.id,
      createdAt: fromTimestamp(data.createdAt) ?? new Date(),
      updatedAt: fromTimestamp(data.updatedAt) ?? new Date(),
    } as InnovationActivity;
  });
}

export async function listInnovationActivitiesByUser(userId: string): Promise<InnovationActivity[]> {
  // 6개 필드 — 구버전(pmId/performerId 단일) + 신버전(pmIds/performerIds 배열) + memberIds + instructorId 모두 매칭
  const [snapPm, snapPms, snapMem, snapPer, snapPers, snapIns] = await Promise.all([
    getDocs(query(collection(db, COLLECTIONS.INNOVATION_ACTIVITIES), where('pmId', '==', userId))),
    getDocs(query(collection(db, COLLECTIONS.INNOVATION_ACTIVITIES), where('pmIds', 'array-contains', userId))),
    getDocs(query(collection(db, COLLECTIONS.INNOVATION_ACTIVITIES), where('memberIds', 'array-contains', userId))),
    getDocs(query(collection(db, COLLECTIONS.INNOVATION_ACTIVITIES), where('performerId', '==', userId))),
    getDocs(query(collection(db, COLLECTIONS.INNOVATION_ACTIVITIES), where('performerIds', 'array-contains', userId))),
    getDocs(query(collection(db, COLLECTIONS.INNOVATION_ACTIVITIES), where('instructorId', '==', userId))),
  ]);
  const seen = new Map<string, InnovationActivity>();
  for (const snap of [snapPm, snapPms, snapMem, snapPer, snapPers, snapIns]) {
    for (const d of snap.docs) {
      if (seen.has(d.id)) continue;
      const data = d.data();
      seen.set(d.id, {
        ...data,
        id: d.id,
        createdAt: fromTimestamp(data.createdAt) ?? new Date(),
        updatedAt: fromTimestamp(data.updatedAt) ?? new Date(),
      } as InnovationActivity);
    }
  }
  return Array.from(seen.values());
}

export async function createInnovationActivity(
  input: Omit<InnovationActivity, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<string> {
  const ref = await addDoc(collection(db, COLLECTIONS.INNOVATION_ACTIVITIES), {
    ...input,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateInnovationActivity(
  id: string,
  patch: Partial<Omit<InnovationActivity, 'id' | 'createdAt'>>,
): Promise<void> {
  // 구버전 단일 pmId/performerId 잔존 시 deleteField 처리 (pmIds/performerIds 새 구조 사용)
  const { deleteField } = await import('firebase/firestore');
  const payload: any = { ...patch, updatedAt: serverTimestamp() };
  if ('pmIds' in patch && patch.pmIds !== undefined) payload.pmId = deleteField();
  if ('performerIds' in patch && patch.performerIds !== undefined) payload.performerId = deleteField();
  await updateDoc(doc(db, COLLECTIONS.INNOVATION_ACTIVITIES, id), payload);
}

export async function deleteInnovationActivity(id: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTIONS.INNOVATION_ACTIVITIES, id));
}

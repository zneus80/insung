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
  QueryConstraint,
  DocumentData,
} from 'firebase/firestore';
import { db } from './firebase';
import type { User, Organization, Goal, GoalHistory, ProgressUpdate, OneOnOne, OneOnOneQuestion, OrganizationEvaluation, IndividualEvaluation, SelfEvaluation, SelfEvalGoalEntry, EvaluationCycle, Mileage, AnnualGoal, Invitation, OrgGradeHistory, DivisionGradeQuota, EvaluationGrade, YearEndEval, MentoringForm, Announcement, Award, AppNotification, WeeklyTask, WeeklyTaskItem, LeadCommentEntry } from '@/types';

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
  AWARDS: 'awards',
  SYSTEM_SETTINGS: 'systemSettings',
  BACKUPS: 'backups',
  NOTIFICATIONS: 'notifications',
  WEEKLY_TASKS: 'weeklyTasks',
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
  await updateDoc(doc(db, COLLECTIONS.USERS, uid), {
    ...data,
    updatedAt: serverTimestamp(),
  });
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
    createdAt: fromTimestamp(d.data().createdAt) ?? new Date(),
    updatedAt: fromTimestamp(d.data().updatedAt) ?? new Date(),
  } as Organization));
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
  await updateDoc(doc(db, COLLECTIONS.ORGANIZATIONS, id), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteOrganization(id: string) {
  await deleteDoc(doc(db, COLLECTIONS.ORGANIZATIONS, id));
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
  const constraints: QueryConstraint[] = [where('userId', '==', userId)];
  if (year) constraints.push(where('cycleYear', '==', year));
  // orderBy 제거 → 복합 인덱스 불필요, 메모리 정렬로 대체
  const snap = await getDocs(query(collection(db, COLLECTIONS.GOALS), ...constraints));
  const goals = snap.docs.map(d => ({
    ...d.data(),
    id: d.id,
    dueDate: fromTimestamp(d.data().dueDate) ?? new Date(),
    createdAt: fromTimestamp(d.data().createdAt) ?? new Date(),
    updatedAt: fromTimestamp(d.data().updatedAt) ?? new Date(),
    approvedAt: fromTimestamp(d.data().approvedAt),
    leadApprovedAt: fromTimestamp(d.data().leadApprovedAt),
  } as Goal));
  return goals.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
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
  } as Goal));
  return goals.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

export async function getGoalsByOrganization(orgId: string, year?: number): Promise<Goal[]> {
  const constraints: QueryConstraint[] = [where('organizationId', '==', orgId)];
  if (year) constraints.push(where('cycleYear', '==', year));
  const snap = await getDocs(query(collection(db, COLLECTIONS.GOALS), ...constraints));
  const goals = snap.docs.map(d => ({
    ...d.data(),
    id: d.id,
    dueDate: fromTimestamp(d.data().dueDate) ?? new Date(),
    createdAt: fromTimestamp(d.data().createdAt) ?? new Date(),
    updatedAt: fromTimestamp(d.data().updatedAt) ?? new Date(),
    approvedAt: fromTimestamp(d.data().approvedAt),
    leadApprovedAt: fromTimestamp(d.data().leadApprovedAt),
  } as Goal));
  return goals.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

// 여러 조직의 목표 조회 (임원/CEO용) — 10개 초과 시 배치 처리
export async function getGoalsByOrganizations(orgIds: string[], year?: number): Promise<Goal[]> {
  if (orgIds.length === 0) return [];
  const CHUNK = 10;
  const results: Goal[] = [];
  for (let i = 0; i < orgIds.length; i += CHUNK) {
    const chunk = orgIds.slice(i, i + CHUNK);
    const constraints: QueryConstraint[] = [where('organizationId', 'in', chunk)];
    if (year) constraints.push(where('cycleYear', '==', year));
    const snap = await getDocs(query(collection(db, COLLECTIONS.GOALS), ...constraints));
    results.push(...snap.docs.map(d => ({
      ...d.data(), id: d.id,
      dueDate: fromTimestamp(d.data().dueDate) ?? new Date(),
      createdAt: fromTimestamp(d.data().createdAt) ?? new Date(),
      updatedAt: fromTimestamp(d.data().updatedAt) ?? new Date(),
      approvedAt: fromTimestamp(d.data().approvedAt),
      leadApprovedAt: fromTimestamp(d.data().leadApprovedAt),
    } as Goal)));
  }
  return results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
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
          hqApprovedAt: fromTimestamp(data.hqApprovedAt),
        } as Goal;
      }));
  }
  return results.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

// ─── 목표 이력 ────────────────────────────────
export async function addGoalHistory(data: Omit<GoalHistory, 'id' | 'createdAt'>) {
  await addDoc(collection(db, COLLECTIONS.GOAL_HISTORIES), {
    ...data,
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
  return items.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
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
  if (existing.exists()) {
    await updateDoc(doc(db, COLLECTIONS.SELF_EVALUATIONS, id), {
      ...data,
      ...(data.submittedAt ? { submittedAt: Timestamp.fromDate(data.submittedAt) } : {}),
      updatedAt: serverTimestamp(),
    });
  } else {
    await setDoc(doc(db, COLLECTIONS.SELF_EVALUATIONS, id), {
      userId,
      cycleYear: year,
      goalEvals: [],
      status: 'DRAFT',
      ...data,
      ...(data.submittedAt ? { submittedAt: Timestamp.fromDate(data.submittedAt) } : {}),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
}

export async function getSelfEvaluationsByUsers(userIds: string[], year: number): Promise<SelfEvaluation[]> {
  if (userIds.length === 0) return [];
  const results = await Promise.all(
    userIds.map(uid => getSelfEvaluation(uid, year))
  );
  return results.filter((s): s is SelfEvaluation => s !== null);
}

// ─── 개인 평가 ────────────────────────────────
function mapIndividualEval(id: string, d: DocumentData): IndividualEvaluation {
  return {
    ...d,
    id,
    createdAt: fromTimestamp(d.createdAt) ?? new Date(),
    updatedAt: fromTimestamp(d.updatedAt) ?? new Date(),
    leadSubmittedAt: fromTimestamp(d.leadSubmittedAt),
    execConfirmedAt: fromTimestamp(d.execConfirmedAt),
  } as IndividualEvaluation;
}

export async function getIndividualEvaluation(userId: string, year: number): Promise<IndividualEvaluation | null> {
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
  if (safeData.execConfirmedAt) {
    (safeData as any).execConfirmedAt = Timestamp.fromDate(safeData.execConfirmedAt);
  }
  if (existing) {
    await updateDoc(doc(db, COLLECTIONS.INDIVIDUAL_EVALUATIONS, existing.id), {
      ...safeData,
      updatedAt: serverTimestamp(),
    });
  } else {
    await addDoc(collection(db, COLLECTIONS.INDIVIDUAL_EVALUATIONS), {
      userId,
      cycleYear: year,
      status: 'NOT_STARTED',
      ...safeData,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
}

export async function getAllIndividualEvaluations(year: number): Promise<IndividualEvaluation[]> {
  const snap = await getDocs(query(
    collection(db, COLLECTIONS.INDIVIDUAL_EVALUATIONS),
    where('cycleYear', '==', year)
  ));
  return snap.docs.map(d => mapIndividualEval(d.id, d.data()));
}

// ─── 1on1 ─────────────────────────────────────
function mapOneOnOne(id: string, d: DocumentData): OneOnOne {
  return {
    ...d, id,
    lastMessageAt: fromTimestamp(d.lastMessageAt),
    createdAt: fromTimestamp(d.createdAt) ?? new Date(),
    updatedAt: fromTimestamp(d.updatedAt) ?? new Date(),
  } as OneOnOne;
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
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export async function getOneOnOnesByLeader(leaderId: string): Promise<OneOnOne[]> {
  const snap = await getDocs(query(
    collection(db, COLLECTIONS.ONE_ON_ONES),
    where('leaderId', '==', leaderId),
  ));
  return snap.docs.map(d => mapOneOnOne(d.id, d.data()))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
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
export async function getActiveCycle(): Promise<EvaluationCycle | null> {
  const snap = await getDocs(query(
    collection(db, COLLECTIONS.EVALUATION_CYCLES),
    where('isActive', '==', true)
  ));
  if (snap.empty) return null;
  const d = snap.docs[0];
  return {
    ...d.data(),
    id: d.id,
    goalStartDate: fromTimestamp(d.data().goalStartDate) ?? new Date(),
    goalEndDate: fromTimestamp(d.data().goalEndDate) ?? new Date(),
    evalStartDate: fromTimestamp(d.data().evalStartDate) ?? new Date(),
    evalEndDate: fromTimestamp(d.data().evalEndDate) ?? new Date(),
    createdAt: fromTimestamp(d.data().createdAt) ?? new Date(),
  } as EvaluationCycle;
}

// ─── 마일리지 ─────────────────────────────────
export async function getMileage(userId: string): Promise<Mileage | null> {
  const snap = await getDoc(doc(db, COLLECTIONS.MILEAGES, userId));
  if (!snap.exists()) return null;
  const data = snap.data();
  return {
    ...data,
    id: snap.id,
    updatedAt: fromTimestamp(data.updatedAt) ?? new Date(),
  } as Mileage;
}

export async function setMileage(userId: string, data: Omit<Mileage, 'id' | 'updatedAt'>) {
  const { memo, ...rest } = data;
  await setDoc(doc(db, COLLECTIONS.MILEAGES, userId), {
    ...rest,
    ...(memo !== undefined ? { memo } : {}),
    updatedAt: serverTimestamp(),
  });
}

export async function getAllMileages(): Promise<Mileage[]> {
  const snap = await getDocs(collection(db, COLLECTIONS.MILEAGES));
  return snap.docs.map(d => ({
    ...d.data(),
    id: d.id,
    updatedAt: fromTimestamp(d.data().updatedAt) ?? new Date(),
  } as Mileage));
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
  data: { content: string; updatedBy: string; organizationId?: string }
) {
  const id = annualGoalDocId(type, year, data.organizationId);
  await setDoc(doc(db, COLLECTIONS.ANNUAL_GOALS, id), {
    type, year,
    ...(data.organizationId ? { organizationId: data.organizationId } : {}),
    content: data.content,
    updatedBy: data.updatedBy,
    updatedAt: serverTimestamp(),
  });
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
  if (existing.exists()) {
    await updateDoc(ref, { ...data, updatedAt: serverTimestamp() });
  } else {
    await setDoc(ref, { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  }
}

// ─── 육성면담서 ────────────────────────────────
function mentoringDocId(userId: string, year: number) {
  return `${userId}_${year}`;
}

export async function getMentoringForm(userId: string, year: number): Promise<MentoringForm | null> {
  const snap = await getDoc(doc(db, COLLECTIONS.MENTORING_FORMS, mentoringDocId(userId, year)));
  if (!snap.exists()) return null;
  const d = snap.data();
  return {
    ...d,
    id: snap.id,
    submittedAt: fromTimestamp(d.submittedAt),
    createdAt: fromTimestamp(d.createdAt) ?? new Date(),
    updatedAt: fromTimestamp(d.updatedAt) ?? new Date(),
  } as MentoringForm;
}

export async function upsertMentoringForm(
  userId: string,
  year: number,
  data: Omit<MentoringForm, 'id' | 'createdAt' | 'updatedAt'>
) {
  const id = mentoringDocId(userId, year);
  const ref = doc(db, COLLECTIONS.MENTORING_FORMS, id);
  const existing = await getDoc(ref);
  if (existing.exists()) {
    await updateDoc(ref, { ...data, updatedAt: serverTimestamp() });
  } else {
    await setDoc(ref, { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  }
}

export async function getMentoringFormsByUsers(userIds: string[], year: number): Promise<MentoringForm[]> {
  if (userIds.length === 0) return [];
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
  // isPinned true 먼저, 그 다음 최신순
  return items.sort((a, b) => {
    if (a.isPinned === b.isPinned) return b.createdAt.getTime() - a.createdAt.getTime();
    return a.isPinned ? -1 : 1;
  });
}

export async function createAnnouncement(data: Omit<Announcement, 'id' | 'createdAt' | 'updatedAt'>) {
  const ref = await addDoc(collection(db, COLLECTIONS.ANNOUNCEMENTS), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateAnnouncement(id: string, data: Partial<Omit<Announcement, 'id' | 'createdAt' | 'updatedAt'>>) {
  await updateDoc(doc(db, COLLECTIONS.ANNOUNCEMENTS, id), {
    ...data,
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
  updatedBy?: string;
  updatedAt?: Date;
}

export async function getSystemSettings(): Promise<SystemSettings | null> {
  const snap = await getDoc(doc(db, COLLECTIONS.SYSTEM_SETTINGS, 'global'));
  if (!snap.exists()) return null;
  const d = snap.data();
  return {
    activeYear: d.activeYear ?? new Date().getFullYear(),
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
  createdAt: Date;
  stats: {
    goals: number;
    users: number;
    orgEvaluations: number;
    individualEvaluations: number;
    mentoringForms: number;
  };
}

export async function getBackups(): Promise<BackupRecord[]> {
  const snap = await getDocs(query(
    collection(db, COLLECTIONS.BACKUPS),
    orderBy('createdAt', 'desc'),
  ));
  return snap.docs.map(d => ({
    id: d.id,
    year: d.data().year,
    createdBy: d.data().createdBy,
    createdAt: (d.data().createdAt as Timestamp).toDate(),
    stats: d.data().stats ?? {},
  }));
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

// ─── 주간 업무 ────────────────────────────────
function weeklyTaskDocId(userId: string, year: number, week: number): string {
  return `${userId}_${year}_W${String(week).padStart(2, '0')}`;
}

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
    }));
  } else if (typeof d.leadComment === 'string' && d.leadComment) {
    // 구버전 단일 문자열 → 1건 배열로 변환
    leadComments = [{ id: 'legacy', text: d.leadComment, authorId: '', authorName: '팀장', createdAt: new Date(0) }];
  }
  return {
    id: snap.id,
    userId: d.userId,
    organizationId: d.organizationId,
    year: d.year,
    weekNumber: d.weekNumber,
    weekStart: fromTimestamp(d.weekStart) ?? new Date(),
    weekEnd:   fromTimestamp(d.weekEnd)   ?? new Date(),
    items: (d.items ?? []) as WeeklyTaskItem[],
    summary:      d.summary ?? '',
    leadComments,
    updatedAt: fromTimestamp(d.updatedAt) ?? new Date(),
  };
}

export async function getWeeklyTask(
  userId: string, year: number, week: number
): Promise<WeeklyTask | null> {
  const snap = await getDoc(doc(db, COLLECTIONS.WEEKLY_TASKS, weeklyTaskDocId(userId, year, week)));
  if (!snap.exists()) return null;
  return toWeeklyTask(snap);
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

export async function addLeadComment(
  userId: string, year: number, week: number,
  authorId: string, authorName: string, text: string
): Promise<LeadCommentEntry> {
  const docId = weeklyTaskDocId(userId, year, week);
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

export async function getWeeklyTasksByUsersAndWeek(
  userIds: string[], year: number, week: number
): Promise<WeeklyTask[]> {
  if (!userIds.length) return [];
  const docIds = userIds.map(uid => weeklyTaskDocId(uid, year, week));
  // getDoc 병렬 처리 (chunk 필요 없음 — 개별 doc reads)
  const snaps = await Promise.all(
    docIds.map(id => getDoc(doc(db, COLLECTIONS.WEEKLY_TASKS, id)))
  );
  return snaps.filter(s => s.exists()).map(s => toWeeklyTask(s));
}

// ─── 알림 (Notification) ──────────────────────
export async function createNotification(data: Omit<AppNotification, 'id' | 'createdAt'>) {
  await addDoc(collection(db, COLLECTIONS.NOTIFICATIONS), {
    ...data,
    createdAt: serverTimestamp(),
  });
}

export async function getNotifications(userId: string): Promise<AppNotification[]> {
  const snap = await getDocs(query(
    collection(db, COLLECTIONS.NOTIFICATIONS),
    where('userId', '==', userId),
    orderBy('createdAt', 'desc'),
  ));
  return snap.docs.map(d => ({
    ...d.data(), id: d.id,
    createdAt: fromTimestamp(d.data().createdAt) ?? new Date(),
  } as AppNotification));
}

export async function markNotificationRead(id: string) {
  await updateDoc(doc(db, COLLECTIONS.NOTIFICATIONS, id), { read: true });
}

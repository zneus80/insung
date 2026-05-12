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
  QueryConstraint,
  DocumentData,
} from 'firebase/firestore';
import { db } from './firebase';
import type { User, Organization, Goal, GoalHistory, ProgressUpdate, OneOnOne, OneOnOneQuestion, OrganizationEvaluation, IndividualEvaluation, SelfEvaluation, SelfEvalGoalEntry, EvaluationCycle, Mileage, AnnualGoal, Invitation, OrgGradeHistory, DivisionGradeQuota, EvaluationGrade, CDP } from '@/types';

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
  CDPS: 'cdps',
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

  const CHUNK = 10;
  const results: Goal[] = [];
  for (let i = 0; i < orgIds.length; i += CHUNK) {
    const chunk = orgIds.slice(i, i + CHUNK);
    const snap = await getDocs(query(
      collection(db, COLLECTIONS.GOALS),
      where('organizationId', 'in', chunk),
      where('status', 'in', ['PENDING_APPROVAL', 'LEAD_APPROVED', 'PENDING_ABANDON', 'COMPLETED']),
    ));
    results.push(...snap.docs.map(d => {
      const data = d.data();
      return {
        ...data, id: d.id,
        dueDate: fromTimestamp(data.dueDate) ?? new Date(),
        createdAt: fromTimestamp(data.createdAt) ?? new Date(),
        updatedAt: fromTimestamp(data.updatedAt) ?? new Date(),
        approvedAt: fromTimestamp(data.approvedAt),
        leadApprovedAt: fromTimestamp(data.leadApprovedAt),
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

// ─── CDP ──────────────────────────────────────
export async function getCDP(userId: string, year: number): Promise<CDP | null> {
  const id = `${userId}_${year}`;
  const snap = await getDoc(doc(db, COLLECTIONS.CDPS, id));
  if (!snap.exists()) return null;
  const d = snap.data();
  return {
    ...d,
    id: snap.id,
    createdAt: fromTimestamp(d.createdAt) ?? new Date(),
    updatedAt: fromTimestamp(d.updatedAt) ?? new Date(),
  } as CDP;
}

export async function saveCDP(userId: string, orgId: string, year: number, data: Partial<Omit<CDP, 'id' | 'userId' | 'organizationId' | 'cycleYear' | 'createdAt' | 'updatedAt'>>): Promise<void> {
  const id = `${userId}_${year}`;
  const ref = doc(db, COLLECTIONS.CDPS, id);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    await updateDoc(ref, { ...data, updatedAt: serverTimestamp() });
  } else {
    await setDoc(ref, {
      userId,
      organizationId: orgId,
      cycleYear: year,
      direction: '',
      educationPlan: '',
      educationRecord: '',
      selfEval: '',
      concern: '',
      ...data,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
}

export async function getCDPsByOrganization(orgId: string, year: number): Promise<CDP[]> {
  const snap = await getDocs(query(
    collection(db, COLLECTIONS.CDPS),
    where('organizationId', '==', orgId),
    where('cycleYear', '==', year)
  ));
  return snap.docs.map(d => ({
    ...d.data(),
    id: d.id,
    createdAt: fromTimestamp(d.data().createdAt) ?? new Date(),
    updatedAt: fromTimestamp(d.data().updatedAt) ?? new Date(),
  } as CDP));
}

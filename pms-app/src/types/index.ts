// ─────────────────────────────────────────────
// 사용자 역할
// ─────────────────────────────────────────────
export type UserRole =
  | 'MEMBER'       // 일반 팀원
  | 'TEAM_LEAD'    // 팀장
  | 'EXECUTIVE'    // 조직담당 임원
  | 'CEO';         // 최고관리자
  // HR관리자는 별도 isHrAdmin 플래그로 표현 — 어떤 역할과도 조합 가능

// ─────────────────────────────────────────────
// 조직
// ─────────────────────────────────────────────
export interface Organization {
  id: string;
  name: string;
  type: 'COMPANY' | 'DIVISION' | 'HEADQUARTERS' | 'TEAM';
  parentId: string | null;
  leaderId: string | null;   // 팀장 또는 임원 userId
  createdAt: Date;
  updatedAt: Date;
}

// ─────────────────────────────────────────────
// 사용자
// ─────────────────────────────────────────────
export interface User {
  id: string;               // Firebase Auth UID
  email: string;
  name: string;
  role: UserRole;
  organizationId: string;   // 소속 팀/부문 ID
  position?: string;        // 직책
  hireDate?: string;        // 입사일 (YYYY-MM-DD)
  rank?: string;            // 직급 (예: 사원, 주임, 대리, 과장...)
  photoURL?: string;
  isActive: boolean;
  isHrAdmin?: boolean;      // HR 관리자 권한 (역할과 독립적으로 부여)
  createdAt: Date;
  updatedAt: Date;
}

// ─────────────────────────────────────────────
// 목표 상태
// ─────────────────────────────────────────────
export type GoalStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'LEAD_APPROVED'
  | 'APPROVED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'PENDING_MODIFY'
  | 'PENDING_ABANDON'
  | 'REJECTED'
  | 'ABANDONED';

export type GoalType = 'TASK' | 'GENERAL';
export type TaskCategory = 'TEAM_LINKED' | 'PERSONAL';
export type GeneralType = 'MAJOR' | 'OTHER';
export type Importance = 'HIGH' | 'MEDIUM' | 'LOW';
export type PromotionStatus = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';

// ─────────────────────────────────────────────
// 목표
// ─────────────────────────────────────────────
export interface Goal {
  id: string;
  userId: string;
  organizationId: string;
  cycleYear: number;            // 평가 연도 (e.g. 2026)

  // 공통
  goalType?: GoalType;
  title: string;
  description: string;
  dueDate: Date;
  status: GoalStatus;
  progress: number;   // 0~100

  // 과제업무(TASK) 전용
  taskCategory?: TaskCategory;
  linkedOrgGoalId?: string;
  linkedOrgGoalTitle?: string;
  weight?: number;             // 가중치 %, 팀원 합산 80% 이내

  // 일반업무(GENERAL) 전용
  generalType?: GeneralType;
  importance?: Importance;      // 기타업무(OTHER)만
  requestPromotion?: boolean;   // 주요업무(MAJOR) → 과제업무 반영요청
  promotionStatus?: PromotionStatus;

  // 승인 정보
  leadApprovedBy?: string;
  leadApprovedAt?: Date;
  approvedBy?: string;
  approvedAt?: Date;
  rejectedReason?: string;

  createdAt: Date;
  updatedAt: Date;
}

// ─────────────────────────────────────────────
// 목표 이력 (변경 로그)
// ─────────────────────────────────────────────
export interface GoalHistory {
  id: string;
  goalId: string;
  changedBy: string;            // userId
  changeType: 'CREATED' | 'UPDATED' | 'STATUS_CHANGED' | 'APPROVED' | 'REJECTED';
  previousStatus?: GoalStatus;
  newStatus?: GoalStatus;
  comment?: string;
  createdAt: Date;
}

// ─────────────────────────────────────────────
// 진행상황 업데이트
// ─────────────────────────────────────────────
export interface ProgressUpdate {
  id: string;
  goalId: string;
  userId: string;
  progress: number;   // 0~100
  comment: string;
  createdAt: Date;
}

// ─────────────────────────────────────────────
// 1on1 (채팅 Q&A 형식)
// ─────────────────────────────────────────────
export interface OneOnOne {
  id: string;
  leaderId: string;              // 팀장 userId
  memberId: string;              // 팀원 userId
  organizationId: string;
  title?: string;                // 대화 주제 (선택)
  lastMessageAt?: Date;          // 마지막 메시지 시각 (목록 정렬용)
  lastMessagePreview?: string;   // 마지막 메시지 미리보기
  createdAt: Date;
  updatedAt: Date;
}

export interface OneOnOneQuestion {
  id: string;
  askerId: string;       // 질문자 (팀원 또는 팀장)
  question: string;      // 질문 내용
  answer?: string;       // 답변 내용
  answeredBy?: string;   // 답변자 userId
  answeredAt?: Date;
  createdAt: Date;
  hiddenFor?: string[];  // 삭제(숨김) 처리한 userId 목록
}

// ─────────────────────────────────────────────
// 평가 등급
// ─────────────────────────────────────────────
export type EvaluationGrade = 'A' | 'B' | 'C' | 'D' | 'E';

// ─────────────────────────────────────────────
// 자기평가 (팀원이 완료된 목표별 작성)
// ─────────────────────────────────────────────
export interface SelfEvalGoalEntry {
  goalId: string;
  goalTitle: string;
  good: string;     // 잘된 점
  regret: string;   // 아쉬운 점
}

export type SelfEvalStatus = 'DRAFT' | 'SUBMITTED';

export interface SelfEvaluation {
  id: string;               // `${userId}_${year}`
  userId: string;
  cycleYear: number;
  goalEvals: SelfEvalGoalEntry[];
  status: SelfEvalStatus;
  submittedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ─────────────────────────────────────────────
// 조직 평가 결과 (CEO 지정)
// ─────────────────────────────────────────────
export interface OrganizationEvaluation {
  id: string;
  organizationId: string;
  cycleYear: number;
  grade: EvaluationGrade;
  uploadedBy: string;       // CEO userId
  approvedBy?: string;
  approvedAt?: Date;
  status: 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED';
  createdAt: Date;
  updatedAt: Date;
}

// ─────────────────────────────────────────────
// 개인 인사평가 쿼터 설정 (조직등급 → 개인등급 비율)
// ─────────────────────────────────────────────
export interface GradeQuota {
  orgGrade: EvaluationGrade;
  memberGrade: EvaluationGrade;
  count: number;
}

// ─────────────────────────────────────────────
// 개인 인사평가
// 흐름: NOT_STARTED → SELF_SUBMITTED → LEAD_REVIEWED → EXEC_CONFIRMED → PUBLISHED
// ─────────────────────────────────────────────
export type IndividualEvalStatus =
  | 'NOT_STARTED'
  | 'SELF_SUBMITTED'    // 팀원 자기평가 제출
  | 'LEAD_REVIEWED'     // 팀장 의견 제출
  | 'EXEC_CONFIRMED'    // 임원 등급 확정
  | 'PUBLISHED';        // 팀원 공개

export interface IndividualEvaluation {
  id: string;
  userId: string;
  organizationId: string;
  cycleYear: number;

  leadGrade?: EvaluationGrade;     // 팀장 의견 등급
  leadComment?: string;            // 팀장 의견 내용
  leadSubmittedBy?: string;        // 팀장 userId
  leadSubmittedAt?: Date;

  execGrade?: EvaluationGrade;     // 임원 확정 등급
  execComment?: string;            // 임원 의견
  execConfirmedBy?: string;        // 임원 userId
  execConfirmedAt?: Date;

  status: IndividualEvalStatus;
  createdAt: Date;
  updatedAt: Date;
}

// ─────────────────────────────────────────────
// 연간 목표 (회사 / 조직)
// ─────────────────────────────────────────────
export interface AnnualGoal {
  id: string;
  type: 'company' | 'org';
  year: number;
  organizationId?: string;   // org 타입일 때만
  content: string;
  updatedBy: string;
  updatedAt: Date;
}

// ─────────────────────────────────────────────
// 마일리지 (임원 제외)
// ─────────────────────────────────────────────
export interface Mileage {
  id: string;          // userId와 동일 (document ID)
  userId: string;
  organizationId: string;
  points: number;
  submitTds?: number;  // 제출 TDS 점수
  instructTds?: number; // 지시 TDS 점수
  memo?: string;       // HR관리자 메모
  updatedBy: string;   // HR관리자 userId
  updatedAt: Date;
}

// ─────────────────────────────────────────────
// 사용자 초대
// ─────────────────────────────────────────────
export interface Invitation {
  id: string;          // 초대 토큰 (document ID)
  userId: string;      // 대상 사용자 Firestore ID (Firebase Auth UID, 초대 수락 전은 빈 문자열)
  email: string;
  name: string;
  role: UserRole;
  organizationId?: string;
  position?: string;
  expiresAt: Date;
  usedAt?: Date;
  createdBy: string;   // HR관리자 userId
  createdAt: Date;
}

// ─────────────────────────────────────────────
// 부문/공장 등급 변경 이력 (CEO가 등급 변경할 때마다 기록)
// ─────────────────────────────────────────────
export interface OrgGradeHistory {
  id: string;
  organizationId: string;       // DIVISION 또는 HEADQUARTERS id
  cycleYear: number;
  grade: EvaluationGrade;
  previousGrade?: EvaluationGrade;
  assignedBy: string;           // CEO userId
  comment?: string;
  createdAt: Date;
}

// ─────────────────────────────────────────────
// 부문/공장별 개인 등급 쿼터 (HR_ADMIN 확정)
// ─────────────────────────────────────────────
export interface DivisionGradeQuota {
  id: string;                   // `${orgId}_${year}`
  organizationId: string;
  cycleYear: number;
  orgGrade: EvaluationGrade;    // 확정 시점의 조직 등급 스냅샷
  totalMembers: number;         // 확정 시점의 산하 전체 팀원 수
  quotaA: number;
  quotaB: number;
  quotaC: number;
  quotaD: number;
  quotaE: number;
  status: 'DRAFT' | 'CONFIRMED';
  confirmedBy?: string;         // HR_ADMIN userId
  confirmedAt?: Date;
  updatedBy: string;
  updatedAt: Date;
}

// ─────────────────────────────────────────────
// 육성면담서
// ─────────────────────────────────────────────

export type JobRequestType = 'EXPAND' | 'REDUCE' | 'CHANGE' | 'RELOCATE' | 'SATISFIED';
export type MentoringFormStatus = 'DRAFT' | 'SUBMITTED';

export interface MentoringForm {
  id: string;               // `${userId}_${year}`
  userId: string;
  organizationId: string;
  cycleYear: number;

  // 기본 정보
  interviewDate: string;    // 면담일 (YYYY-MM-DD)
  interviewerName: string;  // 면담자 이름

  // 직무 정보
  currentPosition: string;  // 직위/직책
  mainDuties: string;       // 주요담당업무
  promotionDate: string;    // 현 직위 승진일
  certifications: string;   // 직무관련 보유자격증
  achievements: string;     // 주요 업적

  // 경력개발 계획
  careerPlan: string;       // 희망 Position 및 경력개발 방향

  // 직무 요청사항
  jobRequest: JobRequestType;
  jobRequestReason: string;         // ①② 이유
  desiredJob1: string;              // 희망 직무 1순위
  desiredJob2: string;              // 희망 직무 2순위
  jobChangeReason: string;          // 직무 변경 희망 이유
  desiredLocation1: string;         // 희망 근무지 1순위
  desiredLocation2: string;         // 희망 근무지 2순위
  locationChangeReason: string;     // 근무지 변경 희망 이유

  // 종합의견
  selfOpinion: string;              // 작성자 종합의견
  interviewerOpinion: string;       // 면담자 종합의견

  status: MentoringFormStatus;
  submittedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ─────────────────────────────────────────────
// 연말 인사평가 (평가 카테고리)
// ─────────────────────────────────────────────

// 과제업무별 세부요약
export interface TaskSummaryEntry {
  goalId: string;
  goalTitle: string;
  summary: string; // 본인이 작성하는 세부요약
}

export type YearEndEvalStatus = 'DRAFT' | 'SUBMITTED';

export interface YearEndEval {
  id: string;               // `${userId}_${year}`
  userId: string;
  organizationId: string;
  cycleYear: number;
  taskSummaries: TaskSummaryEntry[]; // 과제업무 세부요약 목록
  status: YearEndEvalStatus;
  submittedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ─────────────────────────────────────────────
// 공지사항
// ─────────────────────────────────────────────
export interface Announcement {
  id: string;
  title: string;
  content: string;
  authorId: string;
  authorName: string;
  isPinned: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ─────────────────────────────────────────────
// 포상 이력
// ─────────────────────────────────────────────
export interface Award {
  id: string;
  userId: string;
  title: string;          // 포상명 (예: 우수사원상)
  description?: string;   // 내용
  awardDate: string;      // YYYY-MM-DD
  grantedBy: string;      // 수여자 userId
  createdAt: Date;
  updatedAt: Date;
}

// ─────────────────────────────────────────────
// 평가 사이클
// ─────────────────────────────────────────────
export interface EvaluationCycle {
  id: string;
  year: number;
  goalStartDate: Date;    // 목표 수립 시작
  goalEndDate: Date;      // 목표 수립 마감
  evalStartDate: Date;    // 평가 시작
  evalEndDate: Date;      // 평가 마감
  isActive: boolean;
  createdAt: Date;
}


// ─────────────────────────────────────────────
// 알림
// ─────────────────────────────────────────────
export type NotificationType =
  | 'GOAL_APPROVED' | 'GOAL_LEAD_APPROVED' | 'GOAL_REJECTED'
  | 'ABANDON_APPROVED' | 'ABANDON_LEAD_APPROVED' | 'ABANDON_REJECTED'
  | 'COMPLETION_APPROVED' | 'COMPLETION_REJECTED'
  | 'GOAL_SUBMITTED' | 'COMPLETION_REQUESTED' | 'ABANDON_REQUESTED';

export interface AppNotification {
  id: string;
  userId: string;
  goalId: string;
  goalTitle: string;
  type: NotificationType;
  message: string;
  read: boolean;
  createdAt: Date;
}

// ─────────────────────────────────────────────
// 업무관리 (주간 실적 보고)
// ─────────────────────────────────────────────
export type WeeklyTaskStatus   = 'PLANNED' | 'IN_PROGRESS' | 'DONE';
export type WeeklyTaskCategory = 'CORE' | 'GENERAL' | 'MEETING' | 'TRAINING' | 'OTHER';

export interface WeeklyTaskItem {
  id: string;                  // crypto.randomUUID()
  category: WeeklyTaskCategory;
  title: string;               // 업무명
  content: string;             // 업무 상세 내용
  result: string;              // 실적 / 결과 (PLANNED 상태에서는 미사용)
  achievement: number;         // 달성률 0~100
  status: WeeklyTaskStatus;
}

export interface LeadCommentEntry {
  id: string;
  text: string;
  authorId: string;
  authorName: string;
  createdAt: Date;
}

export interface WeeklyTask {
  id: string;                  // `${userId}_${year}_W${weekNumber}`
  userId: string;
  organizationId: string;
  year: number;
  weekNumber: number;
  weekStart: Date;
  weekEnd: Date;
  items: WeeklyTaskItem[];
  summary: string;             // 이번 주 종합 의견
  leadComments: LeadCommentEntry[];  // 팀장 Comment (누적 스레드)
  updatedAt: Date;
}

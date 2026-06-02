# INSUNG PMS — 아키텍처 문서

> 사내 성과·인사평가 관리 시스템 (사내 평가 시스템)
> 작성: 2026-06 · 대상 독자: 개발/운영 인수인계자
> 관련 문서: `CLAUDE.md`(기획·도메인 규칙), `SECURITY_TODO.md`(보안 로드맵)

---

## 1. 개요

인성그룹 사내 성과관리(PMS) 웹 애플리케이션. 핵심목표(MBO) 관리, 주간업무 보고, 1on1,
육성면담서, 자기평가/팀장·본부장·임원 의견/등급 확정으로 이어지는 **인사평가 워크플로**,
조직·인원·혁신활동·포상·마일리지 관리, HR 관리자/마스터 기능을 제공한다.

- 규모: 임직원 약 50~100명 (베타 운영 중)
- 단일 회사 조직 트리(부문/공장 → 본부 → 팀) 기반
- 모바일/데스크톱 웹 (반응형)

---

## 2. 기술 스택

| 영역 | 스택 |
|---|---|
| 프레임워크 | **Next.js 16.2** (App Router) + React 19 + TypeScript 5 |
| 스타일 | Tailwind CSS v4 + shadcn/ui + lucide-react + sonner(toast) |
| 폼/검증 | react-hook-form + zod |
| 백엔드(BaaS) | **Firebase** — Auth, Firestore(Native), Storage |
| 서버 로직 | Next.js Route Handlers + **firebase-admin** (Admin SDK) |
| 엑셀 | xlsx (업/다운로드) |
| 호스팅 | **Google Cloud Run** (asia-northeast3 / 서울), Docker |
| CI/배포 | Cloud Build → Artifact Registry → Cloud Run |
| 스케줄 | Cloud Scheduler (백업, 보안 스캔) |
| 보안 | Firebase Security Rules, App Check(reCAPTCHA Enterprise, 모니터링), Cloud Audit Logs |

---

## 3. 시스템 구성도

```
                          ┌─────────────────────────────────────────────┐
                          │                브라우저 (SPA)                │
                          │   Next.js client · Firebase JS SDK           │
                          └───────────────┬──────────────┬──────────────┘
              (1) 대부분의 read/write       │              │  (2) 민감/서버 작업
              Firebase JS SDK 직접          │              │  fetch + Firebase ID Token
                                            ▼              ▼
                       ┌────────────────────────┐  ┌──────────────────────────────┐
                       │   Firebase (BaaS)       │  │  Next.js Route Handlers       │
                       │  - Auth (이메일/비번)    │  │  (Cloud Run, Admin SDK)       │
                       │  - Firestore (규칙 적용) │◄─┤  /api/evaluation/individual   │
                       │  - Storage (백업파일)    │  │  /api/admin/* (백업·삭제 등)   │
                       └────────────────────────┘  └──────────────┬───────────────┘
                                  ▲                                │
                                  │ Security Rules 로 1차 권한      │ Admin SDK = 규칙 우회
                                  │                                │ (서버가 조직체인으로 권한판정)
                       ┌──────────┴───────────┐         ┌──────────▼───────────┐
                       │  Cloud Audit Logs     │         │  Cloud Scheduler      │
                       │  (Data Access / read) │         │  - 주간 백업          │
                       └───────────────────────┘         │  - 10분 보안 스캔      │
                                                          └───────────────────────┘
```

**두 가지 데이터 경로**
1. **클라이언트 직접 접근** (기본): Firebase JS SDK 가 Firestore 를 직접 read/write. Security Rules 가 권한을 강제.
2. **서버 프록시/Admin** (민감 작업): 클라이언트가 Firebase ID Token 을 붙여 Route Handler 호출 → 서버가 Admin SDK 로 처리. 백업·사용자삭제·비번초기화, 그리고 **개인평가 읽기(옵션 E)** 가 여기에 해당.

---

## 4. 디렉토리 구조

```
pms-app/
├── src/
│   ├── app/
│   │   ├── (auth)/login/              # 로그인
│   │   ├── (dashboard)/               # 인증 후 전체 화면 (layout.tsx 가 가드)
│   │   │   ├── dashboard/             # 메인 대시보드
│   │   │   ├── goals/                 # 핵심목표 (목록·상세·작성)
│   │   │   ├── tasks/                 # 주간업무 보고
│   │   │   ├── oneon1/                # 1on1
│   │   │   ├── mentoring/             # 육성면담서 (+ all: 전체조회)
│   │   │   ├── evaluation/            # 평가: 자기평가/확정, team, result, result/all, org
│   │   │   ├── progress/              # 진행현황: company / leads / members
│   │   │   ├── approvals/             # 승인대기함
│   │   │   ├── announcements/         # 공지
│   │   │   ├── performance / profile  # 성과/프로필
│   │   │   └── admin/                 # 관리자 (users, organizations, hr-master,
│   │   │                              #   evaluation-history/period, annual-goals,
│   │   │                              #   innovation, awards, mileage, audit-log,
│   │   │                              #   backup, settings, year-transition, security-acl[잠금])
│   │   ├── api/                       # 서버 Route Handlers (Admin SDK)
│   │   │   ├── evaluation/individual/ # 개인평가 읽기 프록시 (옵션 E)
│   │   │   ├── admin/                 # backup(snapshot/file/restore), delete-user,
│   │   │   │                          #   reset-password, link-auth, read-anomaly-scan
│   │   │   └── auth/revoke-sessions/  # 세션 강제 로그아웃
│   │   └── invite/[token]/            # 초대 수락
│   ├── lib/                           # 도메인 로직·헬퍼 (아래 표)
│   ├── contexts/                      # AuthContext, ActiveYearContext
│   ├── hooks/                         # useAuth, useIdleLogout
│   ├── components/                    # ui / layout / dashboard / evaluation / goals / members / mileage / auth
│   └── types/index.ts                 # 전체 타입 정의 (단일 파일)
├── firestore.rules                    # Firestore 보안 규칙
├── firestore.indexes.json             # 복합 인덱스
├── firebase.json                      # 규칙·에뮬레이터 설정
└── Dockerfile                         # Cloud Run 이미지
```

### `src/lib` 핵심 모듈

| 파일 | 역할 |
|---|---|
| `firebase.ts` | 클라이언트 Firebase 초기화 (`auth`, `db`) |
| `firebase-admin.ts` | 서버 Admin SDK 초기화 (서비스 계정 키) |
| `firestore.ts` | **모든 Firestore CRUD 함수 집합** (컬렉션 상수 + 도메인 함수) |
| `approval-filters.ts` | 조직 체인 권한 로직 (순수 함수, 클라이언트/서버 공용) |
| `auth.ts` | 인증 헬퍼 |
| `eval-notifications.ts` / `goal-notifications.ts` | 평가/목표 알림 발송 |
| `innovation.ts` | 혁신활동(스마트프로젝트/TDS) PM·수행자 집계 헬퍼 |
| `mileage-tier.ts` | 마일리지 등급 계산 |
| `user-sort.ts` | **표준 인원 정렬** (역할 임원→팀장→팀원, 동일역할 입사일순) |
| `excel-helpers.ts` | 엑셀 업로드 이름→userId 매핑 |
| `feature-flags.ts` | `USE_EVAL_READ_PROXY` 등 기능 플래그 |
| `version.ts` | 앱 버전 |

---

## 5. 인증 & 권한 모델

### 5.1 인증
- Firebase Auth **이메일/비밀번호** 단독 (Google SSO 제거).
- 비밀번호 정책: 8자 + 소문자 + 숫자. 90일 경과 시 변경 권장 배너(강제 X, NIST 방식).
- 초대 토큰(`invitations`) 기반 가입 → 비밀번호 설정 시 활성화.
- 세션: 30분 무활동 자동 로그아웃(`useIdleLogout`), 민감 액션 시 본인 재인증(`ReauthModal`).

### 5.2 역할 (`UserRole`) + 직교 플래그
```
역할(role):   MEMBER → TEAM_LEAD → EXECUTIVE → CEO
플래그(독립):  isHrAdmin(HR관리자) · isHrMaster(HR마스터, admin 자동포함) · isCeoViewer(읽기전용)
```
- 역할은 **계정이 아니라 "조직 배정"으로 결정되는 부분**이 큼 (아래 5.3).
- HR 권한은 어떤 역할과도 조합 가능 (예: 팀원 + HR관리자).
- `isCeoViewer`: CEO 화면 read 가능, 모든 write·확정 차단 (감사/모니터링용).

### 5.3 조직 체인 기반 "유효 평가 권한" (`getEffectiveEvalRole`)
조직은 `parentId` 트리(`COMPANY → DIVISION → HEADQUARTERS → TEAM`)이고 각 조직에 `leaderId`.
사용자가 **어느 조직의 leader 인지 + 소속/역할**로 평가 권한을 동적 판정한다.

| EffectiveEvalRole | 정의 | 평가 권한 |
|---|---|---|
| `EXEC_TOP` | 부문/공장(DIVISION) leader, 또는 상위에 DIVISION 없는 최상위 HQ leader | 등급 **확정** |
| `EXEC_SUB` | DIVISION 소속 비-leader 임원 (부공장장·부부문장) | 산하 read·의견 (확정 X) |
| `HQ_HEAD` | DIVISION 산하 본부(HQ) leader / 비-leader HQ 임원 (본부장) | 산하 read·2차 의견 |
| `TEAM_LEAD` | 팀(TEAM) leader | 1차 의견 |
| `MEMBER` | 그 외 | 본인 평가만 |

**핵심 헬퍼** (`approval-filters.ts`, 순수 함수 — 서버 프록시에서도 재사용):
`getDescendantOrgIds`, `getOrgChain`, `getMyScopeOrgIds`, `getEffectiveEvalRole`,
`buildApprovalChain`, `myStageIdxIn`, `compareOrgByDisplayOrder`.

---

## 6. 데이터 모델 (Firestore 컬렉션)

Native 모드 단일 DB. 주요 컬렉션:

| 컬렉션 | 내용 | 비고 |
|---|---|---|
| `users` | 사용자 (docId = Firebase UID) | role, organizationId, hireDate, HR 플래그 |
| `organizations` | 조직 트리 | type, parentId, leaderId, displayOrder |
| `goals` | 핵심목표(MBO) + 결재 상태 | userId, organizationId, status, collaboratorIds |
| `goalHistories` / `progressUpdates` | 목표 변경 이력 / 진행 업데이트 | |
| `weeklyTasks` | 주간업무 (docId = userId_year_Wnn) | leadComments |
| `oneOnOnes` (+ `questions` 서브) | 1on1 | leaderId/memberId |
| `mentoringForms` | 육성면담서 (docId = userId_year) | selfOpinion, leadOpinion |
| `selfEvaluations` | 자기평가 (docId = userId_year) | organizationId |
| `individualEvaluations` | **개인평가** | userId, organizationId, cycleYear, lead/hq/execGrade, status |
| `orgEvaluations` / `divisionGradeQuotas` / `gradeQuotas` / `orgGradeHistories` | 조직평가·등급쿼터·이력 | |
| `innovationActivities` | 스마트프로젝트·TDS | pmIds, performerIds, year |
| `mileages` | 마일리지 | |
| `awards` | 포상이력 | |
| `annualGoals` | 회사/조직 연간목표 | |
| `evaluationCycles` / (systemSettings의 evaluationPeriods) | 평가 시즌 설정 | |
| `notifications` | 인앱 알림 | type, category(GOAL/…/SECURITY), read |
| `auditLogs` | 감사 로그 | action, actorId, details (HR마스터·CEO read) |
| `announcements` / `systemSettings` | 공지 / 전역 설정 | |
| `backups` | 백업 메타 (파일은 Storage) | |
| `invitations` | 초대 토큰 | |

`IndividualEvaluation.status`: `NOT_STARTED → SELF_SUBMITTED → LEAD_REVIEWED → (HQ_REVIEWED) → EXEC_CONFIRMED → PUBLISHED`

---

## 7. 핵심 도메인 흐름

### 7.1 핵심목표(MBO) 결재 체인
조직 체인으로 결재 단계를 합성(`buildApprovalChain`): `[팀장] → [본부장] → [임원]`.
오너 본인이 차지하는 단계는 자동 스킵 (팀장 목표는 팀장 단계 생략 등). 상신자가 체인에
포함되면 그 단계까지 자동 승인(`computeSubmitterAutoApproval`).

### 7.2 인사평가 프로세스
```
팀원 자기평가 제출
   → 팀장 1차 의견(leadGrade)
   → (DIVISION 산하면) 본부장 2차 의견(hqGrade)
   → 임원(EXEC_TOP) 등급 확정(execGrade)
   → HR 일괄 공개(PUBLISHED)
```
- 각 단계 전환 시 다음 검토자에게 알림(`eval-notifications`).
- 조직 등급 변경 시 산하 임원 확정을 자동 무효화(`clearExecConfirmation`).
- 등급 쿼터(상대평가 인원 배분)는 부문/공장 단위로 계산.

### 7.3 표준 인원 정렬 (`user-sort.ts`)
모든 인원 목록은 **임원(EXECUTIVE) → 팀장(TEAM_LEAD) → 팀원(MEMBER)** 순,
동일 역할은 **입사일(hireDate) → 이름**. 조직 그룹 화면은 부문/공장(displayOrder) 정렬을 1차로 두고 그 안에서 적용.

---

## 8. 보안 아키텍처

### 8.1 계층
1. **App Check** (reCAPTCHA Enterprise) — 봇/비정상 클라이언트 차단 (현재 모니터링 모드).
2. **Firebase Security Rules** (`firestore.rules`) — 역할/소유권 기반 접근 제어.
3. **서버 프록시(옵션 E)** — 규칙으로 표현 불가한 조직 체인 스코프를 서버에서 판정.
4. **감사 로그 + 이상 탐지** — 사후 추적·알림.
5. **보안 헤더** (CSP, HSTS, X-Frame 등), 세션 자동 로그아웃, 민감 액션 재인증.

### 8.2 인사평가 읽기 — API 프록시 (옵션 E)  ⭐
**문제**: "팀장은 자기 팀만, 본부장/임원은 산하만"은 조직 트리 재귀 탐색이 필요한데
Firestore 규칙은 재귀를 못 한다. 규칙만으로는 권한 있는 내부자가 콘솔/curl 로 전사 평가를
덤프할 수 있었다. (과거 `viewableBy` 평면 배열 방식 시도 → 쿼리/규칙 미스매치로 철회)

**해결**: `individualEvaluations` 읽기를 서버 API 경유로 전환.
```
firestore.rules:  individualEvaluations  allow read: if isHrAdmin()||isHrMaster()||isCeo()
                  → 비-HR(팀장·임원·팀원)의 클라이언트 직접 read 차단

클라이언트 → /api/evaluation/individual (Firebase ID Token)
           → 서버가 getEffectiveEvalRole/스코프로 권한 판정 후 Admin SDK 로 반환
```
- 스코프: 팀장=자기팀, 본부장=HQ산하, 임원=부문산하, HR/CEO=전체, 팀원=본인.
- 전환은 `feature-flags.USE_EVAL_READ_PROXY` 로 토글 (롤백 = false + 재배포).
- `firestore.ts` 의 `getIndividualEvaluation/ByOrg/All` 3개 함수가 choke point — 플래그에 따라 프록시/직접 분기.
- **한계**: 단건 unfiltered 벌크 read 는 로그 1줄이라 알림 미발동하나, 감사 로그에 누가/무엇이 남아 사후 추적 가능.
- (예정 Phase 3) selfEvaluations·yearEndEvals·mentoringForms 동일 확대.

### 8.3 read 이상 탐지·알림
- Firestore **Data Access 감사 로그** 활성화 (`datastore.googleapis.com` DATA_READ).
- `firebase-adminsdk` SA 에 `roles/logging.privateLogViewer`.
- `/api/admin/read-anomaly-scan` (Cloud Scheduler 10분 주기): 평가 4개 컬렉션 read 를
  사용자별 집계 → **300건/10분 초과**(`READ_ANOMALY_THRESHOLD`) 시 HR마스터에게 인앱 알림(보안 카테고리) + `auditLogs`. 60분 재알림 억제.
- 감사로그 화면의 **"지금 스캔"** 버튼으로 즉시 현황 조회(report 모드, 알림 미발동).

### 8.4 감사 로그
HR 권한 변경·비밀번호 초기화·백업·사용자 삭제·평가 등급 변경·대량조회 감지 등을 `auditLogs`
에 기록. HR마스터·CEO 만 열람(`/admin/audit-log`, Excel 내보내기).

---

## 9. 서버 API (Route Handlers)

모두 `Authorization: Bearer <Firebase ID Token>` 검증.
Cloud Scheduler 호출 경로는 OIDC 토큰(`SCHEDULER_SA_EMAIL`/`SCHEDULER_OIDC_AUDIENCE`) 검증.

| 엔드포인트 | 용도 | 인증 |
|---|---|---|
| `POST /api/evaluation/individual` | 개인평가 읽기 프록시 | 사용자(스코프 판정) |
| `POST /api/admin/backup/snapshot` | 전체 스냅샷 백업 → Storage | HR마스터 / Scheduler |
| `GET  /api/admin/backup/file` | 백업 파일 다운로드 | HR마스터 |
| `POST /api/admin/backup/restore` | 전체 복원(덮어쓰기) | HR마스터 |
| `POST /api/admin/delete-user` | 사용자 삭제 + 고아 정리/이관 | HR마스터 |
| `POST /api/admin/reset-password` | 비밀번호 초기화 | HR마스터 |
| `POST /api/admin/link-auth` | placeholder ↔ Auth 계정 연결 | HR |
| `POST /api/admin/read-anomaly-scan` | read 이상 스캔 | HR마스터 / Scheduler |
| `POST /api/auth/revoke-sessions` | 다른 기기 세션 강제 종료 | 본인 |

---

## 10. 배포 & 운영

**환경**: Cloud Run `insung-pms` (asia-northeast3 / 서울), `--allow-unauthenticated`
(서비스 자체는 공개, 인증은 앱/Route Handler 가 담당).
서비스 URL: `https://insung-pms-730719313936.asia-northeast3.run.app`

```bash
# 1) 이미지 빌드
gcloud builds submit \
  --tag asia-northeast3-docker.pkg.dev/insung-pms/cloud-run-source-deploy/insung-pms \
  --project=insung-pms --region=asia-northeast3

# 2) 배포
gcloud run deploy insung-pms \
  --image=asia-northeast3-docker.pkg.dev/insung-pms/cloud-run-source-deploy/insung-pms \
  --region=asia-northeast3 --project=insung-pms --allow-unauthenticated

# 3) Firestore 규칙만 배포 (앱 재배포 불필요)
firebase deploy --only firestore:rules --project insung-pms
```

**환경변수(Cloud Run)**: `FIREBASE_SERVICE_ACCOUNT_KEY`(JSON), `BACKUP_STORAGE_BUCKET`,
`SCHEDULER_SA_EMAIL`, `SCHEDULER_OIDC_AUDIENCE`, `READ_ANOMALY_THRESHOLD`(=300).

**Cloud Scheduler**: `insung-weekly-backup`(월 09:00), `insung-read-anomaly-scan`(*/10분).

**백업**: 전체 컬렉션 스냅샷 JSON → Firebase Storage. 무결성 검증(핵심 컬렉션 0건/1KB 미만 시
실패 알림). 복원은 전체 덮어쓰기.

**브랜치/배포 플로**: `main` 보호 → 기능 브랜치 → PR(squash) → merge → Cloud Build/Run.
안정 시점은 git 태그(`stable-*`)로 체크포인트. Cloud Run 리비전 트래픽 전환으로 즉시 롤백 가능.

---

## 11. 🚨 인사평가 결과 가시성 원칙 (절대 불변 — CLAUDE.md §6-1)

> 본 시스템의 최상위 불변 규칙. 변경하려면 2회 이상 명시 확인 필요.

- **팀원**: 본인 평가만. 본인 소속 부문/공장 조직평가 등급만.
- **팀장**: 본인 + 본인 팀 팀원. 상위(본부장/임원) 평가는 못 봄.
- **본부장/임원**: 본인 + 책임 조직 산하. 동급·상위는 못 봄.
- **CEO/HR마스터**: 전체.
- 이 가시성은 조직 체인(`parentId`/`leaderId`)으로 결정되며, 클라이언트 화면 필터 + 서버 프록시(옵션 E) + Firestore 규칙 3중으로 강제된다.

---

## 부록: 알아두면 좋은 함정

- **Firestore 규칙은 필터가 아니라 인가**다. 쿼리가 규칙 만족을 "증명"하지 못하면 쿼리 전체가 거부된다 → 평가 같은 계층 권한은 규칙이 아닌 **서버 프록시**로 해결(§8.2).
- 클라이언트 `Date.now()` 등은 정상 사용 가능하나, 평가 doc 의 Timestamp 는 프록시에서 ISO 직렬화 후 클라이언트가 Date 로 복원한다.
- `getAllUsers()` 등은 전체를 가져온 뒤 화면에서 필터링하므로, 민감 데이터(평가)는 반드시 프록시/규칙으로 막아야 한다.
- HR마스터는 isHrAdmin 자동 포함. CEO Viewer 는 write 전부 차단.

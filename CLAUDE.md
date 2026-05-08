# CLAUDE.md — INSUNG 목표성과관리 시스템 (PMS)

이 파일은 Claude Code가 이 레포지토리에서 작업할 때 참조하는 프로젝트 가이드입니다.

---

## 프로젝트 개요

**INSUNG PMS** — 직원 목표 수립(연초)부터 인사평가(연말)까지 전 과정을 디지털화한 사내 인사 시스템.
레몬베이스(lemonbase.com) UX를 참고하여 자사 조직 특성에 맞게 커스터마이징.

- 상세 요구사항: [`PRD_목표성과관리시스템.md`](./PRD_목표성과관리시스템.md)
- 기술 상세: [`TDD_목표성과관리시스템.md`](./TDD_목표성과관리시스템.md)
- 구현 현황: [`WORK_STATUS.md`](./WORK_STATUS.md)

---

## 기술 스택

| 영역 | 기술 |
|------|------|
| Frontend | Next.js (TypeScript) + Tailwind CSS v4 + shadcn/ui |
| Runtime | React 19 |
| Database | Firebase Firestore |
| Auth | Firebase Authentication (Google SSO + 이메일/비밀번호) |
| 파일 업로드 | Firebase Storage |
| 배포 | Firebase Hosting |
| 폼 관리 | React Hook Form + Zod |
| 상태 관리 | React Context + useState |

---

## 프로젝트 구조

```
insung/
├── pms-app/               # Next.js 앱 루트
│   ├── src/
│   │   ├── app/           # Next.js App Router 페이지
│   │   │   ├── (auth)/    # 로그인 등 인증 관련
│   │   │   ├── (dashboard)/ # 로그인 후 메인 페이지들
│   │   │   └── invite/    # 초대 수락
│   │   ├── components/    # 재사용 컴포넌트
│   │   ├── contexts/      # React Context (AuthContext 등)
│   │   ├── hooks/         # 커스텀 훅
│   │   ├── lib/           # Firestore 헬퍼, 유틸
│   │   └── types/         # TypeScript 타입 정의
│   ├── firebase.json
│   └── package.json
├── PRD_목표성과관리시스템.md
├── TDD_목표성과관리시스템.md
└── WORK_STATUS.md
```

---

## 사용자 역할 (5가지)

| 역할 | 설명 |
|------|------|
| `MEMBER` | 일반 팀원 — 목표 수립, 진행상황 등록, 1on1 |
| `TEAM_LEAD` | 팀장 — 팀원 목표 승인/반려, 평가등급 의견 제출 |
| `EXECUTIVE` | 임원 — 최종 등급 확정, 산하 조직 조회 |
| `CEO` | 최고관리자 — 전사 조회, 조직평가 등급 지정 |
| `HR_ADMIN` | HR관리자 — 사용자/조직 관리, 쿼터 확정, 시스템 설정 |

---

## 목표 상태 흐름

```
DRAFT → PENDING_APPROVAL → LEAD_APPROVED → APPROVED → IN_PROGRESS → COMPLETED
                                                                   → PENDING_ABANDON → ABANDONED
                         → REJECTED (팀원 재수정 가능)
```

---

## 브랜치 전략

| 브랜치 | 용도 |
|--------|------|
| `main` | 배포용 (직접 push 금지) |
| `develop` | 통합 브랜치 — 각 feature 브랜치를 여기로 PR |
| `feature/nhlee` | nhlee 작업 브랜치 |
| `feature/swpark` | swpark 작업 브랜치 |
| `feature/sslee` | sslee 작업 브랜치 (GitHub에는 오타 `feathre/sslee`로 되어 있음) |

**작업 흐름**: `feature/본인브랜치`에서 작업 → `develop`으로 PR → 코드 리뷰 후 merge

---

## 개발 환경 실행

```bash
cd pms-app
npm install
npm run dev        # 개발 서버 (http://localhost:3000)
```

Firebase 에뮬레이터 (로컬 테스트용):
```bash
cd pms-app
npm run emulator   # Firebase 에뮬레이터 실행
```

---

## 현재 미구현 항목 (우선순위 순)

1. 평가 결과 공개(PUBLISHED) 처리 — HR_ADMIN이 개인별 공개
2. 실시간 알림 시스템 (승인 요청 시)
3. 목표 검색/필터 기능
4. 1on1 날짜/스케줄 기능
5. 모바일 반응형 최적화
6. 테스트 코드

---

## 코딩 컨벤션

- 언어: 한국어 UI, 영어 코드/변수명
- 컴포넌트: PascalCase (`GoalCard.tsx`)
- 훅: camelCase + use prefix (`useAuth.ts`)
- Firestore 문서 ID: Firebase Auth UID 또는 자동 생성 ID
- 역할 체크는 반드시 `AuthGuard` 또는 `userProfile.role` 사용
- 새 페이지 추가 시 `WORK_STATUS.md` 업데이트

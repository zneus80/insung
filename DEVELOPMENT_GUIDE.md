# 인성 PMS 개발 가이드

> **기준 커밋**: `c4405f5` (main 브랜치)  
> **작성일**: 2025년  
> **목적**: 팀원별 추가 개발 항목 안내

---

## 시작하기 전에 (필수)

```bash
# 1. 최신 main 받기
git checkout main
git pull origin main

# 2. 내 브랜치 main 기준으로 새로 시작
git checkout -b feature/본인이름
# 예: git checkout -b feature/nhlee

# 3. 개발 서버 실행
cd pms-app
npm install
npm run dev  → http://localhost:3000
```

> ⚠️ 기존 브랜치(feature/nhlee, feature/swpark)는 main과 동일하게 초기화되어 있습니다.  
> 이전 커밋은 무시하고 위 절차대로 새로 시작해 주세요.

---

## 프로젝트 구조 요약

```
pms-app/src/
├── app/(dashboard)/          ← 페이지 (로그인 후 화면)
│   ├── dashboard/            ← 대시보드
│   ├── goals/                ← 목표관리
│   ├── evaluation/           ← 평가 (자기평가, 팀원평가, 등급확정)
│   ├── mentoring/            ← 육성면담서
│   ├── oneon1/               ← 1on1
│   ├── progress/             ← 진행현황 (팀장·임원·CEO)
│   └── admin/                ← HR관리자 전용 기능
├── components/
│   ├── goals/                ← 목표 관련 컴포넌트
│   ├── evaluation/           ← 평가 관련 컴포넌트
│   ├── members/              ← 팀원 정보 모달 등
│   └── layout/               ← Header, Sidebar
├── contexts/
│   ├── AuthContext.tsx        ← 로그인 사용자 정보
│   └── ActiveYearContext.tsx  ← 활성 연도 (HR관리자가 설정)
├── lib/firestore.ts           ← Firestore DB 함수 모음
└── types/index.ts             ← 전체 타입 정의
```

### 자주 쓰는 패턴

```tsx
// 현재 로그인 사용자
const { userProfile } = useAuth();

// 활성 연도 (항상 new Date().getFullYear() 대신 이것 사용)
const { activeYear } = useActiveYear();

// 역할 확인
userProfile.role  // 'MEMBER' | 'TEAM_LEAD' | 'EXECUTIVE' | 'CEO'
userProfile.isHrAdmin  // true/false (역할과 무관한 별도 권한)
```

---

## 미구현 / 부분구현 항목 목록

### 🔴 미구현 (새로 만들어야 함)

#### A. 임원 대시보드 — 개인별 목표 클릭 시 이동 + 코멘트
**기획서**: 10-2-3-7, 10-2-3-8  
**파일**: `src/app/(dashboard)/dashboard/page.tsx` → `ExecDashboard` 컴포넌트

현재 상태: 임원 대시보드(`ExecDashboard`)에 조직별 트리 목표 현황은 표시되나,
- 개인별 목표 클릭 → 해당 목표 상세 이동 (코멘트 작성) 기능 없음
- 개인 아이콘 클릭 → `MemberInfoModal` 연결 안 됨

**해야 할 것**:
1. `ExecDashboard` 내 개인별 목표 행(row)에 클릭 이벤트 추가 → `/goals/{goalId}` 이동
2. 팀원 아바타/이름에 `<MemberInfoModal userId={uid} />` 연결
   - `MemberInfoModal`은 `src/components/members/MemberInfoModal.tsx`에 이미 구현됨
   - `OrgGoalTree.tsx`에서 사용 예시 참고

```tsx
// MemberInfoModal 사용 예시
import MemberInfoModal from '@/components/members/MemberInfoModal';

// 아바타 자리에 배치
<MemberInfoModal userId={user.id} userName={user.name[0]} />
```

---

#### B. MentoringForm 타입 정리
**기획서**: 10-3-1, 10-3-2, 10-3-3  
**파일**: `src/types/index.ts` → `MentoringForm` 인터페이스

현재 상태: UI에서는 '기본정보', '자기신고서', '교육지원 요청사항' 섹션이 제거되어 있으나,
타입 정의에 아래 필드들이 여전히 남아 있음:

```ts
// 제거 대상 필드들 (types/index.ts의 MentoringForm)
lastSchoolMajor?: string;
familyInfo?: string;
commute?: string;
importantEvent?: string;
languageType?: string;
languagePurpose?: string;
additionalEducation?: string;
// 그 외 기본정보/자기신고서 관련 필드들
```

**해야 할 것**:
1. `types/index.ts`에서 위 필드 제거
2. `lib/firestore.ts`의 `getMentoringForm`, `saveMentoringForm`에서 해당 필드 참조 제거
3. `mentoring/page.tsx`의 `EMPTY_FORM` 초기값에서 해당 필드 제거

---

### 🟡 부분구현 (기존 코드 보강 필요)

#### C. MemberInfoModal — 평가이력·포상이력 추가
**기획서**: 10-2-8  
**파일**: `src/components/members/MemberInfoModal.tsx`

현재 상태: 개인 프로필 + 마일리지만 표시됨  
**추가해야 할 것**:
- 최근 3년 평가등급 이력 (`individualEvaluations` 컬렉션에서 조회)
- 포상 이력 (`awards` 컬렉션에서 조회)

```ts
// 필요한 Firestore 함수 (lib/firestore.ts에 이미 있음)
getAwardsByUser(userId: string)  // 포상 이력
// 평가이력은 아래 함수 사용
getAllIndividualEvaluations(year)  // 연도별 전체 조회 후 userId 필터
```

---

#### D. 뒤로 가기 버튼 — 미적용 페이지에 추가
**기획서**: 10-2-7  

`Header` 컴포넌트에 `showBack` prop을 추가하면 자동으로 ← 버튼이 표시됩니다.

```tsx
// 적용 방법 (각 페이지 상단)
<Header title="페이지명" showBack />
```

**아직 적용 안 된 주요 페이지** (필요하다고 판단되는 것만 추가):
- `evaluation/result/page.tsx`
- `mentoring/page.tsx`
- `progress/leads/page.tsx`, `progress/members/page.tsx`
- `admin/evaluation-history/page.tsx`

---

#### E. 임원 대시보드 — 팀별 목표 현황 개선
**기획서**: 10-2-3-6  
**파일**: `src/app/(dashboard)/dashboard/page.tsx` → `ExecDashboard`

현재 상태: 전체 조직 트리 형태로 목표 현황 표시  
**개선 방향**: 부문/팀 단위로 "팀장 목표 현황"과 "팀원 목표 현황"을 분리하여 카드 형태로 표시

---

## 개발 시 주의사항

### Firestore 함수 추가할 때
`lib/firestore.ts` 맨 아래에 추가. 타입은 `types/index.ts`에서 import.

```ts
// 함수 작성 예시
export async function getXxx(param: string): Promise<Xxx[]> {
  const snap = await getDocs(query(
    collection(db, COLLECTIONS.XXX),
    where('field', '==', param),
  ));
  return snap.docs.map(d => ({ ...d.data(), id: d.id } as Xxx));
}
```

### 새 페이지 만들 때
동적 라우트(`[id]`)는 반드시 `generateStaticParams` 추가 필요 (static export 조건):

```ts
// app/(dashboard)/xxx/[id]/page.tsx
export function generateStaticParams() {
  return [{ id: '_' }];
}
```

### 역할별 접근 제한
```tsx
// HR 관리자만 접근
<AuthGuard requireHrAdmin>
  <PageContent />
</AuthGuard>

// 특정 역할만 접근
<AuthGuard allowedRoles={['TEAM_LEAD', 'EXECUTIVE']}>
  <PageContent />
</AuthGuard>
```

### 연도 관련
```tsx
// ❌ 절대 이렇게 쓰지 말 것
const year = new Date().getFullYear();

// ✅ 반드시 이렇게
const { activeYear } = useActiveYear();
```

---

## Git 워크플로

```bash
# 작업 시작
git checkout feature/본인이름
git pull origin main  # main 최신 반영

# 작업 완료 후
git add 수정한파일들
git commit -m "feat: 기능명 구현"
git push origin feature/본인이름

# GitHub에서 PR: feature/본인이름 → main
```

커밋 메시지 규칙:
- `feat:` 새 기능
- `fix:` 버그 수정
- `refactor:` 리팩토링
- `style:` UI 수정

---

## 연락처 / 질문

코드 구조나 기존 구현 방식이 헷갈릴 때는 `CLAUDE.md`(기획서) 또는 기존 유사 페이지 코드를 참고하세요.

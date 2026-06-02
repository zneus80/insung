# 보안 강화 TODO (베타 종료 후 진행 예정)

> 작성일: 2026-05-30
> 시스템은 현재 베타 운영 중. 정식 운영 전환 시점에 아래 항목들을 순서대로 적용.

---

## ✅ 이미 적용된 보안 기능 (참고)

- Google SSO 제거 · 이메일/비밀번호 단독 인증
- Firebase 비밀번호 정책 (8자 + 소문자 + 숫자)
- 비밀번호 90일 경과 안내 배너 (강제 X, NIST 권장 방식)
- 인앱 비밀번호 변경 모달 + 다른 디바이스 세션 강제 로그아웃
- HR 마스터/관리자 2단계 권한 분리
- 감사 로그 (auditLogs) + 조회 UI (`/admin/audit-log`)
- 보안 헤더 (CSP · HSTS · X-Frame · Permissions-Policy 등)
- Firestore 보안 규칙 (역할 기반)
- App Check (reCAPTCHA Enterprise) — **모니터링 모드 운영 중**
- reCAPTCHA Enterprise key: `6Lcr6QMtAAAAAINVxMl1V8UXWvGiIcU5xteyIzYf`

---

## 🔴 0순위 — 개인평가 read 서버 검증 (정식 운영 전 검토)

### 0. 개인평가 Firestore 읽기 권한 — 콘솔 우회 차단

**현재 상태 (v0.9.x, 2026-06 기준):**
- `individualEvaluations`·`selfEvaluations`·`yearEndEvals`·`mentoringForms` 읽기:
  팀원은 본인만, **팀장·임원·CEO·HR 은 전체 read 가능** (느슨)
- 실제 화면별 scope ("팀장은 본인 팀만", "본부장은 산하만") 는 **조직 체인(parentId) 으로 클라이언트 코드에서 계산** — 일상 보안은 정상 작동
- 잔여 위협: 권한 있는 내부자(팀장+)가 브라우저 콘솔 또는 본인 토큰 + curl 로 직접 호출 시 권한 밖 평가 조회 가능

**왜 규칙으로 못 막나:**
Firestore 보안 규칙은 조직 트리 재귀 탐색을 못 함 → "본인 책임 조직 + 산하" 를 규칙으로 표현 불가.

---

### ❌ 시도했다가 철회한 방법 — viewableBy (2026-06)

평가 doc 마다 `viewableBy: [본인 + 조직 트리 상위 leader uid...]` 배열을 박고, 규칙을
`allow read: if request.auth.uid in resource.data.viewableBy` 로 강화 시도.

**결과: 철회.** 이유:
1. **쿼리 ↔ 규칙 미스매치** — 화면은 `where('organizationId','==',orgId)` 로 평가를 조회하는데,
   규칙은 `viewableBy` 기반이라 Firestore 가 "쿼리 결과가 규칙 만족을 보장 못 함" 으로 **쿼리 전체를 거부**.
   → 본부장·부공장장 화면에서 "소속 팀원 없음" 발생 (organizationId 쿼리 거부).
   → 모든 평가 조회를 `array-contains viewableBy` 로 전면 리팩토링해야 하는데 화면마다 새 에러 유발.
2. **동기화 부담** — 조직 개편·사용자 이동 시 평가 doc 들의 viewableBy 갱신 필요.
3. **개념 중복** — 조직 체인(parentId)이 이미 "누가 누구 평가를 보나" 를 100% 결정하는데, 그걸 평면 배열로 캐시한 셈 → 부작용만 늘어남.

**잔재:** viewableBy 데이터·`computeViewableBy()` 코드는 DB·코드에 남아있으나 규칙이 안 쓰므로 무해.
완전 제거하려면 별도 정리 작업 (지금은 둬도 영향 0).

---

### ✅ 권장 방법 — 옵션 E: API Route 프록시 (정식 운영 시)

**개념:** 클라이언트가 Firestore 에 직접 접근하지 않고, 우리 서버 API(`/api/evaluations/list` 등)를 경유.
서버가 Admin SDK 로 DB 접근하며 **기존 조직 체인 로직(`getDescendantIds` 등) 을 그대로 재사용** 해 권한 판단.

```
[브라우저] → [API Route (조직 체인으로 권한 검증)] → [Firestore]
규칙: individualEvaluations 등 allow read: if false  (Admin SDK 만 통과)
```

**왜 viewableBy 보다 나은가:**
- 조직 체인 로직 재사용 → 평가 doc 에 아무것도 안 박음 (동기화 부담 0)
- 쿼리 미스매치 없음 (서버가 자유롭게 쿼리)
- **이미 우리 시스템에 있는 패턴** (`/api/admin/backup`, `/api/admin/delete-user` 동일 구조)
- 콘솔·curl·다른 SDK 등 **모든 우회 경로 차단** (서버 안 거치면 못 가져감)

**영향 범위:** `getIndividualEvaluationsByOrg` 등 평가 조회 함수를 쓰는 화면
(evaluation/team, evaluation/result, evaluation, 대시보드 등) 을 fetch 경유로 전환.
**작업량:** 반나절~1일. **위험:** 중 (화면별 데이터 로딩 변경, 점진 테스트 필요).

#### 진행 상황 (2026-06)

- [x] **Phase 1 — individualEvaluations 프록시 파이프라인 (투명 리팩터)**
  - `/api/evaluation/individual` (POST, Firebase ID 토큰): single/org/all 모드.
  - `firestore.ts` 의 `getIndividualEvaluation`/`getIndividualEvaluationsByOrg`/`getAllIndividualEvaluations` 를
    `feature-flags.USE_EVAL_READ_PROXY` 플래그로 프록시 경유 전환. evaluation-history 직접 쿼리도 전환.
  - **Phase 1 권한 = 현재 정책 그대로 재현**(본인 OR 팀장/임원/CEO/HR). 동작 변화·보안 변화 없음 — read 경로만 서버로 이전.
  - 롤백: `USE_EVAL_READ_PROXY=false` 후 재배포 → 즉시 클라이언트 직접 조회 복귀. firestore.rules 미변경.
- [x] **Phase 2a — 권한 스코프 강화 (2026-06)**
  - `/api/evaluation/individual` authorize 를 조직 체인 스코프로 좁힘
    (팀장=자기팀, 본부장=HQ산하, 차순위임원=부문산하, 최상위임원=led산하, HR/CEO=전체, MEMBER=본인).
  - 클라이언트 evaluation/team·result 의 scopeOrgIds 계산과 동일. 화면 검증 완료.
- [x] **Phase 2b — 규칙 잠금 (2026-06)**
  - `firestore.rules` individualEvaluations `allow read: if isHrAdmin() || isHrMaster() || isCeo()` 로 잠금.
  - 비-HR(팀장·임원·팀원)의 콘솔·curl 직접 조회 차단. 정상 read 는 전부 프록시 경유(스코프 적용).
  - write 규칙·HR 전용 직접조회(seed/migrate/count/recompute, security-acl)는 영향 없음.
  - **롤백**: `git checkout stable-phase2a-eval-scope -- firestore.rules && firebase deploy --only firestore:rules`
- [ ] **Phase 3 (예정)** — selfEvaluations·yearEndEvals·mentoringForms 로 동일 패턴 확대.

**우선순위 판단 (인성 규모 50~100명):**
- 잔여 위협(내부자 콘솔 우회)은 발생 빈도 낮고 감사로그·인사책임으로 억제됨 → 베타엔 보류 합당
- **정식 운영 전환 + 외부 협력사 접근/대규모 확장 시** API 프록시 적용 권장

**중간 완화 조치 (지금 가능):**
- [x] **평가 데이터 대량 read 이상 탐지·알림 (2026-06 적용)**
  - Firestore Data Access 감사 로그(Cloud Logging) 활성화 (`datastore.googleapis.com` DATA_READ)
  - `firebase-adminsdk` SA 에 `roles/logging.privateLogViewer` 부여 (data_access 로그 읽기)
  - `/api/admin/read-anomaly-scan` — 10분마다 평가 컬렉션(individualEvaluations/selfEvaluations/yearEndEvals/mentoringForms) read 를 사용자별 집계, **150건/10분 초과**(`READ_ANOMALY_THRESHOLD` 조정 가능) 시 HR마스터 전원에게 앱 내 알림(보안 카테고리) + 감사로그. 60분 내 재알림 억제.
  - Cloud Scheduler `insung-read-anomaly-scan` (`*/10 * * * *`, OIDC=insung-scheduler SA)
  - **한계:** 단건 unfiltered 쿼리로 한 방에 긁으면 로그 1줄 → 건수 기반 알림 미발동. 단 감사 로그에 누가/무엇을 읽었는지 남아 **사후 추적은 가능**. 실시간 차단은 여전히 옵션 E(API 프록시) 필요.
- [ ] 로그인/이용 안내에 "데이터 접근은 감사·기록됨" 고지 (억제 효과)
- [ ] 정식 운영 전 옵션 E 적용 여부 재검토

---

## 🟢 1순위 — 베타 종료 직후

### 1. App Check Enforce 전환

베타 동안 충분한 모니터링 후 단계 적용.

- [ ] **확인된 요청 비율 ≥ 99%** 인지 콘솔에서 확인
  - https://console.firebase.google.com/project/insung-pms/appcheck/apis
- [ ] **Firestore** Enforce 적용 (가장 우선)
- [ ] 1-2일 관찰 후 **Authentication** Enforce
- [ ] 마지막 **Storage** Enforce (사용 중이면)

**API 명령 예시:**
```bash
TOKEN=$(gcloud auth print-access-token)
curl -X PATCH \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Goog-User-Project: insung-pms" \
  -H "Content-Type: application/json" \
  "https://firebaseappcheck.googleapis.com/v1/projects/insung-pms/services/firestore.googleapis.com?updateMask=enforcementMode" \
  -d '{"enforcementMode": "ENFORCED"}'
```

문제 발생 시 `UNENFORCED` 로 즉시 롤백 가능 (재배포 불필요).

---

## 🟡 2순위 — 외부 노출 차단 강화

### 2. 접근 통제 (택일)

회사 정책·VPN 인프라 상황 보고 택일:

#### 옵션 A. Cloudflare Access (VPN 없이도 가능)
- [ ] Cloudflare 계정 생성 + 도메인 등록
- [ ] Zero Trust → Access Application 생성
- [ ] 이메일 도메인 화이트리스트 (예: `@insungind.co.kr`)
- [ ] DNS proxy 활성화
- 50명 이하 무료 / 외부 협력사 임시 허용 가능

#### 옵션 B. Cloud Armor + IP 허용 목록
- [ ] 회사 사무실 공인 IP 확보 (고정 IP 필요)
- [ ] Application Load Balancer 앞단에 배치
- [ ] Cloud Armor 정책: 허용 IP 외 차단
- 사무실 안에서만 접근 가능 (재택·출장 불가)

#### 옵션 C. GCP IAP
- [ ] 회사 Google Workspace 미사용이라 부적합 (검토 제외)

---

## 🟡 3순위 — 인증 강화

### 3. MFA / 2단계 인증 (TOTP)

피싱 · 크리덴셜 스터핑 방어의 가장 큰 한 방. 단계 적용 권장:

- [ ] Firebase Auth Identity Platform 업그레이드 (TOTP MFA 지원)
- [ ] **1차: HR 마스터 · CEO · 임원**에게만 MFA 등록 강제
- [ ] 등록 UI: Google Authenticator / Authy 등록 → QR 코드
- [ ] 로그인 후 OTP 입력 단계 추가
- [ ] **2차: 전사 확대** — 등록 안내 후 강제 적용

### 4. 로그인 실패 횟수 제한

- [ ] Cloud Function (또는 클라이언트 측 throttle) 로 N회 실패 시 계정 일시 잠금
- [ ] 잠금 시 HR 마스터에게 알림 (auditLogs 에도 기록)
- [ ] 잠금 해제 정책 (X분 자동 해제 vs 마스터 수동)

---

## 🟢 4순위 — Defense in Depth

### 5. 세션 비활성 자동 로그아웃

- [ ] 30분 무활동 감지 후 자동 `signOut()`
- [ ] 클라이언트 idle 이벤트 + 타이머
- [ ] 평가 시즌의 공용 PC 방치 케이스 대응

### 6. HR 마스터 민감 액션 시 본인 재인증

비밀번호 초기화 · 마스터 부여 · 백업 삭제 등 직전에 본인 비밀번호 재입력 요구.

- [ ] `reauthenticateWithCredential` 재사용 (PasswordChangeModal 패턴)
- [ ] 적용 대상: `/admin/hr-master`, `/admin/backup` 삭제, 비밀번호 초기화

### 7. 백업 다운로드 추가 보안

- [ ] 다운로드 시 본인 재인증 요구
- [ ] Excel 첫 행에 워터마크 (행위자 + 시각)
- [ ] 감사 로그에 다운로드 데이터 범위(연도·시트) 기록

### 8. 유출 비밀번호 차단 (HaveIBeenPwned)

- [ ] 새 비밀번호 설정 시 HIBP API k-anonymity 조회
- [ ] 유출 이력 있으면 변경 차단 + 다른 비밀번호 안내

### 9. 이상 로그인 탐지·알림

- [ ] 로그인 시 IP·국가·디바이스 정보 기록
- [ ] 평소와 다른 환경에서 로그인 시 본인 메일 알림
- [ ] Cloud Function + ipinfo API

---

## 🔵 5순위 — 운영·정책

### 10. 개인정보 노출 최소화 점검

- [ ] Excel 다운로드 데이터에서 민감 PII 추가 마스킹
- [ ] 외부 공유 가능성 있는 데이터에 이메일 부분 마스킹

### 11. 정기 권한 감사

- [ ] 분기 또는 반기에 HR 마스터 · HR 관리자 · 임원 권한 보유자 리뷰
- [ ] 감사 로그 조회 UI에서 권한 변경 이력 점검
- [ ] 퇴사자 / 부서이동자 권한 즉시 회수

### 12. 백업 데이터 보안 강화

- [ ] 현재 `backups` 컬렉션 Firestore 규칙 재검토 (마스터만 접근으로 강화)
- [ ] 중요 백업은 Cloud Storage 버킷 + KMS 암호화 + 별도 IAM

### 13. 정기 보안 점검

- [ ] 6개월 주기 Firestore 규칙 리뷰
- [ ] 종속 라이브러리 취약점 스캔 (`npm audit`)
- [ ] Cloud Run / Firebase 권한 IAM 최소 권한 원칙 점검

---

## 🔴 보안 사고 대응 (참고)

베타 → 정식 전환 시 사고 대응 절차도 함께 정리 권장:

- [ ] 사고 신고 채널 (HR 마스터 메일·연락처)
- [ ] 계정 침해 의심 시 대응: 즉시 비활성 → 비밀번호 강제 초기화 → 다른 세션 revoke
- [ ] 데이터 유출 의심 시 대응: 감사 로그 추적 + 영향 범위 파악
- [ ] 침해 신고 의무 정책 (개인정보보호법 등)

---

## 참고 자료

- NIST 800-63B (Digital Identity Guidelines) — 비밀번호 정책
- Firebase App Check 공식 문서 — https://firebase.google.com/docs/app-check
- Cloudflare Zero Trust — https://www.cloudflare.com/zero-trust/
- OWASP ASVS — 웹 애플리케이션 보안 검증 표준

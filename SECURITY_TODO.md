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

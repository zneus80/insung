/**
 * 기능 플래그.
 *
 * USE_EVAL_READ_PROXY:
 *   true  → individualEvaluations 조회가 서버 API(/api/evaluation/individual) 경유.
 *   false → 클라이언트가 Firestore 를 직접 조회 (기존 방식).
 *
 * 문제 발생 시 false 로 되돌리고 재배포하면 즉시 기존 방식으로 롤백됩니다.
 * (firestore.rules 의 read 규칙은 이 플래그와 무관하게 별도 단계에서 조입니다.)
 */
export const USE_EVAL_READ_PROXY = true;

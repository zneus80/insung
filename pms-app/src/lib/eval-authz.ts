import type { Organization } from '@/types';
import { getEffectiveEvalRole, getDescendantOrgIds } from './approval-filters';

/**
 * 평가 데이터 read 스코프 — 요청자가 읽을 수 있는 조직 ID 집합.
 * 서버 프록시(/api/evaluation/*)에서 권한 판정에 사용.
 * 클라이언트 화면(evaluation/team·result)의 scopeOrgIds 계산과 동일하게 맞춘다.
 *
 *  - 팀장(TEAM_LEAD)        → home팀 ∪ 본인 leader 조직 산하
 *  - 본부장(HQ_HEAD)        → 본인 HQ 산하 (비-leader 면 home HQ 산하)
 *  - 차순위임원(EXEC_SUB)    → home부문 산하 ∪ led 산하
 *  - 최상위임원(EXEC_TOP)    → 본인 leader 조직 산하만 (home 제외, §6-1)
 *  - 그 외(MEMBER)          → [] (본인 데이터만 — 호출 측에서 owner 별도 허용)
 *
 * HR·CEO 는 전체 접근이므로 이 함수를 호출하지 않고 상위에서 처리한다.
 */
export function computeEvalReadScopeOrgIds(
  uid: string,
  role: string,
  orgId: string | undefined,
  allOrgs: Organization[],
): string[] {
  const led = allOrgs
    .filter(o => o.leaderId === uid)
    .flatMap(o => getDescendantOrgIds(o.id, allOrgs));
  const home = orgId ? getDescendantOrgIds(orgId, allOrgs) : [];
  const eff = getEffectiveEvalRole(uid, role, orgId, allOrgs);

  if (eff === 'MEMBER') return [];
  if (eff === 'EXEC_TOP') {
    return Array.from(new Set(led.length ? led : home));
  }
  if (eff === 'EXEC_SUB') {
    return Array.from(new Set([...home, ...led]));
  }
  if (eff === 'HQ_HEAD') {
    const ledHq = allOrgs
      .filter(o => o.leaderId === uid && o.type === 'HEADQUARTERS')
      .flatMap(o => getDescendantOrgIds(o.id, allOrgs));
    const base = ledHq.length ? ledHq : home;
    return Array.from(new Set([...base, ...led]));
  }
  // TEAM_LEAD
  return Array.from(new Set([...home, ...led]));
}

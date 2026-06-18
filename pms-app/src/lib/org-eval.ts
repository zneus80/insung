import type { Organization } from '@/types';

/**
 * 조직평가 단위 판정 — 조직평가인원관리(org/page)의 평가대상 조직 규칙과 동일하게 맞춘다.
 * 부문(상위 부문 없으면 기본 평가단위) + isEvalUnit 지정 조직(본부 등) + 상위에 부문 없는 독립 팀.
 */
export function isEvalUnitOrg(o: Organization, orgs: Organization[]): boolean {
  if (o.type === 'DIVISION') return o.isEvalUnit !== false;
  if (o.isEvalUnit) return true;
  if (o.type === 'TEAM') {
    let cur = o.parentId ? orgs.find(p => p.id === o.parentId) : undefined;
    while (cur) {
      if (cur.type === 'DIVISION') return false;
      cur = cur.parentId ? orgs.find(p => p.id === cur!.parentId) : undefined;
    }
    return true;
  }
  return false;
}

/**
 * 특정 조직에서 위로 올라가며 가장 가까운 '평가 단위' 조직 id 를 찾는다(자기 자신 포함).
 * 쿼터는 평가 단위 조직에 달리므로, 멤버의 쿼터/등급 게이트는 이 조직을 기준으로 한다.
 */
export function nearestEvalUnitId(orgId: string, orgs: Organization[]): string | null {
  let cur: Organization | undefined = orgs.find(o => o.id === orgId);
  while (cur) {
    if (isEvalUnitOrg(cur, orgs)) return cur.id;
    cur = cur.parentId ? orgs.find(p => p.id === cur!.parentId) : undefined;
  }
  return null;
}

/** 사용자가 평가 단위 조직의 리더인가 — 본부 임원도 평가확정 화면에 진입할 수 있게 판단. */
export function leadsAnyEvalUnit(userId: string, orgs: Organization[]): boolean {
  return orgs.some(o => !o.archivedAt && o.leaderId === userId && isEvalUnitOrg(o, orgs));
}

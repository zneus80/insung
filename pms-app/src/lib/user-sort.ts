import type { User } from '@/types';

/**
 * 인원 표준 정렬 — 역할 우선순위: 임원(EXECUTIVE) → 팀장(TEAM_LEAD) → 팀원(MEMBER).
 * CEO 는 최상위(0). 동일 역할은 입사일(hireDate) → 이름 순.
 */
export function roleRank(role: User['role'] | string | undefined): number {
  switch (role) {
    case 'CEO': return 0;
    case 'EXECUTIVE': return 1;
    case 'TEAM_LEAD': return 2;
    case 'MEMBER': return 3;
    default: return 9;
  }
}

/** 입사일(YYYY-MM-DD) → 이름. hireDate 없는 사람은 뒤로. */
export function compareByHireThenName(a: User, b: User): number {
  const ha = a.hireDate ?? '';
  const hb = b.hireDate ?? '';
  if (ha && !hb) return -1;
  if (!ha && hb) return 1;
  if (ha !== hb) return ha.localeCompare(hb);
  return (a.name ?? '').localeCompare(b.name ?? '', 'ko');
}

/**
 * 표준 인원 정렬: 역할(임원→팀장→팀원) → 입사일(이른 순) → 이름.
 * 같은 조직(팀) 내 목록, 또는 조직 그룹 내 2차 정렬에 사용.
 */
export function compareUserByRoleHire(a: User, b: User): number {
  const ra = roleRank(a.role);
  const rb = roleRank(b.role);
  if (ra !== rb) return ra - rb;
  return compareByHireThenName(a, b);
}

/** 직급(position) 서열 — 상위 직급일수록 낮은 숫자. 미등록/미상은 뒤로. */
const POSITION_ORDER = [
  '회장', '부회장', '사업부장', '부문장', '본부장', '공장장', '부공장장',
  '실장', '팀장', '수석', '책임', '선임', '주임', '사원',
];
export function positionRank(position?: string): number {
  if (!position) return 99;
  const i = POSITION_ORDER.indexOf(position.trim());
  return i < 0 ? 90 : i;
}

/**
 * 팀 내 인원 정렬: 역할(팀장→팀원) → 직급(책임→주임 등) → 입사일(이른 순) → 이름.
 * 전사 육성면담서·자기평가 등 팀 단위 개인 목록에 사용.
 */
export function compareUserByRolePositionHire(a: User, b: User): number {
  const ra = roleRank(a.role);
  const rb = roleRank(b.role);
  if (ra !== rb) return ra - rb;
  const pa = positionRank(a.position);
  const pb = positionRank(b.position);
  if (pa !== pb) return pa - pb;
  return compareByHireThenName(a, b);
}

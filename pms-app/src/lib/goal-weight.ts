import type { Goal } from '@/types';

/** 가중치 정규화 대상에서 제외할 상태(포기·반려·임시저장·휴지통) */
const WEIGHT_EXCLUDE = new Set<string>(['ABANDONED', 'REJECTED', 'DRAFT']);

/**
 * 핵심목표 가중치 정규화 (정규화 모델 — 저장값은 원시 weight, 표시는 파생).
 * 개인(또는 그룹) 단위로 활성 목표들의 weight(미설정 시 1) 합으로 나눠 합계 100%가 되도록 환산.
 * 반올림 오차는 가장 큰 항목에 흡수시켜 합계 정확히 100 유지.
 *
 * @returns goalId -> 정규화된 % (정수)
 */
export function normalizeWeights(goals: Pick<Goal, 'id' | 'weight' | 'status' | 'trashedAt'>[]): Record<string, number> {
  const active = goals.filter(g => !WEIGHT_EXCLUDE.has(g.status) && !g.trashedAt);
  const out: Record<string, number> = {};
  if (active.length === 0) return out;
  // 미설정(또는 0) 목표는 '균등배분값(100/N)'을 기본 raw 로 사용 — 일부만 가중치를 줘도
  // 나머지가 1로 깔려 한쪽이 과대해지는 왜곡을 방지(직관적: 전체 합 100% 기준 자동 조정).
  const evenDefault = 100 / active.length;
  const raw = active.map(g => ({ id: g.id, w: (g.weight != null && g.weight > 0) ? g.weight : evenDefault }));
  const total = raw.reduce((s, r) => s + r.w, 0);
  if (total <= 0) {
    const even = Math.floor(100 / active.length);
    raw.forEach(r => { out[r.id] = even; });
  } else {
    raw.forEach(r => { out[r.id] = Math.round((r.w / total) * 100); });
  }
  // 반올림 합 보정 — 차이를 가중치 가장 큰 항목에 가감
  const sum = Object.values(out).reduce((s, v) => s + v, 0);
  const diff = 100 - sum;
  if (diff !== 0 && raw.length > 0) {
    const biggest = raw.slice().sort((a, b) => b.w - a.w)[0].id;
    out[biggest] = (out[biggest] ?? 0) + diff;
  }
  return out;
}

/** 자기평가용 — 핵심목표 가중치를 전체 80% 비율로 환산 (개인 합 100% → 핵심 80%). */
export function coreWeight80(normalizedPct: number): number {
  return Math.round(normalizedPct * 0.8 * 10) / 10; // 소수 1자리
}

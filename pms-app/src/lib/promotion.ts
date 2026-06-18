import type { User, Mileage, InnovationActivity } from '@/types';
import { getPmIds } from '@/lib/innovation';

/**
 * 승진요건 — 전사 인원현황·AI 챗봇이 공유하는 단일 기준.
 * - 팀원/팀장대행 → 팀장 승진: 스마트프로젝트 1건 이상(PM 또는 멤버) AND 마일리지 200점 이상
 * - 정식 팀장(대행 아님) → 임원 승진: 완료된 스마트프로젝트 PM 1건 이상(추진중 미인정)
 * - CEO·임원: 승진 대상 아님
 */

export interface PromotionInfo {
  target: '팀장 승진' | '임원 승진' | '해당 없음';
  pmCount: number;
  pmCompletedCount: number;
  memberCount: number;
  totalPoints: number;
  meetsRequirement: boolean;
  reasonText: string;   // 미충족 사유(충족 시 빈 문자열)
}

export interface SmartProjectCount {
  pmCount: number;          // SMART_PROJECT PM 참여(추진중 포함 — 팀장 승진 집계용)
  pmCompletedCount: number; // 완료된 SMART_PROJECT PM(임원 승진 요건은 완료만 인정)
  memberCount: number;      // SMART_PROJECT 멤버 참여
}

/** 혁신활동(전체 연도)에서 사용자별 스마트프로젝트 참여 카운트 집계 */
export function computeSmartProjectCounts(innovations: InnovationActivity[]): Map<string, SmartProjectCount> {
  const m = new Map<string, SmartProjectCount>();
  const ensure = (uid: string) => m.get(uid) ?? { pmCount: 0, pmCompletedCount: 0, memberCount: 0 };
  for (const a of innovations) {
    if (a.type !== 'SMART_PROJECT') continue;
    for (const uid of getPmIds(a)) {
      const c = ensure(uid);
      c.pmCount++;
      if (a.status === 'COMPLETED') c.pmCompletedCount++;
      m.set(uid, c);
    }
    for (const uid of (a.memberIds ?? [])) {
      const c = ensure(uid);
      c.memberCount++;
      m.set(uid, c);
    }
  }
  return m;
}

export function computePromotion(user: User, mileage: Mileage | undefined, sp: SmartProjectCount): PromotionInfo {
  const pmCount = sp.pmCount;
  const pmCompleted = sp.pmCompletedCount;
  const memberCount = sp.memberCount;
  const totalPoints = mileage?.points ?? 0;

  if (user.role === 'CEO' || user.role === 'EXECUTIVE') {
    return { target: '해당 없음', pmCount, pmCompletedCount: pmCompleted, memberCount, totalPoints, meetsRequirement: false, reasonText: '' };
  }
  // 정식 팀장(대행 아님) → 임원 승진: 완료 SP PM 1+
  if (user.role === 'TEAM_LEAD' && !user.isActingLead) {
    const meets = pmCompleted >= 1;
    return {
      target: '임원 승진', pmCount, pmCompletedCount: pmCompleted, memberCount, totalPoints,
      meetsRequirement: meets,
      reasonText: meets ? '' : `스마트프로젝트 PM(완료) ${pmCompleted}/1`,
    };
  }
  // 팀원/팀장대행 → 팀장 승진: SP 1+ (PM or 멤버) + 마일리지 200+
  const projectCount = pmCount + memberCount;
  const meetsProject = projectCount >= 1;
  const meetsMileage = totalPoints >= 200;
  const meets = meetsProject && meetsMileage;
  const reasons: string[] = [];
  if (!meetsProject) reasons.push(`스마트프로젝트 ${projectCount}/1`);
  if (!meetsMileage) reasons.push(`마일리지 ${totalPoints}/200`);
  return {
    target: '팀장 승진', pmCount, pmCompletedCount: pmCompleted, memberCount, totalPoints,
    meetsRequirement: meets,
    reasonText: reasons.join(', '),
  };
}

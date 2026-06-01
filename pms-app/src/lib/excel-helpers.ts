import type { User } from '@/types';

/**
 * 엑셀 업로드 공통 헬퍼 — 이름 → 사용자 ID 해석.
 * 이름은 고유하지 않을 수 있으므로(동명이인) 0명/2명 이상은 에러로 처리한다.
 */

/** 이름으로 사용자 1명 해석. 0명/동명이인이면 에러 메시지 반환. */
export function resolveUserByName(name: string, users: User[]): { id: string } | { error: string } {
  const n = String(name ?? '').trim();
  if (!n) return { error: '이름이 비어있습니다.' };
  const matches = users.filter(u => (u.name ?? '').trim() === n);
  if (matches.length === 0) return { error: `'${n}' 사용자를 찾을 수 없습니다.` };
  if (matches.length > 1) return { error: `'${n}' 동명이인 ${matches.length}명 — 화면에서 직접 선택하세요.` };
  return { id: matches[0].id };
}

/** 세미콜론/쉼표 구분 이름 목록 → userId 배열. 미해석 이름은 errors 로 수집. */
export function resolveUserNames(raw: string, users: User[]): { ids: string[]; errors: string[] } {
  const names = String(raw ?? '').split(/[;,]/).map(s => s.trim()).filter(Boolean);
  const ids: string[] = [];
  const errors: string[] = [];
  for (const nm of names) {
    const r = resolveUserByName(nm, users);
    if ('id' in r) ids.push(r.id);
    else errors.push(r.error);
  }
  return { ids, errors };
}

/** 'Y'/'예'/'O'/'true'/'1' → true, 그 외 false */
export function parseBoolCell(v: unknown): boolean {
  const s = String(v ?? '').trim().toLowerCase();
  return ['y', 'yes', '예', 'o', 'true', '1', '대내비'].includes(s);
}

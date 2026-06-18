/**
 * 개인 글자 크기 조절 — 사용자가 직접 화면 폰트 배율을 키우거나 줄인다.
 * 배율은 CSS 변수 `--font-scale` 로 적용되어 rem 기반 텍스트(전 역할) + 임원·CEO 큰글씨(pt)에 함께 반영된다.
 * 값은 localStorage 에 저장되어 새로고침·재접속에도 유지된다(기기 단위).
 */

export const FONT_SCALE_KEY = 'pms_font_scale';
export const FONT_SCALE_MIN = 0.9;
export const FONT_SCALE_MAX = 1.4;
export const FONT_SCALE_STEP = 0.05;
export const FONT_SCALE_DEFAULT = 1;

/** 0.9 ~ 1.4 범위로 제한하고 5%(0.05) 단위로 반올림 */
export function clampFontScale(v: number): number {
  const rounded = Math.round(v * 20) / 20;
  return Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, rounded));
}

/** 저장된 배율 읽기(없거나 비정상이면 기본값) */
export function getStoredFontScale(): number {
  if (typeof window === 'undefined') return FONT_SCALE_DEFAULT;
  const raw = Number(window.localStorage.getItem(FONT_SCALE_KEY));
  return Number.isFinite(raw) && raw > 0 ? clampFontScale(raw) : FONT_SCALE_DEFAULT;
}

/** 배율을 화면에 즉시 적용(저장하지 않음) */
export function applyFontScale(v: number): void {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty('--font-scale', String(v));
}

/** 배율을 저장하고 즉시 적용. 적용된 최종(clamp된) 값을 반환 */
export function setFontScale(v: number): number {
  const c = clampFontScale(v);
  if (typeof window !== 'undefined') window.localStorage.setItem(FONT_SCALE_KEY, String(c));
  applyFontScale(c);
  return c;
}

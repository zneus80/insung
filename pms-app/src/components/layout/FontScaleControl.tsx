'use client';

/**
 * 개인 글자 크기 조절 — 작은 '가' / 큰 '가' 버튼.
 * 누를 때마다 화면 폰트 배율을 단계적으로 키우거나 줄인다(기기 단위로 저장·유지).
 */

import { useEffect, useState } from 'react';
import {
  getStoredFontScale,
  setFontScale,
  FONT_SCALE_MIN,
  FONT_SCALE_MAX,
  FONT_SCALE_STEP,
  FONT_SCALE_DEFAULT,
} from '@/lib/font-scale';

export default function FontScaleControl() {
  const [scale, setScale] = useState(FONT_SCALE_DEFAULT);

  // 마운트 시 저장된 배율 반영(SSR 안전)
  useEffect(() => { setScale(getStoredFontScale()); }, []);

  const change = (delta: number) => setScale(setFontScale(scale + delta));

  return (
    <div
      className="inline-flex items-center rounded-full border border-gray-200 bg-white overflow-hidden"
      title="글자 크기 조절"
    >
      <button
        type="button"
        onClick={() => change(-FONT_SCALE_STEP)}
        disabled={scale <= FONT_SCALE_MIN}
        className="px-2.5 py-1.5 text-xs leading-none text-gray-500 hover:bg-gray-100 transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
        aria-label="글자 작게"
      >
        가
      </button>
      <span className="px-1 text-[10px] tabular-nums text-gray-400 select-none" aria-hidden>
        {Math.round(scale * 100)}%
      </span>
      <button
        type="button"
        onClick={() => change(FONT_SCALE_STEP)}
        disabled={scale >= FONT_SCALE_MAX}
        className="px-2.5 py-1.5 text-lg font-bold leading-none text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
        aria-label="글자 크게"
      >
        가
      </button>
    </div>
  );
}

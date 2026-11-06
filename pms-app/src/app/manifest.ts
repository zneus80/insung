import type { MetadataRoute } from 'next';

/**
 * 설치형 웹앱(PWA) 설명서 — 2026-11-06.
 * 이 파일이 있어야 크롬·엣지 주소창에 「앱 설치」가 뜬다. 설치하면 주소창 없는 전용 창 + 작업표시줄·시작 메뉴·바탕화면 아이콘이 생긴다.
 *
 * - 화면은 지금처럼 서버(Cloud Run)에서 매번 받는다 — 설치한 앱도 배포하면 바로 새 화면(PC 마다 버전이 갈리지 않는다).
 *   그래서 서비스 워커(오프라인 캐시)는 일부러 두지 않는다: 캐시를 붙이는 순간 옛 화면이 남는 PC 가 생긴다.
 * - 아이콘은 scripts/make-app-icons.mjs 가 만든다(파비콘·아이폰 아이콘도 같이).
 * - PMS 는 다크 모드가 없어 theme_color 는 로고 파랑으로 고정.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'INSUNG PMS',
    short_name: 'INSUNG PMS',
    description: '목표성과관리 시스템',
    lang: 'ko',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f9fafb',
    theme_color: '#2563eb',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

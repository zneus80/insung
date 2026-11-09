import type { Metadata, Viewport } from 'next';
import { Noto_Sans_KR } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/contexts/AuthContext';
import { Toaster } from '@/components/ui/sonner';
import UpdateNotice from '@/components/UpdateNotice';

const notoSansKr = Noto_Sans_KR({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
});

export const metadata: Metadata = {
  title: '목표성과관리 시스템',
  description: '조직 및 개인 목표 수립, 진행 관리, 성과 평가 플랫폼',
  // 설치형 웹앱(PWA · 2026-11-06) — 설명서는 app/manifest.ts, 아이콘·파비콘은 scripts/make-app-icons.mjs 가 만든다(app/favicon.ico · app/apple-icon.png 는 Next 가 자동으로 <link> 를 단다).
  applicationName: 'INSUNG PMS',
  // 아이폰 「홈 화면에 추가」 때 아이콘 밑 이름(없으면 긴 페이지 제목이 잘려 붙는다).
  appleWebApp: { title: 'INSUNG PMS' },
};

// 설치한 앱 제목 띠·주소창 색(로고 파랑). PMS 는 다크 모드가 없어 고정.
export const viewport: Viewport = {
  themeColor: '#2563eb',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" className="h-full">
      <head>
        {/* 개인 글자 크기 배율을 페인트 전에 적용해 새로고침 시 깜빡임 방지 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var v=parseFloat(localStorage.getItem('pms_font_scale'));if(v>0){v=Math.min(1.4,Math.max(0.9,Math.round(v*20)/20));document.documentElement.style.setProperty('--font-scale',String(v));}}catch(e){}})();`,
          }}
        />
      </head>
      <body className={`${notoSansKr.className} h-full bg-gray-50 antialiased`}>
        <AuthProvider>
          {children}
          <Toaster richColors closeButton position="top-right" />
          <UpdateNotice />
        </AuthProvider>
      </body>
    </html>
  );
}

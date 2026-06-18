import type { Metadata } from 'next';
import { Noto_Sans_KR } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/contexts/AuthContext';
import { Toaster } from '@/components/ui/sonner';

const notoSansKr = Noto_Sans_KR({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
});

export const metadata: Metadata = {
  title: '목표성과관리 시스템',
  description: '조직 및 개인 목표 수립, 진행 관리, 성과 평가 플랫폼',
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
            __html: `(function(){try{var v=parseFloat(localStorage.getItem('pms_font_scale'));if(v>0){v=Math.min(1.4,Math.max(0.9,Math.round(v*10)/10));document.documentElement.style.setProperty('--font-scale',String(v));}}catch(e){}})();`,
          }}
        />
      </head>
      <body className={`${notoSansKr.className} h-full bg-gray-50 antialiased`}>
        <AuthProvider>
          {children}
          <Toaster richColors closeButton position="top-right" />
        </AuthProvider>
      </body>
    </html>
  );
}

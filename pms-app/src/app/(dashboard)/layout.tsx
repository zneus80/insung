import AuthGuard from '@/components/layout/AuthGuard';
import Sidebar from '@/components/layout/Sidebar';
import RoleFontWrapper from '@/components/layout/RoleFontWrapper';
import ScrollRestoration from '@/components/layout/ScrollRestoration';
import PasswordAgeBanner from '@/components/layout/PasswordAgeBanner';
import DevRoleSwitcher from '@/components/dev/DevRoleSwitcher';
import { ActiveYearProvider } from '@/contexts/ActiveYearContext';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <ActiveYearProvider>
        <RoleFontWrapper>
          <div className="flex h-screen overflow-hidden">
            <Sidebar />
            <div className="flex flex-1 flex-col overflow-hidden">
              <PasswordAgeBanner />
              {/* 모바일 하단 네비게이션 바에 가려지지 않도록 하단 패딩(데스크톱은 0) */}
              <main className="flex-1 overflow-y-auto pb-16 md:pb-0">{children}</main>
              <ScrollRestoration />
            </div>
          </div>
        </RoleFontWrapper>
        {process.env.NODE_ENV === 'development' && <DevRoleSwitcher />}
      </ActiveYearProvider>
    </AuthGuard>
  );
}

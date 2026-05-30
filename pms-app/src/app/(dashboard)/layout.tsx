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
              <main className="flex-1 overflow-y-auto">{children}</main>
              <ScrollRestoration />
            </div>
          </div>
        </RoleFontWrapper>
        {process.env.NODE_ENV === 'development' && <DevRoleSwitcher />}
      </ActiveYearProvider>
    </AuthGuard>
  );
}

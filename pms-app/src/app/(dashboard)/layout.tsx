import AuthGuard from '@/components/layout/AuthGuard';
import Sidebar from '@/components/layout/Sidebar';
import RoleFontWrapper from '@/components/layout/RoleFontWrapper';
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
              <main className="flex-1 overflow-y-auto">{children}</main>
            </div>
          </div>
        </RoleFontWrapper>
        {process.env.NODE_ENV === 'development' && <DevRoleSwitcher />}
      </ActiveYearProvider>
    </AuthGuard>
  );
}

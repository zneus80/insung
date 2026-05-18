import AuthGuard from '@/components/layout/AuthGuard';
import Sidebar from '@/components/layout/Sidebar';
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
        <div className="flex h-screen overflow-hidden">
          <Sidebar />
          <div className="flex flex-1 flex-col overflow-hidden">
            <main className="flex-1 overflow-y-auto">{children}</main>
          </div>
        </div>
        {process.env.NODE_ENV === 'development' && <DevRoleSwitcher />}
      </ActiveYearProvider>
    </AuthGuard>
  );
}

'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Target,
  TrendingUp,
  Users,
  BarChart3,
  Settings,
  Building2,
  CheckSquare,
  Star,
  Flag,
  LogOut,
  FileText,
  MessageSquareHeart,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { signOut } from '@/lib/auth';
import type { UserRole } from '@/types';

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  roles?: UserRole[];
  requireHrAdmin?: boolean;
}

const navItems: NavItem[] = [
  // ── 전체 공통 ──────────────────────────────────
  {
    label: '대시보드',
    href: '/dashboard',
    icon: <LayoutDashboard className="h-5 w-5" />,
  },

  // ── 팀원 전용 ────────────────────────────────
  {
    label: '목표관리',
    href: '/goals',
    icon: <Target className="h-5 w-5" />,
    roles: ['MEMBER'],
  },

  // ── 팀원·팀장 공통 ─────────────────────────
  {
    label: '자기 평가',
    href: '/performance',
    icon: <FileText className="h-5 w-5" />,
    roles: ['MEMBER', 'TEAM_LEAD'],
  },
  {
    label: '승인 대기함',
    href: '/approvals',
    icon: <CheckSquare className="h-5 w-5" />,
    roles: ['MEMBER', 'TEAM_LEAD'],
  },
  {
    label: '평가결과 확인',
    href: '/evaluation/result',
    icon: <CheckSquare className="h-5 w-5" />,
    roles: ['MEMBER', 'TEAM_LEAD', 'EXECUTIVE'],
  },
  {
    label: '1on1',
    href: '/oneon1',
    icon: <Users className="h-5 w-5" />,
    roles: ['MEMBER', 'TEAM_LEAD'],
  },
  {
    label: '육성면담서',
    href: '/mentoring',
    icon: <MessageSquareHeart className="h-5 w-5" />,
    roles: ['MEMBER', 'TEAM_LEAD', 'EXECUTIVE'],
  },

  // ── 팀장 전용 ────────────────────────────────
  {
    label: '내 목표 진행현황',
    href: '/goals',
    icon: <Target className="h-5 w-5" />,
    roles: ['TEAM_LEAD'],
  },
  {
    label: '팀원목표',
    href: '/progress',
    icon: <TrendingUp className="h-5 w-5" />,
    roles: ['TEAM_LEAD'],
  },
  {
    label: '팀원 평가',
    href: '/evaluation',
    icon: <BarChart3 className="h-5 w-5" />,
    roles: ['TEAM_LEAD'],
  },

  // ── 임원 전용 ────────────────────────────────
  {
    label: '팀장 업무 진행사항',
    href: '/progress/leads',
    icon: <TrendingUp className="h-5 w-5" />,
    roles: ['EXECUTIVE'],
  },
  {
    label: '팀원 업무 진행사항',
    href: '/progress/members',
    icon: <TrendingUp className="h-5 w-5" />,
    roles: ['EXECUTIVE'],
  },
  {
    label: '평가등급 확정',
    href: '/evaluation',
    icon: <BarChart3 className="h-5 w-5" />,
    roles: ['EXECUTIVE'],
  },

  // ── CEO 전용 ─────────────────────────────────
  {
    label: '진행현황',
    href: '/progress',
    icon: <TrendingUp className="h-5 w-5" />,
    roles: ['CEO'],
  },
  {
    label: '조직평가관리',
    href: '/evaluation/org',
    icon: <BarChart3 className="h-5 w-5" />,
    roles: ['CEO'],
  },

  // ── CEO·HR관리자 공통 ─────────────────────────
  {
    label: '사용자 관리',
    href: '/admin/users',
    icon: <Users className="h-5 w-5" />,
    roles: ['CEO'],
    requireHrAdmin: true,
  },
  {
    label: '조직 관리',
    href: '/admin/organizations',
    icon: <Building2 className="h-5 w-5" />,
    roles: ['CEO'],
    requireHrAdmin: true,
  },
  {
    label: '연간 목표 관리',
    href: '/admin/annual-goals',
    icon: <Flag className="h-5 w-5" />,
    roles: ['CEO'],
    requireHrAdmin: true,
  },
  {
    label: '마일리지 관리',
    href: '/admin/mileage',
    icon: <Star className="h-5 w-5" />,
    roles: ['CEO'],
    requireHrAdmin: true,
  },
  {
    label: '시스템 설정',
    href: '/admin/settings',
    icon: <Settings className="h-5 w-5" />,
    roles: ['CEO'],
    requireHrAdmin: true,
  },

  // ── HR관리자 전용 ──────────────────────────────
  {
    label: '조직평가인원관리',
    href: '/evaluation/org',
    icon: <BarChart3 className="h-5 w-5" />,
    requireHrAdmin: true,
  },
  {
    label: '평가기간 관리',
    href: '/admin/evaluation-period',
    icon: <Flag className="h-5 w-5" />,
    requireHrAdmin: true,
  },
  {
    label: '평가이력 관리',
    href: '/admin/evaluation-history',
    icon: <BarChart3 className="h-5 w-5" />,
    roles: ['CEO'],
    requireHrAdmin: true,
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { userProfile } = useAuth();

  async function handleLogout() {
    await signOut();
    router.replace('/login');
  }

  const visibleItems = navItems.filter(item => {
    const roleOk = !item.roles || (!!userProfile && item.roles.includes(userProfile.role));
    const hrOk = !!item.requireHrAdmin && !!userProfile?.isHrAdmin;
    if (!item.roles && !item.requireHrAdmin) return true;
    return roleOk || hrOk;
  });

  return (
    <aside className="flex h-full w-60 flex-col border-r border-gray-200 bg-white">
      {/* 로고 */}
      <div className="flex h-16 items-center gap-2 border-b border-gray-200 px-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-sm font-bold text-white">
          P
        </div>
        <span className="text-sm font-semibold text-gray-900">INSUNG</span>
      </div>

      {/* 네비게이션 */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {visibleItems.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.label}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              )}
            >
              <span className={isActive ? 'text-blue-600' : 'text-gray-400'}>
                {item.icon}
              </span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* 하단: 역할 배지 + 로그아웃 */}
      {userProfile && (
        <div className="border-t border-gray-200 px-4 py-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-900">{userProfile.name}</p>
              <div className="flex gap-1 flex-wrap">
                <RoleBadge role={userProfile.role} />
                {userProfile.isHrAdmin && (
                  <span className="inline-block rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-medium text-orange-700">
                    HR관리자
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
              title="로그아웃"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}

function RoleBadge({ role }: { role: UserRole }) {
  const labels: Record<UserRole, { label: string; color: string }> = {
    MEMBER: { label: '팀원', color: 'bg-gray-100 text-gray-700' },
    TEAM_LEAD: { label: '팀장', color: 'bg-green-100 text-green-700' },
    EXECUTIVE: { label: '임원', color: 'bg-purple-100 text-purple-700' },
    CEO: { label: '최고관리자', color: 'bg-blue-100 text-blue-700' },
  };
  const { label, color } = labels[role] ?? { label: role, color: 'bg-gray-100 text-gray-700' };
  return (
    <span className={cn('inline-block rounded-full px-2.5 py-0.5 text-xs font-medium', color)}>
      {label}
    </span>
  );
}

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
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
  MessageSquareHeart,
  Bell,
  BellRing,
  Trophy,
  CalendarClock,
  HardDrive,
  ClipboardList,
  Lightbulb,
  ShieldCheck,
  ShieldAlert,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useActiveYear } from '@/contexts/ActiveYearContext';
import { signOut } from '@/lib/auth';
import {
  getUnreadNotificationCount,
  getOrganizations, getAllUsers, getPendingGoalsByOrganizations,
  getAnnouncements, getTeamWeeklyTask,
} from '@/lib/firestore';
import type { UserRole } from '@/types';
import { filterMyActionableGoals, type EffectiveEvalRole } from '@/lib/approval-filters';

// 사이드바 배지용 ISO 주차 (tasks 페이지와 동일 규칙)
function sidebarISOWeek(date: Date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return { year: d.getUTCFullYear(), week: Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7) };
}

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  roles?: UserRole[];
  requireHrAdmin?: boolean;
  requireHrMaster?: boolean;  // HR 마스터 전용 메뉴 (평가이력·조직평가인원·등급설정 등)
  /** 조직 체인 기반 유효 평가 권한으로 필터 (있으면 roles 대신 이쪽 우선) */
  evalRoles?: EffectiveEvalRole[];
  exact?: boolean;
  group?: string;
}

const navItems: NavItem[] = [
  // ── 1. 대시보드 ──────────────────────────────
  {
    label: '대시보드',
    href: '/dashboard',
    icon: <LayoutDashboard className="h-5 w-5" />,
  },
  // ── 2. 알림 ─────────────────────────────────
  {
    label: '알림',
    href: '/notifications',
    icon: <BellRing className="h-5 w-5" />,
  },
  // ── 3. 공지사항 ──────────────────────────────
  {
    label: '공지사항',
    href: '/announcements',
    icon: <Bell className="h-5 w-5" />,
  },
  // ── 4. 핵심목표관리(또는 진행현황) ────────────
  {
    label: '핵심목표관리',
    href: '/goals',
    icon: <Target className="h-5 w-5" />,
    roles: ['MEMBER', 'TEAM_LEAD'],
  },
  {
    label: '핵심목표 진행현황',
    href: '/progress/leads',
    icon: <TrendingUp className="h-5 w-5" />,
    roles: ['EXECUTIVE'],
  },
  {
    label: '조직목표현황',
    href: '/progress',
    icon: <TrendingUp className="h-5 w-5" />,
    roles: ['CEO'],
  },
  // ── 5. 주간업무보고 ──────────────────────────
  {
    label: '주간업무보고',
    href: '/tasks',
    icon: <ClipboardList className="h-5 w-5" />,
    roles: ['MEMBER', 'TEAM_LEAD', 'EXECUTIVE'],
  },
  // ── 6. 승인 대기함 ───────────────────────────
  {
    label: '승인 대기함',
    href: '/approvals',
    icon: <CheckSquare className="h-5 w-5" />,
    roles: ['TEAM_LEAD', 'EXECUTIVE'],
  },

  // ── 7. 전사 업무추진현황 (CEO 제외 — CEO 는 대시보드에 임베드됨) ─
  {
    label: '전사 업무추진현황',
    href: '/progress/company',
    icon: <TrendingUp className="h-5 w-5" />,
    roles: ['MEMBER', 'TEAM_LEAD', 'EXECUTIVE'],
  },

  // ── 7-1. 전사 인원현황 (CEO + HR 마스터) — 그룹 없이 단독 ─
  {
    label: '전사 인원현황',
    href: '/admin/all-members',
    icon: <Users className="h-5 w-5" />,
    roles: ['CEO'],
  },
  {
    label: '전사 인원현황',
    href: '/admin/all-members',
    icon: <Users className="h-5 w-5" />,
    requireHrMaster: true,
  },

  // ══ EGG Meeting ═════════════════════════════
  // 1on1 — 현재 미사용으로 메뉴에서 숨김 (기능/페이지는 보존, 필요 시 주석 해제로 복구)
  // {
  //   label: '1on1',
  //   href: '/oneon1',
  //   icon: <Users className="h-5 w-5" />,
  //   roles: ['MEMBER', 'TEAM_LEAD', 'EXECUTIVE'],
  //   group: 'EGG Meeting',
  // },
  {
    label: '육성면담서',
    href: '/mentoring',
    icon: <MessageSquareHeart className="h-5 w-5" />,
    roles: ['MEMBER', 'TEAM_LEAD'],
    exact: true,
    group: 'EGG Meeting',
  },
  {
    label: '전사 육성면담서 확인',
    href: '/mentoring/all',
    icon: <MessageSquareHeart className="h-5 w-5" />,
    roles: ['CEO'],
    group: 'EGG Meeting',
  },
  {
    label: '전사 육성면담서 확인',
    href: '/mentoring/all',
    icon: <MessageSquareHeart className="h-5 w-5" />,
    requireHrAdmin: true,
    group: 'EGG Meeting',
  },

  // ══ 인사고과 ════════════════════════════════
  // 자기평가 — v0.9 육성면담서로 통합되어 메뉴 제거. (/evaluation 진입 시 작성자 역할은 /mentoring 으로 이동)
  // {
  //   label: '자기평가',
  //   href: '/evaluation',
  //   icon: <FileText className="h-5 w-5" />,
  //   roles: ['MEMBER', 'TEAM_LEAD'],
  //   exact: true,
  //   group: '인사고과',
  // },
  {
    label: '인사평가',
    href: '/evaluation/team',
    icon: <BarChart3 className="h-5 w-5" />,
    // 1차 의견(팀장) + 2차 의견(본부장 = HQ leader) + 차순위 임원(EXEC_SUB) 모두 진입
    evalRoles: ['TEAM_LEAD', 'HQ_HEAD', 'EXEC_SUB'],
    group: '인사고과',
  },
  {
    label: '평가등급확정',
    href: '/evaluation',
    icon: <BarChart3 className="h-5 w-5" />,
    // 최상위 임원(DIVISION leader / 상위에 DIVISION 없는 HQ leader) 만 확정 권한
    evalRoles: ['EXEC_TOP'],
    exact: true,
    group: '인사고과',
  },
  {
    label: '조직평가관리',
    href: '/evaluation/org?mode=grade',
    icon: <BarChart3 className="h-5 w-5" />,
    roles: ['CEO'],
    group: '인사고과',
  },
  {
    label: '평가이력 관리',
    href: '/admin/evaluation-history',
    icon: <BarChart3 className="h-5 w-5" />,
    roles: ['CEO'],
    group: '인사고과',
  },
  {
    label: '전사 평가진행확인',
    href: '/evaluation/result/all',
    icon: <CheckSquare className="h-5 w-5" />,
    roles: ['CEO'],
    group: '인사고과',
  },
  {
    label: '평가결과 확인',
    href: '/evaluation/result',
    icon: <CheckSquare className="h-5 w-5" />,
    roles: ['MEMBER', 'TEAM_LEAD'],
    exact: true,
    group: '인사고과',
  },

  // ── HR관리자 전용 — 기본정보입력 ─────────────────────
  {
    label: '조직 관리',
    href: '/admin/organizations',
    icon: <Building2 className="h-5 w-5" />,
    requireHrAdmin: true,
    group: '기본정보입력',
  },
  {
    label: '사용자 관리',
    href: '/admin/users',
    icon: <Users className="h-5 w-5" />,
    requireHrAdmin: true,
    group: '기본정보입력',
  },
  {
    label: '마일리지 관리',
    href: '/admin/mileage',
    icon: <Star className="h-5 w-5" />,
    requireHrAdmin: true,
    group: '기본정보입력',
  },
  {
    label: '포상 이력 관리',
    href: '/admin/awards',
    icon: <Trophy className="h-5 w-5" />,
    requireHrAdmin: true,
    group: '기본정보입력',
  },
  {
    label: '혁신활동 관리',
    href: '/admin/innovation',
    icon: <Lightbulb className="h-5 w-5" />,
    requireHrAdmin: true,
    group: '기본정보입력',
  },
  {
    label: '연간 목표 관리',
    href: '/admin/annual-goals',
    icon: <Flag className="h-5 w-5" />,
    requireHrAdmin: true,
    group: '기본정보입력',
  },

  // ── HR관리자 전용 — 인사평가 설정 ────────────────────
  {
    label: '평가기간 관리',
    href: '/admin/evaluation-period',
    icon: <Flag className="h-5 w-5" />,
    requireHrAdmin: true,
    group: '인사평가 설정',
  },
  {
    label: '평가이력 관리',
    href: '/admin/evaluation-history',
    icon: <BarChart3 className="h-5 w-5" />,
    requireHrMaster: true,
    group: '인사평가 설정',
  },
  {
    label: '조직평가관리',
    href: '/evaluation/org?mode=grade',
    icon: <BarChart3 className="h-5 w-5" />,
    requireHrMaster: true,
    group: '인사평가 설정',
  },
  {
    label: '조직평가인원관리',
    href: '/evaluation/org?mode=quota',
    icon: <BarChart3 className="h-5 w-5" />,
    requireHrMaster: true,
    group: '인사평가 설정',
  },
  {
    label: '전사 평가진행확인',
    href: '/evaluation/result/all',
    icon: <CheckSquare className="h-5 w-5" />,
    requireHrMaster: true,
    group: '인사평가 설정',
  },
  {
    label: '개인평가등급 설정',
    href: '/admin/settings',
    icon: <Settings className="h-5 w-5" />,
    requireHrMaster: true,
    group: '인사평가 설정',
  },

  // ── HR관리자 전용 — 시스템 설정 ──────────────────────
  {
    label: '연도 전환 관리',
    href: '/admin/year-transition',
    icon: <CalendarClock className="h-5 w-5" />,
    requireHrAdmin: true,
    group: '시스템 설정',
  },
  {
    label: '데이터 백업 관리',
    href: '/admin/backup',
    icon: <HardDrive className="h-5 w-5" />,
    requireHrMaster: true,
    group: '시스템 설정',
  },

  // ── 최고관리자 전용 — HR 권한 관리 ───────────────────
  {
    label: 'HR 마스터 권한 관리',
    href: '/admin/hr-master',
    icon: <ShieldCheck className="h-5 w-5" />,
    roles: ['CEO'],
    group: '시스템 설정',
  },
  {
    label: '감사 로그',
    href: '/admin/audit-log',
    icon: <ShieldAlert className="h-5 w-5" />,
    requireHrMaster: true,
    group: '시스템 설정',
  },
  // 가시성 ACL 백필 — 현재 미사용(viewableBy 철회). 메뉴 잠금. 필요 시 주석 해제.
  // {
  //   label: '가시성 ACL 백필',
  //   href: '/admin/security-acl',
  //   icon: <ShieldCheck className="h-5 w-5" />,
  //   requireHrMaster: true,
  //   group: '시스템 설정',
  // },
];

export default function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { userProfile, effectiveEvalRole } = useAuth();
  const { activeYear, calendarYear } = useActiveYear();
  const [unreadCount, setUnreadCount] = useState(0);
  const [approvalsCount, setApprovalsCount] = useState(0);
  const [announcementsNew, setAnnouncementsNew] = useState(false);
  const [weeklyNew, setWeeklyNew] = useState(false);

  // 알림 미읽음 카운트 — 페이지 변경마다 갱신 (가벼운 query)
  useEffect(() => {
    if (!userProfile) return;
    let cancelled = false;
    getUnreadNotificationCount(userProfile.id).then(n => {
      if (!cancelled) setUnreadCount(n);
    }).catch(() => { /* 무시 */ });
    return () => { cancelled = true; };
  }, [userProfile, pathname]);

  // 사이드바 배지 — 승인대기 카운트 / 공지·주간보고 신규 여부 (localStorage last-seen 비교)
  useEffect(() => {
    if (!userProfile) return;
    let cancelled = false;
    const uid = userProfile.id;
    const role = userProfile.role;
    const orgId = userProfile.organizationId;
    (async () => {
      // 1) 승인 대기 (팀장·임원) — 내가 처리할 단계인 목표 수
      if (role === 'TEAM_LEAD' || role === 'EXECUTIVE') {
        try {
          const allOrgs = await getOrganizations();
          const descIds = (root: string): string[] => {
            const ids = [root];
            allOrgs.filter(o => o.parentId === root).forEach(c => ids.push(...descIds(c.id)));
            return ids;
          };
          const rootSet = new Set<string>([orgId]);
          allOrgs.filter(o => o.leaderId === uid).forEach(o => rootSet.add(o.id));
          const scopeOrgIds = [...new Set([...rootSet].flatMap(id => descIds(id)))];
          const [pending, allUsers] = await Promise.all([
            getPendingGoalsByOrganizations(scopeOrgIds),
            getAllUsers(),
          ]);
          const usersMap = Object.fromEntries(allUsers.map(u => [u.id, u]));
          const cnt = filterMyActionableGoals(pending, allOrgs, usersMap, uid, role).length;
          if (!cancelled) setApprovalsCount(cnt);
        } catch { /* 무시 */ }
      }
      // 2) 공지사항 신규
      try {
        const anns = await getAnnouncements();
        const latest = anns.reduce((m, a) => {
          const t = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
          return Math.max(m, t);
        }, 0);
        if (typeof window !== 'undefined' && !cancelled) {
          const key = `seenAnn_${uid}`;
          if (pathname.startsWith('/announcements')) { localStorage.setItem(key, String(latest)); setAnnouncementsNew(false); }
          else setAnnouncementsNew(latest > Number(localStorage.getItem(key) ?? 0));
        }
      } catch { /* 무시 */ }
      // 3) 주간업무보고 신규 — 우리 팀 이번 주 문서 updatedAt 비교
      try {
        const { year, week } = sidebarISOWeek(new Date());
        const wt = orgId ? await getTeamWeeklyTask(orgId, year, week) : null;
        const upd = wt?.updatedAt instanceof Date ? wt.updatedAt.getTime() : 0;
        if (typeof window !== 'undefined' && !cancelled) {
          const key = `seenWeekly_${uid}`;
          if (pathname.startsWith('/tasks')) { localStorage.setItem(key, String(upd)); setWeeklyNew(false); }
          else setWeeklyNew(upd > 0 && upd > Number(localStorage.getItem(key) ?? 0));
        }
      } catch { /* 무시 */ }
    })();
    return () => { cancelled = true; };
  }, [userProfile, pathname]);

  async function handleLogout() {
    await signOut();
    router.replace('/login');
  }

  const visibleItemsRaw = navItems.filter(item => {
    // 역할·HR·평가권한 제한이 모두 없으면 전체 표시
    if (!item.roles && !item.requireHrAdmin && !item.requireHrMaster && !item.evalRoles) return true;
    // 역할 조건: roles 배열이 있을 때만 체크
    const roleOk = !!item.roles && !!userProfile && item.roles.includes(userProfile.role);
    // HR 관리자 조건
    const hrOk = !!item.requireHrAdmin && !!userProfile?.isHrAdmin;
    const masterOk = !!item.requireHrMaster && !!userProfile?.isHrMaster;
    // 유효 평가 권한 조건 (조직 체인 기반)
    const evalOk = !!item.evalRoles && item.evalRoles.includes(effectiveEvalRole);
    // CEO Viewer — CEO 전용 메뉴 모두 표시 (read-only)
    const ceoViewerOk = !!item.roles && item.roles.includes('CEO') && !!userProfile?.isCeoViewer;
    return roleOk || hrOk || masterOk || evalOk || ceoViewerOk;
  });
  // CEO+HR 등 중복 진입(같은 label + href + group)을 한 번만 표시 — 라벨이 다르면 별개 항목으로 유지
  const seenKeys = new Set<string>();
  const visibleItems = visibleItemsRaw.filter(item => {
    const key = `${item.label}__${item.href}__${item.group ?? ''}`;
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });

  return (
    <aside className="flex h-full w-60 flex-col border-r border-gray-200 bg-white">
      {/* 로고 — 클릭 시 대시보드 이동 */}
      <Link
        href="/dashboard"
        className="flex h-16 items-center gap-2 border-b border-gray-200 px-6 hover:bg-gray-50 transition-colors"
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-sm font-bold text-white">
          P
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold text-gray-900">INSUNG</span>
          <span className={cn(
            'text-[10px] font-medium',
            activeYear === calendarYear ? 'text-gray-400' : 'text-orange-600',
          )}>
            {activeYear}년 활성{activeYear !== calendarYear && ` · 달력 ${calendarYear}`}
          </span>
        </div>
      </Link>

      {/* 네비게이션 */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {(() => {
          const normalizedPath = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
          // 현재 URL 의 ?mode= 파라미터 (조직평가 페이지 등에서 메뉴 구분용)
          const currentMode = searchParams.get('mode');
          let lastGroup: string | undefined = undefined;
          return visibleItems.map((item) => {
            // item.href 에서 path 와 query 분리
            const [itemPath, itemQuery] = item.href.split('?');
            const itemModeMatch = itemQuery?.match(/(?:^|&)mode=([^&]+)/);
            const itemMode = itemModeMatch?.[1];
            const pathOk = item.exact
              ? normalizedPath === itemPath
              : normalizedPath === itemPath || normalizedPath.startsWith(itemPath + '/');
            // mode 가 지정된 항목은 현재 URL 의 mode 와 정확히 일치해야 active
            // mode 가 없는 항목은 현재 URL 에도 mode 가 없을 때만 active (다른 mode 메뉴와 혼동 방지)
            const modeOk = itemMode ? currentMode === itemMode : !currentMode;
            const isActive = pathOk && modeOk;
            const showGroupHeader = item.group && item.group !== lastGroup;
            if (item.group) lastGroup = item.group;
            return (
              <div key={`${item.href}__${item.group ?? ''}__${item.label}`}>
                {showGroupHeader && (
                  <p className="mt-4 mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
                    {item.group}
                  </p>
                )}
                <Link
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
                  <span className="flex-1">{item.label}</span>
                  {item.href === '/notifications' && unreadCount > 0 && (
                    <span className="rounded-full bg-red-500 text-white text-[10px] font-bold min-w-[18px] h-[18px] inline-flex items-center justify-center px-1.5">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                  {item.href === '/approvals' && approvalsCount > 0 && (
                    <span className="rounded-full bg-red-500 text-white text-[10px] font-bold min-w-[18px] h-[18px] inline-flex items-center justify-center px-1.5">
                      {approvalsCount > 99 ? '99+' : approvalsCount}
                    </span>
                  )}
                  {item.href === '/announcements' && announcementsNew && (
                    <span className="h-2 w-2 rounded-full bg-red-500" title="새 공지" />
                  )}
                  {item.href === '/tasks' && weeklyNew && (
                    <span className="h-2 w-2 rounded-full bg-red-500" title="새 작성 내용" />
                  )}
                </Link>
              </div>
            );
          });
        })()}
      </nav>

      {/* 하단: 역할 배지 + 로그아웃 */}
      {userProfile && (
        <div className="border-t border-gray-200 px-4 py-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-900">{userProfile.name}</p>
              <div className="flex gap-1 flex-wrap">
                <RoleBadge role={userProfile.role} />
                {userProfile.isHrMaster ? (
                  <span className="inline-block rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-700">
                    HR마스터
                  </span>
                ) : userProfile.isHrAdmin ? (
                  <span className="inline-block rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-medium text-orange-700">
                    HR관리자
                  </span>
                ) : null}
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

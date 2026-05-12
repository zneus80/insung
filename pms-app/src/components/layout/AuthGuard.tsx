'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import type { UserRole } from '@/types';

interface AuthGuardProps {
  children: React.ReactNode;
  allowedRoles?: UserRole[];
  requireHrAdmin?: boolean;  // true면 isHrAdmin 사용자도 접근 가능
}

function canAccess(
  profile: { role: UserRole; isHrAdmin?: boolean } | null,
  allowedRoles?: UserRole[],
  requireHrAdmin?: boolean,
): boolean {
  if (!profile) return false;
  if (!allowedRoles && !requireHrAdmin) return true;
  const roleOk = !!allowedRoles && allowedRoles.includes(profile.role);
  const hrOk = !!requireHrAdmin && !!profile.isHrAdmin;
  return roleOk || hrOk;
}

const IS_MOCK = process.env.NEXT_PUBLIC_MOCK_AUTH === 'true';

export default function AuthGuard({ children, allowedRoles, requireHrAdmin }: AuthGuardProps) {
  const { firebaseUser, userProfile, loading } = useAuth();
  const router = useRouter();

  // 목업 모드: userProfile이 있으면 인증된 것으로 처리
  const isAuthenticated = IS_MOCK ? !!userProfile : !!firebaseUser;

  useEffect(() => {
    if (loading) return;

    if (!isAuthenticated) {
      router.replace('/login');
      return;
    }

    if ((allowedRoles || requireHrAdmin) && userProfile && !canAccess(userProfile, allowedRoles, requireHrAdmin)) {
      router.replace('/dashboard');
    }
  }, [isAuthenticated, userProfile, loading, allowedRoles, requireHrAdmin, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  if (!isAuthenticated) return null;

  if ((allowedRoles || requireHrAdmin) && userProfile && !canAccess(userProfile, allowedRoles, requireHrAdmin)) {
    return null;
  }

  return <>{children}</>;
}

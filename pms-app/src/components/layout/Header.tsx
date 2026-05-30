'use client';

import { useRef, useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { signOut } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { LogOut, User, ArrowLeft } from 'lucide-react';
import MemberInfoModal from '@/components/members/MemberInfoModal';

interface HeaderProps {
  title?: string;
  showBack?: boolean;
}

export default function Header({ title, showBack }: HeaderProps) {
  const { userProfile, firebaseUser } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 외부 클릭 시 닫기
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function handleSignOut() {
    setOpen(false);
    await signOut();
    router.replace('/login');
  }

  const initials = userProfile?.name
    ? userProfile.name.slice(0, 2)
    : firebaseUser?.email?.slice(0, 2).toUpperCase() ?? 'U';

  return (
    <header className="flex h-16 items-center justify-between border-b border-gray-200 bg-white px-6 shrink-0">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        {showBack && (
          <button
            onClick={() => router.back()}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
            title="뒤로 가기"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            뒤로
          </button>
        )}
      </div>

      {/* 사용자 드롭다운 */}
      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen(prev => !prev)}
          className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-100 transition-colors"
        >
          <Avatar className="h-8 w-8">
            <AvatarImage src={userProfile?.photoURL ?? firebaseUser?.photoURL ?? ''} />
            <AvatarFallback className="bg-blue-100 text-blue-700 text-xs font-medium">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="text-left hidden sm:block">
            <p className="text-sm font-medium text-gray-900 leading-tight">
              {userProfile?.name ?? firebaseUser?.displayName ?? '사용자'}
            </p>
            {userProfile?.position && (
              <p className="text-xs text-gray-500 leading-tight">{userProfile.position}</p>
            )}
          </div>
        </button>

        {/* 드롭다운 메뉴 */}
        {open && (
          <div className="absolute right-0 top-full mt-1 w-52 rounded-xl border border-gray-200 bg-white shadow-lg z-50 py-1">
            {/* 이메일 */}
            <div className="px-4 py-2.5 border-b border-gray-100">
              <p className="text-xs font-medium text-gray-900">
                {userProfile?.name ?? '사용자'}
              </p>
              <p className="text-xs text-gray-400 mt-0.5 truncate">
                {firebaseUser?.email}
              </p>
            </div>

            {/* 내 프로필 — 임원·최고관리자 제외 (프로필 불필요 역할) */}
            {userProfile?.role !== 'EXECUTIVE' && userProfile?.role !== 'CEO' && (
              <>
                <button
                  onClick={() => { setOpen(false); setProfileOpen(true); }}
                  className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <User className="h-4 w-4" />
                  내 프로필
                </button>

                <div className="border-t border-gray-100 my-1" />
              </>
            )}

            {/* 로그아웃 */}
            <button
              onClick={handleSignOut}
              className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
            >
              <LogOut className="h-4 w-4" />
              로그아웃
            </button>
          </div>
        )}
      </div>

      {/* 내 프로필 모달 — 드롭다운 외부에서 제어 (임원·최고관리자 제외) */}
      {userProfile && userProfile.role !== 'EXECUTIVE' && userProfile.role !== 'CEO' && (
        <MemberInfoModal
          userId={userProfile.id}
          userName={userProfile.name}
          open={profileOpen}
          onOpenChange={setProfileOpen}
        />
      )}
    </header>
  );
}

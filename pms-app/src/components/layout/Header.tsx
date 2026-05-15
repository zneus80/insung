'use client';

import { useAuth } from '@/contexts/AuthContext';
import { signOut } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LogOut, User, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import NotificationBell from './NotificationBell';

interface HeaderProps {
  title?: string;
}

export default function Header({ title }: HeaderProps) {
  const { userProfile, firebaseUser } = useAuth();
  const router = useRouter();

  async function handleSignOut() {
    await signOut();
    router.replace('/login');
    toast.success('로그아웃 되었습니다.');
  }

  const initials = userProfile?.name
    ? userProfile.name.slice(0, 2)
    : firebaseUser?.email?.slice(0, 2).toUpperCase() ?? 'U';

  return (
    <header className="flex h-16 items-center justify-between border-b border-gray-200 bg-white px-6">
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      <div className="flex items-center gap-2">
        <NotificationBell />
        <DropdownMenu>
        <DropdownMenuTrigger className="flex items-center gap-2 rounded-lg p-1.5 hover:bg-gray-100 cursor-pointer outline-none">
          <Avatar className="h-8 w-8">
            <AvatarImage src={userProfile?.photoURL ?? firebaseUser?.photoURL ?? ''} />
            <AvatarFallback className="bg-blue-100 text-blue-700 text-xs font-medium">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="text-left">
            <p className="text-sm font-medium text-gray-900">
              {userProfile?.name ?? firebaseUser?.displayName ?? '사용자'}
            </p>
            <p className="text-xs text-gray-500">{userProfile?.position ?? userProfile?.role}</p>
          </div>
          <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel className="text-xs text-gray-500">
            {firebaseUser?.email}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="gap-2 cursor-pointer">
            <User className="h-4 w-4" />
            내 프로필
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={handleSignOut}
            className="gap-2 cursor-pointer text-red-600 focus:text-red-600"
          >
            <LogOut className="h-4 w-4" />
            로그아웃
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      </div>
    </header>
  );
}

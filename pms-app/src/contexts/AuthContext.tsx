'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import { onAuthChange } from '@/lib/auth';
import { getUser, updateUser } from '@/lib/firestore';
import type { User } from '@/types';

interface AuthContextValue {
  firebaseUser: FirebaseUser | null;
  userProfile: User | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  firebaseUser: null,
  userProfile: null,
  loading: true,
});

// ── 로컬 목업 유저 (NEXT_PUBLIC_MOCK_AUTH=true 일 때) ──
const MOCK_USER: User = {
  id: 'mock-member-001',
  email: 'mock-member@insungind.co.kr',
  name: '홍길동 (목업)',
  role: 'MEMBER',
  organizationId: 'mock-org-001',
  position: '사원',
  isActive: true,
  isHrAdmin: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const IS_MOCK = process.env.NEXT_PUBLIC_MOCK_AUTH === 'true';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [userProfile, setUserProfile] = useState<User | null>(IS_MOCK ? MOCK_USER : null);
  const [loading, setLoading] = useState(!IS_MOCK);

  useEffect(() => {
    if (IS_MOCK) return; // 목업 모드에서는 Firebase 연결 안 함

    const unsubscribe = onAuthChange(async (fbUser) => {
      if (fbUser) {
        const profile = await getUser(fbUser.uid);
        // 레거시 호환: role이 'HR_ADMIN'인 경우 → TEAM_LEAD + isHrAdmin: true로 변환
        if (profile && (profile.role as string) === 'HR_ADMIN') {
          profile.role = 'TEAM_LEAD';
          profile.isHrAdmin = true;
          await updateUser(fbUser.uid, { role: 'TEAM_LEAD', isHrAdmin: true });
        }
        setFirebaseUser(fbUser);
        setUserProfile(profile);
      } else {
        setFirebaseUser(null);
        setUserProfile(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  return (
    <AuthContext.Provider value={{ firebaseUser, userProfile, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

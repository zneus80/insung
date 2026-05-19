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
import type { User, UserRole } from '@/types';

interface AuthContextValue {
  firebaseUser: FirebaseUser | null;
  userProfile: User | null;   // 실제 or 미리보기 적용된 프로필
  realProfile: User | null;   // 실제 로그인 프로필 (항상 원본)
  loading: boolean;
  previewAs: (key: string) => void;  // 역할 미리보기 전환
  previewKey: string | null;         // 현재 미리보기 중인 역할 키
}

const AuthContext = createContext<AuthContextValue>({
  firebaseUser: null,
  userProfile: null,
  realProfile: null,
  loading: true,
  previewAs: () => {},
  previewKey: null,
});

// ── 역할별 미리보기 유저 ──
export const PREVIEW_USERS: Record<string, Omit<User, 'id' | 'email' | 'organizationId' | 'createdAt' | 'updatedAt'>> = {
  MEMBER:    { name: '미리보기 (팀원)',       role: 'MEMBER',    position: '사원',   isActive: true, isHrAdmin: false },
  TEAM_LEAD: { name: '미리보기 (팀장)',       role: 'TEAM_LEAD', position: '팀장',   isActive: true, isHrAdmin: false },
  EXECUTIVE: { name: '미리보기 (임원)',       role: 'EXECUTIVE', position: '이사',   isActive: true, isHrAdmin: false },
  CEO:       { name: '미리보기 (최고관리자)', role: 'CEO',       position: '대표이사', isActive: true, isHrAdmin: false },
  HR_ADMIN:  { name: '미리보기 (HR관리자)',   role: 'MEMBER',    position: '인사팀', isActive: true, isHrAdmin: true },
};

// ── 목업 모드 기본 유저 ──
export const MOCK_USERS: Record<string, User> = {
  MEMBER:    { id: 'mock-member-001', email: 'mock-member@insungind.co.kr', organizationId: 'mock-org-001', createdAt: new Date(), updatedAt: new Date(), ...PREVIEW_USERS.MEMBER },
  TEAM_LEAD: { id: 'mock-lead-001',   email: 'mock-lead@insungind.co.kr',   organizationId: 'mock-org-001', createdAt: new Date(), updatedAt: new Date(), ...PREVIEW_USERS.TEAM_LEAD },
  EXECUTIVE: { id: 'mock-exec-001',   email: 'mock-exec@insungind.co.kr',   organizationId: 'mock-org-001', createdAt: new Date(), updatedAt: new Date(), ...PREVIEW_USERS.EXECUTIVE },
  CEO:       { id: 'mock-ceo-001',    email: 'mock-ceo@insungind.co.kr',    organizationId: 'mock-org-001', createdAt: new Date(), updatedAt: new Date(), ...PREVIEW_USERS.CEO },
  HR_ADMIN:  { id: 'mock-hr-001',     email: 'mock-hr@insungind.co.kr',     organizationId: 'mock-org-001', createdAt: new Date(), updatedAt: new Date(), ...PREVIEW_USERS.HR_ADMIN },
};

const IS_MOCK = process.env.NEXT_PUBLIC_MOCK_AUTH === 'true';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [realProfile, setRealProfile] = useState<User | null>(IS_MOCK ? MOCK_USERS.MEMBER : null);
  const [previewKey, setPreviewKey] = useState<string | null>(IS_MOCK ? 'MEMBER' : null);
  const [loading, setLoading] = useState(!IS_MOCK);

  useEffect(() => {
    if (IS_MOCK) return;

    const unsubscribe = onAuthChange(async (fbUser) => {
      if (fbUser) {
        const profile = await getUser(fbUser.uid);
        if (profile && (profile.role as string) === 'HR_ADMIN') {
          profile.role = 'TEAM_LEAD';
          profile.isHrAdmin = true;
          await updateUser(fbUser.uid, { role: 'TEAM_LEAD', isHrAdmin: true });
        }
        setFirebaseUser(fbUser);
        setRealProfile(profile);
        setPreviewKey(null); // 로그인 시 미리보기 초기화
      } else {
        setFirebaseUser(null);
        setRealProfile(null);
        setPreviewKey(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  // 역할 미리보기 전환
  function previewAs(key: string) {
    setPreviewKey(key);
  }

  // userProfile: 미리보기 중이면 실제 프로필에 역할만 덮어씌움
  const userProfile: User | null = (() => {
    if (!realProfile) return null;
    if (!previewKey || !(previewKey in PREVIEW_USERS)) return realProfile;

    if (IS_MOCK) return MOCK_USERS[previewKey] ?? realProfile;

    // 실제 로그인 상태: id/email/organizationId는 유지, 역할/이름만 변경
    return {
      ...realProfile,
      ...PREVIEW_USERS[previewKey],
    };
  })();

  return (
    <AuthContext.Provider value={{ firebaseUser, userProfile, realProfile, loading, previewAs, previewKey }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

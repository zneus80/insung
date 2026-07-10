'use client';

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { toast } from 'sonner';
import { onAuthChange, signOut } from '@/lib/auth';
import { db } from '@/lib/firebase';
import { getUser, updateUser, getOrganizations, getLocalSessionId, registerActiveSession, isLocalDevHost, COLLECTIONS } from '@/lib/firestore';
import { getEffectiveEvalRole, type EffectiveEvalRole } from '@/lib/approval-filters';
import { leadsAnyEvalUnit } from '@/lib/org-eval';
import { useIdleLogout } from '@/hooks/useIdleLogout';
import type { User, UserRole, Organization } from '@/types';

interface AuthContextValue {
  firebaseUser: FirebaseUser | null;
  userProfile: User | null;   // 실제 or 미리보기 적용된 프로필
  realProfile: User | null;   // 실제 로그인 프로필 (항상 원본)
  loading: boolean;
  previewAs: (key: string) => void;  // 역할 미리보기 전환
  previewKey: string | null;         // 현재 미리보기 중인 역할 키
  /** 조직 체인 기반 유효 평가 권한 (EXEC_TOP / HQ_HEAD / TEAM_LEAD / MEMBER) */
  effectiveEvalRole: EffectiveEvalRole;
  /** 평가 단위 조직(부문/지정 본부 등)의 리더인가 — 평가등급확정 화면 진입·메뉴 노출 판단 */
  leadsEvalUnit: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  firebaseUser: null,
  userProfile: null,
  realProfile: null,
  loading: true,
  previewAs: () => {},
  previewKey: null,
  effectiveEvalRole: 'MEMBER',
  leadsEvalUnit: false,
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
  const [allOrgs, setAllOrgs] = useState<Organization[]>([]);

  // 조직 목록 로드 — effectiveEvalRole 산출용 (로그인 후 1회, 조직 변경 시는 새로고침으로 반영)
  useEffect(() => {
    if (IS_MOCK || !realProfile) return;
    getOrganizations().then(setAllOrgs).catch(() => {});
  }, [realProfile]);

  useEffect(() => {
    if (IS_MOCK) return;

    const unsubscribe = onAuthChange(async (fbUser) => {
      if (fbUser) {
        const profile = await getUser(fbUser.uid);
        // 표시범위 잠금 ON 중 대상 인원 세션은 즉시 종료(이미 로그인된 상태에서 전환된 경우 포함)
        if (profile?.viewTag) {
          try {
            const { isViewScopeLocked } = await import('@/lib/firestore');
            if (await isViewScopeLocked()) {
              const { signOut } = await import('@/lib/auth');
              await signOut();
              setFirebaseUser(null); setRealProfile(null); setPreviewKey(null); setLoading(false);
              return;
            }
          } catch { /* 조회 실패 시 통과 */ }
        }
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

  const effectiveEvalRole: EffectiveEvalRole = userProfile
    ? getEffectiveEvalRole(userProfile.id, userProfile.role, userProfile.organizationId, allOrgs)
    : 'MEMBER';

  const leadsEvalUnit: boolean = !!userProfile && leadsAnyEvalUnit(userProfile.id, allOrgs);

  // E-4: 세션 비활성 자동 로그아웃 (5분) — 로그인 상태에만 활성
  useIdleLogout({ enabled: !IS_MOCK && !!firebaseUser });

  // 로그인 상태인데 로컬 세션 ID가 없으면(기능 배포 전부터 유지된 세션·앱 복원 등) 지금 세션을 점유한다.
  // 이렇게 해야 옛 세션도 새 코드를 로드하는 순간 activeSessionId 를 등록 → 단일 세션 강제가 실제로 작동한다.
  useEffect(() => {
    if (IS_MOCK || !firebaseUser) return;
    if (getLocalSessionId()) return; // 이미 점유함(로그인 페이지에서 등록)
    // 로그인 직후엔 로그인 페이지가 곧 등록하므로 잠시 양보 후 재확인 → 이중 등록·self-kick 레이스 방지.
    const t = setTimeout(() => {
      if (firebaseUser && !getLocalSessionId()) registerActiveSession(firebaseUser.uid).catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, [firebaseUser]);

  // 중복로그인 방지 — 본인 활성 세션 ID 구독. "다른 기기가 새로 로그인"한 실제 변경 이벤트에서만 로그아웃(마지막 로그인 우선).
  // 견고성 3중 가드:
  //   ① fromCache 스냅샷 무시 — 서버 확정 값에서만 판정(로그인 직후 캐시 옛값 레이스 차단)
  //   ② 첫 서버 스냅샷은 '기준선'으로만 기록하고 로그아웃하지 않음 — 로드 시 로컬↔문서 불일치(옛 세션 잔재)로 인한 오탐 차단
  //   ③ 그 이후 remote 가 내 로컬 세션과 달라지는 '변경'에서만 로그아웃 — 실제 타 기기 접속만 반응
  const sessionBaselineRef = useRef(false);
  useEffect(() => {
    if (IS_MOCK || !firebaseUser) return;
    if (isLocalDevHost()) return; // 로컬 개발은 중복로그인 방지 비활성(운영 세션과 충돌 방지)
    sessionBaselineRef.current = false;
    const unsub = onSnapshot(doc(db, COLLECTIONS.USERS, firebaseUser.uid), snap => {
      if (snap.metadata.fromCache) return;                 // ① 서버 확정만
      if (!sessionBaselineRef.current) { sessionBaselineRef.current = true; return; } // ② 첫 서버 스냅샷 = 기준선
      const remote = snap.data()?.activeSessionId as string | undefined;
      const local = getLocalSessionId();
      if (remote && local && remote !== local) {           // ③ 이후 실제 변경(타 기기 접속)에서만
        signOut().catch(() => {});
        toast.error('다른 기기에서 로그인되어 이 기기는 로그아웃되었습니다.');
      }
    }, () => { /* 구독 실패 무시 */ });
    return unsub;
  }, [firebaseUser]);

  return (
    <AuthContext.Provider value={{ firebaseUser, userProfile, realProfile, loading, previewAs, previewKey, effectiveEvalRole, leadsEvalUnit }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

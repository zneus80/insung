'use client';

import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { signInWithTestAccount, signOut } from '@/lib/auth';

const ROLE_ACCOUNTS = [
  { label: '팀원',      email: 'sslee2@insungind.co.kr', color: 'bg-gray-500 hover:bg-gray-600',   isHrAdmin: false },
  { label: '팀장',      email: 'sslee3@insungind.co.kr', color: 'bg-green-600 hover:bg-green-700', isHrAdmin: false },
  { label: '임원',      email: 'sslee4@insungind.co.kr', color: 'bg-purple-600 hover:bg-purple-700', isHrAdmin: false },
  { label: '최고관리자', email: 'sslee1@insungind.co.kr', color: 'bg-blue-600 hover:bg-blue-700',  isHrAdmin: false },
  { label: 'HR관리자',  email: 'sslee@insungind.co.kr',  color: 'bg-orange-500 hover:bg-orange-600', isHrAdmin: true },
];

const PASSWORD = 'Insung@1234!';

export default function DevRoleSwitcher() {
  const { userProfile } = useAuth();
  const [switching, setSwitching] = useState<string | null>(null);

  if (!userProfile) return null;

  async function handleSwitch(email: string) {
    if (userProfile?.email === email) return;
    setSwitching(email);
    try {
      await signOut();
      await signInWithTestAccount(email, PASSWORD);
    } catch (e) {
      console.error('역할 전환 실패:', e);
    } finally {
      setSwitching(null);
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-1.5">
      <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">
        Dev · 역할 전환
      </span>
      <div className="flex gap-1.5 rounded-xl bg-black/80 px-3 py-2 shadow-xl backdrop-blur">
        {ROLE_ACCOUNTS.map(({ label, email, color }) => (
          <button
            key={email}
            onClick={() => handleSwitch(email)}
            disabled={switching !== null}
            className={`rounded-md px-2.5 py-1 text-xs font-semibold text-white transition-all ${color} ${
              userProfile?.email === email ? 'ring-2 ring-white ring-offset-1 ring-offset-black/80' : 'opacity-60'
            } ${switching === email ? 'animate-pulse' : ''}`}
          >
            {switching === email ? '...' : label}
          </button>
        ))}
      </div>
    </div>
  );
}

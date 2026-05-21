'use client';

import { useAuth } from '@/contexts/AuthContext';

const ROLE_LIST = [
  { label: '팀원',       key: 'MEMBER',    color: 'bg-gray-500 hover:bg-gray-600' },
  { label: '팀장',       key: 'TEAM_LEAD', color: 'bg-green-600 hover:bg-green-700' },
  { label: '임원',       key: 'EXECUTIVE', color: 'bg-purple-600 hover:bg-purple-700' },
  { label: '최고관리자', key: 'CEO',       color: 'bg-blue-600 hover:bg-blue-700' },
  { label: 'HR관리자',   key: 'HR_ADMIN',  color: 'bg-orange-500 hover:bg-orange-600' },
];

export default function DevRoleSwitcher() {
  const { userProfile, previewAs, previewKey } = useAuth();

  if (!userProfile) return null;

  const currentKey = previewKey ?? (userProfile.isHrAdmin ? 'HR_ADMIN' : userProfile.role);

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-1.5">
      <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">
        Dev · 역할 전환
      </span>
      <div className="flex gap-1.5 rounded-xl bg-black/80 px-3 py-2 shadow-xl backdrop-blur">
        {ROLE_LIST.map(({ label, key, color }) => (
          <button
            key={key}
            onClick={() => previewAs(key)}
            className={`rounded-md px-2.5 py-1 text-xs font-semibold text-white transition-all ${color} ${
              currentKey === key
                ? 'ring-2 ring-white ring-offset-1 ring-offset-black/80'
                : 'opacity-60'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

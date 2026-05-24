'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { onSnapshot, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

const CALENDAR_YEAR = new Date().getFullYear();

interface ActiveYearContextValue {
  activeYear: number;       // HR관리자가 설정한 활성 연도
  calendarYear: number;     // 실제 달력상 현재 연도
  loading: boolean;
}

const ActiveYearContext = createContext<ActiveYearContextValue>({
  activeYear: CALENDAR_YEAR,
  calendarYear: CALENDAR_YEAR,
  loading: true,
});

export function ActiveYearProvider({ children }: { children: React.ReactNode }) {
  const [activeYear, setActiveYear] = useState(CALENDAR_YEAR);
  const [loading, setLoading] = useState(true);

  // 실시간 구독 — HR 관리자가 연도 전환을 하면 모든 열린 탭에서 자동 반영
  useEffect(() => {
    const ref = doc(db, 'systemSettings', 'global');
    const unsub = onSnapshot(
      ref,
      snap => {
        if (snap.exists()) {
          const d = snap.data();
          if (typeof d.activeYear === 'number') setActiveYear(d.activeYear);
        }
        setLoading(false);
      },
      () => setLoading(false),
    );
    return () => unsub();
  }, []);

  return (
    <ActiveYearContext.Provider value={{ activeYear, calendarYear: CALENDAR_YEAR, loading }}>
      {children}
    </ActiveYearContext.Provider>
  );
}

export function useActiveYear(): ActiveYearContextValue {
  return useContext(ActiveYearContext);
}

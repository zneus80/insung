'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { onSnapshot, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

const CALENDAR_YEAR = new Date().getFullYear();

interface ActiveYearContextValue {
  activeYear: number;       // HR관리자가 설정한 활성 연도
  calendarYear: number;     // 실제 달력상 현재 연도
  loading: boolean;
  lockedYears: number[];    // 확정(잠금)된 연도 목록
  isYearLocked: (year: number) => boolean;  // 해당 연도가 확정(읽기 전용)인지
  activeYearLocked: boolean; // 현재 활성 연도가 확정 상태인지
}

const ActiveYearContext = createContext<ActiveYearContextValue>({
  activeYear: CALENDAR_YEAR,
  calendarYear: CALENDAR_YEAR,
  loading: true,
  lockedYears: [],
  isYearLocked: () => false,
  activeYearLocked: false,
});

export function ActiveYearProvider({ children }: { children: React.ReactNode }) {
  const [activeYear, setActiveYear] = useState(CALENDAR_YEAR);
  const [lockedYears, setLockedYears] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);

  // 실시간 구독 — HR 관리자가 연도 전환·확정을 하면 모든 열린 탭에서 자동 반영
  useEffect(() => {
    const ref = doc(db, 'systemSettings', 'global');
    const unsub = onSnapshot(
      ref,
      snap => {
        if (snap.exists()) {
          const d = snap.data();
          if (typeof d.activeYear === 'number') setActiveYear(d.activeYear);
          setLockedYears(Array.isArray(d.lockedYears)
            ? d.lockedYears.filter((y: unknown): y is number => typeof y === 'number')
            : []);
        }
        setLoading(false);
      },
      () => setLoading(false),
    );
    return () => unsub();
  }, []);

  const isYearLocked = (year: number) => lockedYears.includes(year);

  return (
    <ActiveYearContext.Provider value={{
      activeYear, calendarYear: CALENDAR_YEAR, loading,
      lockedYears, isYearLocked, activeYearLocked: lockedYears.includes(activeYear),
    }}>
      {children}
    </ActiveYearContext.Provider>
  );
}

export function useActiveYear(): ActiveYearContextValue {
  return useContext(ActiveYearContext);
}

'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { getSystemSettings } from '@/lib/firestore';

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

  useEffect(() => {
    getSystemSettings()
      .then(s => {
        if (s?.activeYear) setActiveYear(s.activeYear);
      })
      .finally(() => setLoading(false));
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

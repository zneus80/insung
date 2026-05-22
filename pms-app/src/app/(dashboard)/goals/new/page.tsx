'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// /goals/new 는 더 이상 별도 페이지를 사용하지 않고,
// 핵심목표관리(/goals)의 통합 모달(TaskGoalForm)로 통합됨.
// 기존 링크/북마크 호환을 위해 자동 리다이렉트한다.
export default function NewGoalRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/goals?new=1');
  }, [router]);
  return null;
}

'use client';

import { useState } from 'react';
import { getTier, getTierProgress, getPointsToNextTier } from '@/lib/mileage-tier';
import { cn } from '@/lib/utils';
import MileageTop10Modal from './MileageTop10Modal';

interface MileageCardProps {
  points: number;
  className?: string;
}

// 시상식 포디움 아이콘 — 2·1·3 블록(은·금·동) + 1위 위 별. Top 10 팝업 버튼용.
function PodiumIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M12 2.5l1.1 2.3 2.5.3-1.8 1.7.5 2.5-2.3-1.2-2.3 1.2.5-2.5L8.4 5.1l2.5-.3L12 2.5z" fill="#f59e0b" />
      <rect x="2.5" y="13" width="6" height="8.5" rx="1" fill="#cbd5e1" />
      <rect x="9" y="9.5" width="6" height="12" rx="1" fill="#fbbf24" />
      <rect x="15.5" y="15" width="6" height="6.5" rx="1" fill="#f0a675" />
      <text x="5.5" y="19" textAnchor="middle" fontSize="4.5" fontWeight="bold" fill="#475569">2</text>
      <text x="12" y="17" textAnchor="middle" fontSize="5" fontWeight="bold" fill="#92400e">1</text>
      <text x="18.5" y="20" textAnchor="middle" fontSize="4.5" fontWeight="bold" fill="#9a3412">3</text>
    </svg>
  );
}

// v0.75: 대시보드 마일리지 표시는 필수사항인 총 마일리지 점수만 표시.
//        제출 TDS / 지시 TDS 구분 표기는 제거 (마일리지 관리 페이지의 지급 내역으로 일원화)
export default function MileageCard({ points, className }: MileageCardProps) {
  const tier = getTier(points);
  const progress = getTierProgress(points);
  const remaining = getPointsToNextTier(points);
  const [showTop10, setShowTop10] = useState(false);

  return (
    <div className={cn(`rounded-xl border-2 p-4 space-y-3 ${tier.bg} ${tier.border}`, className)}>
      {/* 등급 + 점수 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{tier.icon}</span>
          <div>
            <p className={`text-xs font-semibold uppercase tracking-wide ${tier.color}`}>
              내 마일리지
            </p>
            <p className={`text-lg font-bold ${tier.color}`}>
              {tier.label}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* 시상식 포디움 버튼 — 마일리지 Top 10 팝업 */}
          <button
            type="button"
            onClick={() => setShowTop10(true)}
            title="마일리지 TOP 10 보기"
            className="shrink-0 rounded-lg bg-white/70 hover:bg-white p-1.5 ring-1 ring-black/5 transition-colors cursor-pointer"
          >
            <PodiumIcon className="h-7 w-7" />
          </button>
          <div className="text-right">
            <p className={`text-3xl font-bold ${tier.color}`}>
              {points.toLocaleString()}
            </p>
            <p className="text-xs text-gray-400">점</p>
          </div>
        </div>
      </div>

      {/* 진행 바 */}
      <div className="space-y-1">
        <div className="h-2 w-full rounded-full bg-white/60">
          <div
            className={`h-2 rounded-full transition-all ${tier.progressColor}`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-xs text-gray-500">
          {remaining !== null
            ? `다음 등급까지 ${remaining}점`
            : '최고 등급 달성! 🎉'}
        </p>
      </div>

      {showTop10 && <MileageTop10Modal onClose={() => setShowTop10(false)} />}
    </div>
  );
}

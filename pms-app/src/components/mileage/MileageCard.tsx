import { getTier, getTierProgress, getPointsToNextTier } from '@/lib/mileage-tier';
import { cn } from '@/lib/utils';

interface MileageCardProps {
  points: number;
  className?: string;
}

// v0.75: 대시보드 마일리지 표시는 필수사항인 총 마일리지 점수만 표시.
//        제출 TDS / 지시 TDS 구분 표기는 제거 (마일리지 관리 페이지의 지급 내역으로 일원화)
export default function MileageCard({ points, className }: MileageCardProps) {
  const tier = getTier(points);
  const progress = getTierProgress(points);
  const remaining = getPointsToNextTier(points);

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
        <div className="text-right">
          <p className={`text-3xl font-bold ${tier.color}`}>
            {points.toLocaleString()}
          </p>
          <p className="text-xs text-gray-400">점</p>
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
    </div>
  );
}

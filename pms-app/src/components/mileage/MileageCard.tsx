import { getTier, getTierProgress, getPointsToNextTier } from '@/lib/mileage-tier';
import { cn } from '@/lib/utils';

interface MileageCardProps {
  points: number;
  submitTds?: number;
  instructTds?: number;
  className?: string;
}

export default function MileageCard({ points, submitTds, instructTds, className }: MileageCardProps) {
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

      {/* TDS 구분 표기 */}
      {(submitTds !== undefined || instructTds !== undefined) && (
        <div className="flex gap-3">
          <div className="flex-1 rounded-lg bg-white/50 px-3 py-2 text-center">
            <p className="text-xs text-gray-500">제출 TDS</p>
            <p className={`text-base font-bold ${tier.color}`}>{(submitTds ?? 0).toLocaleString()}</p>
          </div>
          <div className="flex-1 rounded-lg bg-white/50 px-3 py-2 text-center">
            <p className="text-xs text-gray-500">지시 TDS</p>
            <p className={`text-base font-bold ${tier.color}`}>{(instructTds ?? 0).toLocaleString()}</p>
          </div>
        </div>
      )}

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

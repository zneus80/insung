'use client';

/**
 * 대시보드 우측 상단 — 제도 안내 (승진제도 + ISKMS 마일리지)
 * 아이콘 클릭 → 모달로 두 제도 설명 표시
 */

import { useState } from 'react';
import { Info, X, Award, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function PolicyGuideButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100 transition-colors"
        title="제도 안내"
      >
        <Info className="h-4 w-4" />
        제도 안내
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            {/* 헤더 */}
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Info className="h-5 w-5 text-blue-600" />
                <h2 className="text-lg font-bold text-gray-900">제도 안내</h2>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded-lg p-1.5 hover:bg-gray-100 text-gray-500"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-8">
              {/* ── 1. 승진제도 ──────────────────────────── */}
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <TrendingUp className="h-5 w-5 text-blue-600" />
                  <h3 className="text-base font-bold text-gray-900">승진제도</h3>
                </div>
                <p className="text-sm text-gray-500 mb-4">승진을 위한 필수 요건입니다.</p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {/* 임원 승진 */}
                  <div className="rounded-xl border border-blue-200 bg-blue-50/40 overflow-hidden">
                    <div className="bg-blue-600 px-4 py-2.5">
                      <p className="text-sm font-bold text-white">임원 승진</p>
                    </div>
                    <div className="p-4">
                      <ul className="space-y-2 text-sm text-gray-700">
                        <li className="flex items-start gap-2">
                          <span className="text-blue-600 font-bold mt-0.5">✓</span>
                          <span>스마트 프로젝트 <strong>1건 이상 PM 으로 수행</strong></span>
                        </li>
                      </ul>
                      <p className="mt-3 text-xs text-gray-400">* PM : 프로젝트 매니저</p>
                    </div>
                  </div>

                  {/* 팀장 승진 */}
                  <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 overflow-hidden">
                    <div className="bg-indigo-600 px-4 py-2.5">
                      <p className="text-sm font-bold text-white">팀장 승진</p>
                    </div>
                    <div className="p-4">
                      <ul className="space-y-2 text-sm text-gray-700">
                        <li className="flex items-start gap-2">
                          <span className="text-indigo-600 font-bold mt-0.5">①</span>
                          <span>스마트 프로젝트 <strong>1건 이상 참여</strong></span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-indigo-600 font-bold mt-0.5">②</span>
                          <span>ISKMS <strong>누적 마일리지 200점 이상</strong></span>
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>
              </section>

              {/* ── 2. ISKMS 마일리지 제도 ────────────────── */}
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <Award className="h-5 w-5 text-amber-500" />
                  <h3 className="text-base font-bold text-gray-900">ISKMS 마일리지 보상 제도</h3>
                </div>
                <p className="text-sm text-gray-500 mb-1">
                  <strong>2026년 6월 1일</strong>부터 변경된 신규 보상제도 (누적형 · 자동지급 · 차감 없음)
                </p>

                <div className="mt-4 rounded-xl border border-amber-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-amber-100/70">
                      <tr>
                        <th className="px-4 py-3 text-left font-semibold text-amber-900 w-1/3">누적 점수</th>
                        <th className="px-4 py-3 text-left font-semibold text-amber-900 w-1/3">포상금</th>
                        <th className="px-4 py-3 text-left font-semibold text-amber-900">비고</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-amber-100 bg-white">
                      <Row pts="200점"   prize="20만원" />
                      <Row pts="400점"   prize="40만원" />
                      <Row pts="600점"   prize="60만원" />
                      <Row pts="800점"   prize="80만원" />
                      <tr className="bg-amber-50/60">
                        <td className="px-4 py-3 font-bold text-amber-900">1,000점</td>
                        <td className="px-4 py-3 font-bold text-amber-900">여행 상품권 400만원</td>
                        <td className="px-4 py-3 text-xs text-amber-800 font-medium">수령 시 테이블 초기화</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                {/* "별도 부상 없음" 비고는 v0.75 에서 제거됨 */}

                <div className="mt-3 rounded-lg bg-blue-50 border border-blue-200 p-3 space-y-1">
                  <p className="text-xs text-blue-700">
                    <strong>※</strong> 1,000점 달성 후 여행 상품권 수령 시 보상 테이블이 초기화됩니다.
                    더 상위 보상은 없으며, 다시 200점부터 적립하여 보상을 받으실 수 있습니다.
                  </p>
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Row({ pts, prize }: { pts: string; prize: string }) {
  return (
    <tr>
      <td className="px-4 py-2.5 font-medium text-gray-900">{pts}</td>
      <td className="px-4 py-2.5 text-gray-900">{prize}</td>
      <td className="px-4 py-2.5 text-xs text-gray-300">—</td>
    </tr>
  );
}

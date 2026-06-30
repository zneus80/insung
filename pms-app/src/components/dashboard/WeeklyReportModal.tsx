'use client';

import { useCallback, useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FileText, Sparkles, Loader2, RefreshCw, ChevronDown } from 'lucide-react';
import MarkdownLite from '@/components/ui/MarkdownLite';
import { useAuth } from '@/contexts/AuthContext';
import { useActiveYear } from '@/contexts/ActiveYearContext';
import {
  getOrganizationsForYear, getAllUsers, getTeamWeeklyTasksByOrgsAndWeek,
  getWeeklyReportCache, saveWeeklyReportCache,
} from '@/lib/firestore';
import { getMyScopeOrgIds } from '@/lib/approval-filters';
import { summarizeWeeklyReport, type WeeklyReportInput } from '@/lib/ai-assistant';
import { toast } from 'sonner';
import type { Organization, WeeklyTask } from '@/types';

// ── ISO 주차 유틸 (tasks 와 동일 규칙) ──
function isoWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}
function prevWeek(year: number, week: number): { year: number; week: number } {
  if (week === 1) { const l = isoWeek(new Date(year - 1, 11, 28)); return { year: year - 1, week: l.week }; }
  return { year, week: week - 1 };
}

export default function WeeklyReportModal({ onClose }: { onClose: () => void }) {
  const { userProfile } = useAuth();
  const { activeYear } = useActiveYear();
  const [loading, setLoading] = useState(true);     // 초기 캐시 조회
  const [generating, setGenerating] = useState(false);
  const [content, setContent] = useState<string>('');
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);
  const [hasData, setHasData] = useState<boolean | null>(null); // 지난주 주간보고 존재 여부
  const [showSource, setShowSource] = useState(false);
  const [sourceTeams, setSourceTeams] = useState<WeeklyReportInput['teams']>([]);

  // 지난주(현재 ISO주 직전)
  const nowWeek = isoWeek(new Date());
  const target = prevWeek(nowWeek.year, nowWeek.week);

  // 산하 팀별 지난주 주간보고 데이터 수집 → AI 입력 형태로 가공
  const gather = useCallback(async (): Promise<{ input: WeeklyReportInput; teamDocs: WeeklyTask[] } | null> => {
    if (!userProfile) return null;
    const [orgs, users] = await Promise.all([getOrganizationsForYear(activeYear), getAllUsers()]);
    const orgById = new Map(orgs.map(o => [o.id, o]));
    const nameById = new Map(users.map(u => [u.id, u.name]));
    const posById = new Map(users.map(u => [u.id, u.position]));
    const scopeIds = getMyScopeOrgIds(userProfile.id, userProfile.role, userProfile.organizationId, orgs);
    const teamOrgIds = scopeIds.filter(id => orgById.get(id)?.type === 'TEAM');
    const teamDocs = await getTeamWeeklyTasksByOrgsAndWeek(teamOrgIds, target.year, target.week);
    const docByOrg = new Map(teamDocs.map(d => [d.organizationId, d]));

    const teams: WeeklyReportInput['teams'] = teamOrgIds
      .map(orgId => {
        const org = orgById.get(orgId);
        const doc = docByOrg.get(orgId);
        // 항목을 작성자(authorId)별로 묶어 멤버 단위 구성
        const byAuthor = new Map<string, { name: string; position?: string; hasDone: string[]; willDo: string[] }>();
        const push = (authorId: string | undefined, authorName: string | undefined, text: string, kind: 'hasDone' | 'willDo') => {
          const id = authorId || 'unknown';
          const name = authorName || nameById.get(id) || '미상';
          if (!byAuthor.has(id)) byAuthor.set(id, { name, position: posById.get(id), hasDone: [], willDo: [] });
          const t = text.trim(); if (t) byAuthor.get(id)![kind].push(t);
        };
        (doc?.hasDoneItems ?? []).forEach(i => push(i.authorId, i.authorName, i.title || i.content, 'hasDone'));
        (doc?.willDoItems ?? []).forEach(i => push(i.authorId, i.authorName, i.title || i.content, 'willDo'));
        return {
          teamName: org?.name ?? '(팀)',
          members: [...byAuthor.values()].filter(m => m.hasDone.length || m.willDo.length),
        };
      })
      .filter(t => t.members.length > 0);

    const myOrgName = orgById.get(userProfile.organizationId)?.name ?? '담당 조직';
    return { input: { divisionName: myOrgName, year: target.year, week: target.week, teams }, teamDocs };
  }, [userProfile, activeYear, target.year, target.week]);

  // 초기: 캐시 조회
  useEffect(() => {
    if (!userProfile) return;
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const cached = await getWeeklyReportCache(userProfile.id, target.year, target.week);
        if (!alive) return;
        if (cached?.content) {
          setContent(cached.content);
          setGeneratedAt(cached.generatedAt);
          setHasData(true);
        } else {
          // 캐시 없음 — 데이터 존재 여부만 미리 확인(생성 버튼 노출 판단)
          const g = await gather();
          if (!alive) return;
          setSourceTeams(g?.input.teams ?? []);
          setHasData((g?.input.teams.length ?? 0) > 0);
        }
      } finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userProfile?.id, target.year, target.week]);

  async function generate() {
    if (!userProfile || generating) return;
    setGenerating(true);
    try {
      const g = await gather();
      setSourceTeams(g?.input.teams ?? []);
      if (!g || g.input.teams.length === 0) {
        setHasData(false);
        toast.info('지난주 등록된 주간업무보고가 없습니다.');
        return;
      }
      const text = await summarizeWeeklyReport(g.input);
      if (!text) { toast.error('리포트 생성에 실패했습니다.'); return; }
      setContent(text);
      const now = new Date();
      setGeneratedAt(now);
      setHasData(true);
      await saveWeeklyReportCache(userProfile.id, target.year, target.week, text, userProfile.name).catch(() => {});
    } catch (e) {
      console.error('[위클리 리포트] 생성 실패:', e);
      toast.error('리포트 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-blue-600" />
            위클리 리포트
            <span className="text-sm font-normal text-gray-400">{target.year}년 {target.week}주차 (지난주)</span>
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="py-10 flex items-center justify-center text-gray-400 gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중…
          </div>
        ) : content ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-gray-400">
                {generatedAt ? `${generatedAt.toLocaleString('ko-KR')} 생성` : ''} · AI 요약(참고용)
              </p>
              <Button variant="outline" size="sm" onClick={generate} disabled={generating} className="gap-1.5 h-8">
                {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                {generating ? '재생성 중…' : '새로고침'}
              </Button>
            </div>
            <div className="rounded-xl border bg-white px-4 py-3 text-sm leading-relaxed">
              <MarkdownLite content={content} />
            </div>
            {sourceTeams.length > 0 && (
              <div className="rounded-lg border border-gray-100">
                <button onClick={() => setShowSource(s => !s)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-gray-500 hover:bg-gray-50">
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${!showSource && '-rotate-90'}`} />
                  원본 주간보고 데이터 ({sourceTeams.length}개 팀)
                </button>
                {showSource && (
                  <div className="px-3 py-2 border-t space-y-2">
                    {sourceTeams.map((t, i) => (
                      <div key={i}>
                        <p className="text-xs font-semibold text-gray-700">{t.teamName}</p>
                        {t.members.map((m, j) => (
                          <p key={j} className="text-[11px] text-gray-500 pl-2">
                            · {m.name}: 실적 {m.hasDone.length} / 계획 {m.willDo.length}
                          </p>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : hasData === false ? (
          <div className="py-10 text-center text-sm text-gray-400">
            지난주({target.year}년 {target.week}주차) 등록된 산하 팀 주간업무보고가 없습니다.
          </div>
        ) : (
          <div className="py-8 flex flex-col items-center gap-3">
            <p className="text-sm text-gray-500">지난주 산하 팀 주간업무보고를 AI가 요약·분석합니다.</p>
            <Button onClick={generate} disabled={generating} className="gap-1.5">
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {generating ? '생성 중…' : '리포트 생성'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

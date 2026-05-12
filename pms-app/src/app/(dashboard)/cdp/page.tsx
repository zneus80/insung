'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getCDP, saveCDP } from '@/lib/firestore';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Header from '@/components/layout/Header';
import { toast } from 'sonner';
import type { CDP } from '@/types';

const TABS = [
  { key: 'direction',       label: '직무 방향',      placeholder: '현재 직무 방향과 목표, 커리어 비전을 작성하세요.' },
  { key: 'educationPlan',   label: '교육 희망',       placeholder: '희망하는 교육 과정이나 역량 개발 계획을 작성하세요.' },
  { key: 'educationRecord', label: '교육 실적',       placeholder: '이수한 교육, 취득한 자격증, 수료 내역을 작성하세요.' },
  { key: 'selfEval',        label: '자기평가',        placeholder: '금년도 본인 업무 수행에 대한 자기평가를 작성하세요.' },
  { key: 'concern',         label: '애로사항',        placeholder: '업무 수행 중 어려움이나 건의사항을 자유롭게 작성하세요.' },
] as const;

type CDPKey = typeof TABS[number]['key'];

export default function CDPPage() {
  const { userProfile } = useAuth();
  const year = new Date().getFullYear();

  const [cdp, setCdp] = useState<Partial<CDP>>({});
  const [dirty, setDirty] = useState<Set<CDPKey>>(new Set());
  const [saving, setSaving] = useState<CDPKey | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userProfile) return;
    const data = await getCDP(userProfile.id, year);
    setCdp(data ?? {});
    setLoading(false);
  }, [userProfile, year]);

  useEffect(() => { load(); }, [load]);

  function handleChange(key: CDPKey, value: string) {
    setCdp(prev => ({ ...prev, [key]: value }));
    setDirty(prev => new Set(prev).add(key));
  }

  async function handleSave(key: CDPKey) {
    if (!userProfile) return;
    setSaving(key);
    try {
      await saveCDP(userProfile.id, userProfile.organizationId, year, {
        [key]: (cdp as any)[key] ?? '',
      });
      setDirty(prev => { const s = new Set(prev); s.delete(key); return s; });
      toast.success('저장되었습니다.');
    } catch {
      toast.error('저장 실패');
    } finally {
      setSaving(null);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col h-full">
        <Header title="CDP" />
        <div className="flex-1 p-6 space-y-3">
          {[1,2,3].map(i => <div key={i} className="h-16 animate-pulse rounded-xl bg-gray-100"/>)}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="CDP (Career Development Plan)" />
      <div className="flex-1 overflow-y-auto p-6">
        <Tabs defaultValue="direction">
          <TabsList className="mb-6 flex-wrap h-auto">
            {TABS.map(t => (
              <TabsTrigger key={t.key} value={t.key} className="relative">
                {t.label}
                {dirty.has(t.key) && (
                  <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-orange-400"/>
                )}
              </TabsTrigger>
            ))}
          </TabsList>

          {TABS.map(t => (
            <TabsContent key={t.key} value={t.key} className="space-y-3">
              <div className="rounded-xl border bg-white p-4 space-y-3">
                <p className="text-sm font-medium text-gray-700">{t.label}</p>
                <Textarea
                  rows={10}
                  placeholder={t.placeholder}
                  value={(cdp as any)[t.key] ?? ''}
                  onChange={e => handleChange(t.key, e.target.value)}
                  className="resize-none"
                />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    onClick={() => handleSave(t.key)}
                    disabled={saving === t.key || !dirty.has(t.key)}
                  >
                    {saving === t.key ? '저장 중...' : '저장'}
                  </Button>
                </div>
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </div>
  );
}

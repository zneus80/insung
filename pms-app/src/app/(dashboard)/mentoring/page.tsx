'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getMentoringForm, upsertMentoringForm } from '@/lib/firestore';
import Header from '@/components/layout/Header';
import AuthGuard from '@/components/layout/AuthGuard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import {
  Save, Send, CheckCircle2, User, Briefcase, GraduationCap,
  TrendingUp, MapPin, BookOpen, MessageSquare, ChevronRight,
} from 'lucide-react';
import type { MentoringForm, JobRequestType } from '@/types';

const IS_MOCK = process.env.NEXT_PUBLIC_MOCK_AUTH === 'true';

const EMPTY_FORM: Omit<MentoringForm, 'id' | 'userId' | 'organizationId' | 'cycleYear' | 'createdAt' | 'updatedAt' | 'status' | 'submittedAt'> = {
  interviewDate: '', interviewerName: '',
  lastSchoolMajor: '', familyInfo: '', commute: '', importantEvent: '',
  currentPosition: '', mainDuties: '', promotionDate: '', certifications: '', achievements: '',
  careerPlan: '',
  jobRequest: 'SATISFIED', jobRequestReason: '',
  desiredJob1: '', desiredJob2: '', jobChangeReason: '',
  desiredLocation1: '', desiredLocation2: '', locationChangeReason: '',
  languageType: '', languagePurpose: '', additionalEducation: '',
  selfOpinion: '', interviewerOpinion: '',
};

const JOB_REQUEST_OPTIONS: { value: JobRequestType; label: string }[] = [
  { value: 'EXPAND', label: '① 직무 확대' },
  { value: 'REDUCE', label: '② 직무 축소' },
  { value: 'CHANGE', label: '③ 직무 변경' },
  { value: 'RELOCATE', label: '④ 근무지 이동' },
  { value: 'SATISFIED', label: '● 만족함' },
];

export default function MentoringPage() {
  return (
    <AuthGuard allowedRoles={['MEMBER', 'TEAM_LEAD']}>
      <MentoringContent />
    </AuthGuard>
  );
}

function MentoringContent() {
  const { userProfile } = useAuth();
  const year = new Date().getFullYear();
  const [form, setForm] = useState(EMPTY_FORM);
  const [status, setStatus] = useState<MentoringForm['status']>('DRAFT');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const set = (field: string, value: string) =>
    setForm(prev => ({ ...prev, [field]: value }));

  const load = useCallback(async () => {
    if (!userProfile) return;
    setLoading(true);
    try {
      if (!IS_MOCK) {
        const record = await getMentoringForm(userProfile.id, year);
        if (record) {
          const { id, userId, organizationId, cycleYear, createdAt, updatedAt, status: s, submittedAt, ...rest } = record;
          setForm(rest);
          setStatus(s);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [userProfile, year]);

  useEffect(() => { load(); }, [load]);

  const isSubmitted = status === 'SUBMITTED';

  async function handleSave(submit: boolean) {
    if (!userProfile) return;
    setSaving(true);
    try {
      if (!IS_MOCK) {
        await upsertMentoringForm(userProfile.id, year, {
          userId: userProfile.id,
          organizationId: userProfile.organizationId,
          cycleYear: year,
          ...form,
          status: submit ? 'SUBMITTED' : 'DRAFT',
          ...(submit ? { submittedAt: new Date() } : {}),
        });
      }
      if (submit) setStatus('SUBMITTED');
      toast.success(submit ? '육성면담서가 제출되었습니다.' : '임시저장 되었습니다.');
    } catch {
      toast.error('저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col h-full">
        <Header title="육성면담서" />
        <div className="p-6 space-y-4">
          {[1,2,3,4].map(i => <div key={i} className="h-32 animate-pulse rounded-2xl bg-gray-100" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="육성면담서" />
      <div className="flex-1 overflow-y-auto bg-gray-50">
        <div className="max-w-3xl mx-auto px-6 py-6 space-y-5">

          {/* 상단 상태 배너 */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-gray-900">CDP 육성면담서</h2>
              <p className="text-sm text-gray-400 mt-0.5">{year}년도 · Career Development Program</p>
            </div>
            {isSubmitted ? (
              <span className="flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1.5 text-xs font-semibold text-green-700">
                <CheckCircle2 className="h-3.5 w-3.5" /> 제출 완료
              </span>
            ) : (
              <span className="rounded-full bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-700">
                작성 중
              </span>
            )}
          </div>

          {/* ── 섹션 1: 기본 정보 ── */}
          <SectionCard icon={<User className="h-4 w-4" />} title="기본 정보" color="blue">
            <div className="grid grid-cols-2 gap-4">
              <Field label="면담일">
                <Input type="date" value={form.interviewDate} disabled={isSubmitted}
                  onChange={e => set('interviewDate', e.target.value)} />
              </Field>
              <Field label="면담자">
                <Input placeholder="면담자 이름" value={form.interviewerName} disabled={isSubmitted}
                  onChange={e => set('interviewerName', e.target.value)} />
              </Field>
            </div>
          </SectionCard>

          {/* ── 섹션 2: CDP 자기신고서 - 개인 기본사항 ── */}
          <SectionCard icon={<GraduationCap className="h-4 w-4" />} title="I. CDP 자기신고서" subtitle="개인 기본사항" color="indigo">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="최종학교 / 전공">
                  <Input placeholder="예) 한국대학교 / 경영학과" value={form.lastSchoolMajor} disabled={isSubmitted}
                    onChange={e => set('lastSchoolMajor', e.target.value)} />
                </Field>
                <Field label="가족사항">
                  <Input placeholder="예) 배우자, 자녀 2명" value={form.familyInfo} disabled={isSubmitted}
                    onChange={e => set('familyInfo', e.target.value)} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="거주지 (출퇴근 시간)">
                  <Input placeholder="예) 서울 강남구 (편도 40분)" value={form.commute} disabled={isSubmitted}
                    onChange={e => set('commute', e.target.value)} />
                </Field>
                <Field label="현 직위 승진일">
                  <Input type="date" value={form.promotionDate} disabled={isSubmitted}
                    onChange={e => set('promotionDate', e.target.value)} />
                </Field>
              </div>
              <Field label="개인적으로 중요했던 Event">
                <Textarea placeholder="올해 개인적으로 중요했던 사건이나 경험을 기술하세요."
                  value={form.importantEvent} disabled={isSubmitted} rows={3}
                  className="resize-none" onChange={e => set('importantEvent', e.target.value)} />
              </Field>
            </div>
          </SectionCard>

          {/* ── 섹션 3: 직무 정보 ── */}
          <SectionCard icon={<Briefcase className="h-4 w-4" />} title="직무 정보" color="violet">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="직위 / 직책">
                  <Input placeholder="예) 대리 / 영업팀" value={form.currentPosition} disabled={isSubmitted}
                    onChange={e => set('currentPosition', e.target.value)} />
                </Field>
                <Field label="직무관련 보유자격증">
                  <Input placeholder="예) 정보처리기사, TOEIC 850" value={form.certifications} disabled={isSubmitted}
                    onChange={e => set('certifications', e.target.value)} />
                </Field>
              </div>
              <Field label="주요 담당업무">
                <Textarea placeholder="현재 담당하고 있는 주요 업무를 세부적으로 기재하세요."
                  value={form.mainDuties} disabled={isSubmitted} rows={3}
                  className="resize-none" onChange={e => set('mainDuties', e.target.value)} />
              </Field>
              <Field label="당해년도 주요 업적">
                <Textarea placeholder="올해의 주요 성과와 업적을 기술하세요."
                  value={form.achievements} disabled={isSubmitted} rows={4}
                  className="resize-none" onChange={e => set('achievements', e.target.value)} />
              </Field>
            </div>
          </SectionCard>

          {/* ── 섹션 4: 경력개발 계획 ── */}
          <SectionCard icon={<TrendingUp className="h-4 w-4" />} title="경력개발 계획" color="emerald">
            <Field label="희망 Position 및 경력개발 방향"
              hint="향후 3~5년 이내의 희망 Position 및 경력개발 방향에 대하여 기술하세요.">
              <Textarea placeholder="예) 3년 내 팀장 직책을 목표로, 영업 전문성을 강화하고 리더십 역량을 키우고자 합니다..."
                value={form.careerPlan} disabled={isSubmitted} rows={5}
                className="resize-none" onChange={e => set('careerPlan', e.target.value)} />
            </Field>
          </SectionCard>

          {/* ── 섹션 5: 현 직무 요청사항 ── */}
          <SectionCard icon={<MapPin className="h-4 w-4" />} title="현 직무에 관한 요청사항" color="orange">
            <div className="space-y-4">
              {/* 라디오 버튼 */}
              <div className="flex flex-wrap gap-2">
                {JOB_REQUEST_OPTIONS.map(opt => (
                  <button key={opt.value} disabled={isSubmitted}
                    onClick={() => set('jobRequest', opt.value)}
                    className={`rounded-full px-4 py-1.5 text-sm font-medium border transition-all ${
                      form.jobRequest === opt.value
                        ? 'bg-orange-500 text-white border-orange-500 shadow-sm'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-orange-300 hover:text-orange-600'
                    } ${isSubmitted ? 'opacity-70 cursor-default' : 'cursor-pointer'}`}>
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* ①② 직무 확대/축소 이유 */}
              {(form.jobRequest === 'EXPAND' || form.jobRequest === 'REDUCE') && (
                <Field label="선택 이유">
                  <Textarea placeholder="직무 확대 또는 축소를 희망하는 이유를 기술하세요."
                    value={form.jobRequestReason} disabled={isSubmitted} rows={3}
                    className="resize-none" onChange={e => set('jobRequestReason', e.target.value)} />
                </Field>
              )}

              {/* ③ 직무 변경 */}
              {form.jobRequest === 'CHANGE' && (
                <div className="space-y-3 rounded-xl bg-orange-50 border border-orange-100 p-4">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="희망 직무 1순위">
                      <Input placeholder="예) 마케팅기획" value={form.desiredJob1} disabled={isSubmitted}
                        onChange={e => set('desiredJob1', e.target.value)} />
                    </Field>
                    <Field label="희망 직무 2순위">
                      <Input placeholder="예) 인사관리" value={form.desiredJob2} disabled={isSubmitted}
                        onChange={e => set('desiredJob2', e.target.value)} />
                    </Field>
                  </div>
                  <Field label="변경 희망 이유">
                    <Textarea placeholder="직무 변경을 희망하는 이유를 기술하세요."
                      value={form.jobChangeReason} disabled={isSubmitted} rows={3}
                      className="resize-none" onChange={e => set('jobChangeReason', e.target.value)} />
                  </Field>
                </div>
              )}

              {/* ④ 근무지 이동 */}
              {form.jobRequest === 'RELOCATE' && (
                <div className="space-y-3 rounded-xl bg-orange-50 border border-orange-100 p-4">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="희망 근무지 1순위">
                      <Input placeholder="예) 서울 본사" value={form.desiredLocation1} disabled={isSubmitted}
                        onChange={e => set('desiredLocation1', e.target.value)} />
                    </Field>
                    <Field label="희망 근무지 2순위">
                      <Input placeholder="예) 부산 지점" value={form.desiredLocation2} disabled={isSubmitted}
                        onChange={e => set('desiredLocation2', e.target.value)} />
                    </Field>
                  </div>
                  <Field label="변경 희망 이유">
                    <Textarea placeholder="근무지 변경을 희망하는 이유를 기술하세요."
                      value={form.locationChangeReason} disabled={isSubmitted} rows={3}
                      className="resize-none" onChange={e => set('locationChangeReason', e.target.value)} />
                  </Field>
                </div>
              )}
            </div>
          </SectionCard>

          {/* ── 섹션 6: 교육지원 요청 ── */}
          <SectionCard icon={<BookOpen className="h-4 w-4" />} title="교육 지원 요청사항" color="teal">
            <div className="space-y-4">
              <div className="rounded-xl bg-teal-50 border border-teal-100 p-4 space-y-3">
                <p className="text-xs font-semibold text-teal-700">어학 교육</p>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="어학 종류">
                    <Input placeholder="예) 영어, 중국어" value={form.languageType} disabled={isSubmitted}
                      onChange={e => set('languageType', e.target.value)} />
                  </Field>
                  <Field label="교육 목적">
                    <Input placeholder="예) 해외영업 역량 강화" value={form.languagePurpose} disabled={isSubmitted}
                      onChange={e => set('languagePurpose', e.target.value)} />
                  </Field>
                </div>
              </div>
              <Field label="기타 희망 교육"
                hint="자격증 취득을 위한 교육, 꼭 필요한 전문교육 등을 기술하세요.">
                <Textarea placeholder="예) PMP 자격증 취득 과정, 리더십 코칭 프로그램 등"
                  value={form.additionalEducation} disabled={isSubmitted} rows={3}
                  className="resize-none" onChange={e => set('additionalEducation', e.target.value)} />
              </Field>
            </div>
          </SectionCard>

          {/* ── 섹션 7: II. 종합의견 ── */}
          <SectionCard icon={<MessageSquare className="h-4 w-4" />} title="II. 종합의견" color="gray">
            <div className="space-y-4">
              <Field label="작성자 종합의견"
                hint="CDP, 5S와 6E 작성 내용들을 종합한 1년간의 자기평가와 함께 회사에 대한 요청사항 등을 자유롭게 기술하세요.">
                <Textarea placeholder="본인의 1년간 성과와 성장에 대한 자기평가, 회사에 대한 요청사항 등을 자유롭게 작성하세요."
                  value={form.selfOpinion} disabled={isSubmitted} rows={6}
                  className="resize-none" onChange={e => set('selfOpinion', e.target.value)} />
              </Field>
              <div className="border-t border-dashed border-gray-200 pt-4">
                <Field label="면담자 종합의견"
                  hint="직원의 담당 직무에 대한 적정성, 업적에 대한 평가, 경력개발 계획 등을 고려하여 종합의견을 기술하세요."
                  labelExtra={<span className="text-xs text-gray-400">(면담자 작성)</span>}>
                  <Textarea placeholder="면담자의 종합 의견을 작성하세요."
                    value={form.interviewerOpinion} rows={6}
                    className="resize-none bg-gray-50" onChange={e => set('interviewerOpinion', e.target.value)} />
                </Field>
              </div>
            </div>
          </SectionCard>

          {/* ── 버튼 영역 ── */}
          {!isSubmitted ? (
            <div className="flex gap-3 pb-6">
              <Button variant="outline" onClick={() => handleSave(false)} disabled={saving} className="flex-1 gap-2 h-11">
                <Save className="h-4 w-4" />
                {saving ? '저장 중...' : '임시저장'}
              </Button>
              <Button onClick={() => handleSave(true)} disabled={saving} className="flex-1 gap-2 h-11 bg-blue-600 hover:bg-blue-700">
                <Send className="h-4 w-4" />
                {saving ? '제출 중...' : '제출하기'}
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-2xl border border-green-200 bg-green-50 px-5 py-4 text-sm text-green-700 mb-6">
              <CheckCircle2 className="h-5 w-5 shrink-0" />
              <div>
                <p className="font-semibold">육성면담서가 제출되었습니다.</p>
                <p className="text-xs text-green-600 mt-0.5">수정이 필요한 경우 담당 HR 관리자에게 문의하세요.</p>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

// ── 공통 컴포넌트 ──────────────────────────────

type SectionColor = 'blue' | 'indigo' | 'violet' | 'emerald' | 'orange' | 'teal' | 'gray';

const colorMap: Record<SectionColor, { icon: string; border: string; title: string }> = {
  blue:    { icon: 'bg-blue-100 text-blue-600',    border: 'border-blue-100',   title: 'text-blue-700' },
  indigo:  { icon: 'bg-indigo-100 text-indigo-600', border: 'border-indigo-100', title: 'text-indigo-700' },
  violet:  { icon: 'bg-violet-100 text-violet-600', border: 'border-violet-100', title: 'text-violet-700' },
  emerald: { icon: 'bg-emerald-100 text-emerald-600', border: 'border-emerald-100', title: 'text-emerald-700' },
  orange:  { icon: 'bg-orange-100 text-orange-600', border: 'border-orange-100', title: 'text-orange-700' },
  teal:    { icon: 'bg-teal-100 text-teal-600',    border: 'border-teal-100',   title: 'text-teal-700' },
  gray:    { icon: 'bg-gray-100 text-gray-600',    border: 'border-gray-200',   title: 'text-gray-700' },
};

function SectionCard({ icon, title, subtitle, color, children }: {
  icon: React.ReactNode; title: string; subtitle?: string;
  color: SectionColor; children: React.ReactNode;
}) {
  const c = colorMap[color];
  return (
    <div className={`rounded-2xl border ${c.border} bg-white shadow-sm overflow-hidden`}>
      <div className="px-5 py-4 border-b border-gray-50 flex items-center gap-3">
        <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${c.icon}`}>
          {icon}
        </div>
        <div>
          <h3 className={`text-sm font-bold ${c.title}`}>{title}</h3>
          {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

function Field({ label, hint, labelExtra, children }: {
  label: string; hint?: string; labelExtra?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Label className="text-xs font-semibold text-gray-700">{label}</Label>
        {labelExtra}
      </div>
      {hint && <p className="text-xs text-gray-400 leading-relaxed">{hint}</p>}
      {children}
    </div>
  );
}

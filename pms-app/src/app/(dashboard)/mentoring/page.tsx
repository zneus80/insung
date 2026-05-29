'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useActiveYear } from '@/contexts/ActiveYearContext';
import {
  getMentoringForm, upsertMentoringForm,
  requestMentoringFormEdit, withdrawMentoringFormEditRequest,
  getHrAdmins, createNotification, getOrganizations, getAllUsers,
} from '@/lib/firestore';
import { notifyEvalReviewer } from '@/lib/eval-notifications';
import Header from '@/components/layout/Header';
import AuthGuard from '@/components/layout/AuthGuard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import {
  Save, Send, CheckCircle2, Briefcase, Pencil, XCircle,
  TrendingUp, MapPin, MessageSquare, RefreshCw, Plus, X, AlertCircle,
} from 'lucide-react';
import type { MentoringForm, JobRequestType } from '@/types';

const IS_MOCK = process.env.NEXT_PUBLIC_MOCK_AUTH === 'true';

const EMPTY_FORM: Omit<MentoringForm, 'id' | 'userId' | 'organizationId' | 'cycleYear' | 'createdAt' | 'updatedAt' | 'status' | 'submittedAt'> = {
  interviewDate: '', interviewerName: '',
  currentPosition: '', mainDuties: '', promotionDate: '', certifications: '', achievements: '',
  careerPlan: '',
  jobRequest: 'SATISFIED', jobRequestReason: '',
  desiredJob1: '', desiredJob2: '', jobChangeReason: '',
  desiredLocation1: '', desiredLocation2: '', locationChangeReason: '',
  selfOpinion: '', interviewerOpinion: '',
};

// 연도가 바뀌어도 이어받을 필드 목록
const CARRY_OVER_FIELDS = ['currentPosition', 'promotionDate', 'certifications'] as const;

const MOCK_PREV_FORM = {
  currentPosition: '대리 / 영업1팀',
  promotionDate: '2023-03-01',
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
    <AuthGuard allowedRoles={['MEMBER', 'TEAM_LEAD', 'EXECUTIVE']}>
      <MentoringContent />
    </AuthGuard>
  );
}

function MentoringContent() {
  const { userProfile } = useAuth();
  const { activeYear } = useActiveYear();
  const YEAR_OPTIONS = [activeYear, activeYear - 1, activeYear - 2];
  const [selectedYear, setSelectedYear] = useState(activeYear);
  const year = selectedYear;
  const isPastYear = selectedYear < activeYear;

  const [form, setForm] = useState(EMPTY_FORM);
  const [status, setStatus] = useState<MentoringForm['status']>('DRAFT');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [carriedOver, setCarriedOver] = useState(false); // 이전 데이터 불러왔는지 여부
  // 자격증 개별 입력 목록
  const [certList, setCertList] = useState<string[]>(['']);
  // 수정 요청 (A4) 관련 state
  const [editRequestPending, setEditRequestPending] = useState(false);
  const [editRequestReason, setEditRequestReason] = useState('');
  const [showEditRequestInput, setShowEditRequestInput] = useState(false);
  const [editRequestInputValue, setEditRequestInputValue] = useState('');

  const set = (field: string, value: string) =>
    setForm(prev => ({ ...prev, [field]: value }));

  // certList → form.certifications 동기화
  function updateCerts(list: string[]) {
    setCertList(list);
    setForm(prev => ({ ...prev, certifications: list.filter(Boolean).join('\n') }));
  }

  const load = useCallback(async () => {
    if (!userProfile) return;
    setLoading(true);
    setForm(EMPTY_FORM);
    setStatus('DRAFT');
    setCertList(['']);
    setCarriedOver(false);
    try {
      if (IS_MOCK) {
        // 목업: 이전 폼 데이터 자동 세팅
        setForm(prev => ({ ...prev, ...MOCK_PREV_FORM }));
        setCarriedOver(true);
      } else {
        // 현재 연도 폼 먼저 조회
        const record = await getMentoringForm(userProfile.id, year);
        if (record) {
          const {
            id, userId, organizationId, cycleYear, createdAt, updatedAt, status: s, submittedAt,
            editRequestPending: erp, editRequestReason: err, editRequestedAt, editRequestApprovedBy, editRequestApprovedAt,
            ...rest
          } = record;
          setForm(rest);
          setStatus(s);
          setEditRequestPending(!!erp);
          setEditRequestReason(err ?? '');
          setCertList(record.certifications ? record.certifications.split('\n').filter(Boolean) : ['']);
        } else {
          // 현재 연도 폼 없으면 작년 폼에서 고정 필드(직책·자격증·승진일) 자동 불러오기
          const prevRecord = await getMentoringForm(userProfile.id, year - 1);
          if (prevRecord) {
            const patch: Partial<typeof EMPTY_FORM> = {};
            CARRY_OVER_FIELDS.forEach(f => {
              if (prevRecord[f]) patch[f] = prevRecord[f];
            });
            if (Object.keys(patch).length > 0) {
              setForm(prev => ({ ...prev, ...patch }));
              // 자격증 리스트도 전년도 데이터로 초기화 (개별 입력 칸에 반영)
              if (prevRecord.certifications) {
                const certs = prevRecord.certifications.split('\n').filter(Boolean);
                if (certs.length > 0) setCertList(certs);
              }
              setCarriedOver(true);
            }
          }
        }
      }
    } finally {
      setLoading(false);
    }
  }, [userProfile, year]);

  useEffect(() => { load(); }, [load]);

  const isSubmitted = status === 'SUBMITTED' || isPastYear;

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
      if (submit) {
        setStatus('SUBMITTED');
        // 상위 검토자(팀장/본부장/임원) 에게 알림 — 자기평가와 동일 라인
        try {
          const [allOrgs, allUsers] = await Promise.all([getOrganizations(), getAllUsers()]);
          const stage = userProfile.role === 'MEMBER' ? 'LEAD'
                      : userProfile.role === 'TEAM_LEAD' ? 'HQ'
                      : 'EXEC';
          const subject = allUsers.find(u => u.id === userProfile.id) ?? userProfile;
          const res = await notifyEvalReviewer({
            subject,
            fromUserId: userProfile.id,
            fromUserName: userProfile.name,
            stage,
            type: 'MENTORING_SUBMITTED',
            category: 'MENTORING',
            title: `${userProfile.name}님 육성면담서 제출`,
            message: `${userProfile.name}님이 ${year}년 육성면담서를 제출했습니다.`,
            link: `/mentoring/all?user=${userProfile.id}&year=${year}`,
            allOrgs,
            allUsers,
          });
          if (!res.notified && stage === 'HQ') {
            await notifyEvalReviewer({
              subject, fromUserId: userProfile.id, fromUserName: userProfile.name,
              stage: 'EXEC',
              type: 'MENTORING_SUBMITTED',
              category: 'MENTORING',
              title: `${userProfile.name}님 육성면담서 제출`,
              message: `${userProfile.name}님이 ${year}년 육성면담서를 제출했습니다.`,
              link: `/mentoring/all?user=${userProfile.id}&year=${year}`,
              allOrgs, allUsers,
            });
          }
        } catch (err) {
          console.error('[육성면담서 알림] 실패:', err);
        }
      }
      toast.success(submit ? '육성면담서가 제출되었습니다.' : '임시저장 되었습니다.');
    } catch {
      toast.error('저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  }

  // ── 수정 요청 (A4) ──────────────────────────────────
  async function submitEditRequest() {
    if (!userProfile) return;
    if (!editRequestInputValue.trim()) {
      toast.error('수정 요청 사유를 입력해주세요.');
      return;
    }
    setSaving(true);
    try {
      await requestMentoringFormEdit(userProfile.id, year, editRequestInputValue.trim());
      // HR 관리자들에게 알림 발송
      try {
        const hrAdmins = await getHrAdmins();
        await Promise.all(hrAdmins.map(hr => createNotification({
          userId: hr.id,
          type: 'MENTORING_EDIT_REQUESTED',
          category: 'MENTORING',
          title: `${userProfile.name}님 육성면담서 수정 요청`,
          message: `사유: ${editRequestInputValue.trim().slice(0, 80)}${editRequestInputValue.trim().length > 80 ? '…' : ''}`,
          link: `/mentoring/all?user=${userProfile.id}&year=${year}`,
          read: false,
        })));
      } catch (err) {
        console.error('[알림] HR 알림 발송 실패:', err);
      }
      setEditRequestPending(true);
      setEditRequestReason(editRequestInputValue.trim());
      setEditRequestInputValue('');
      setShowEditRequestInput(false);
      toast.success('HR 관리자에게 수정 요청을 보냈습니다.');
    } catch {
      toast.error('수정 요청 발송에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  }

  async function withdrawEditRequest() {
    if (!userProfile) return;
    if (!confirm('수정 요청을 회수하시겠습니까?')) return;
    setSaving(true);
    try {
      await withdrawMentoringFormEditRequest(userProfile.id, year);
      setEditRequestPending(false);
      setEditRequestReason('');
      toast.success('수정 요청을 회수했습니다.');
    } catch {
      toast.error('회수에 실패했습니다.');
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

      {/* 연도 선택 탭 */}
      <div className="flex gap-1 border-b bg-white px-6 pt-3 shrink-0">
        {YEAR_OPTIONS.map(y => (
          <button
            key={y}
            onClick={() => setSelectedYear(y)}
            className={`px-4 py-2 text-sm font-medium rounded-t border-b-2 -mb-px transition-colors ${
              selectedYear === y
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {y}년
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto bg-gray-50">
        <div className="max-w-3xl mx-auto px-6 py-6 space-y-5">

          {/* 이전 연도 이력 배너 */}
          {isPastYear && (
            <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
              <span>📅</span>
              <span>{selectedYear}년 이력 보기 중 — 수정·제출은 당해연도에만 가능합니다.</span>
            </div>
          )}

          {/* 상단 상태 배너 */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-lg font-bold text-gray-900">Career Development Program</h2>
              <p className="text-sm text-gray-400 mt-0.5">{year}년도</p>
            </div>
            <div className="flex items-center gap-2">
              {isSubmitted ? (
                <span className="flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1.5 text-xs font-semibold text-green-700">
                  <CheckCircle2 className="h-3.5 w-3.5" /> 제출 완료
                </span>
              ) : (
                <span className="rounded-full bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-700">
                  작성 중
                </span>
              )}
              {/* A4: 제출 후 수정 요청 버튼 (당해연도만, 수정 요청 진행 중 아닌 경우만) */}
              {status === 'SUBMITTED' && !isPastYear && !editRequestPending && !showEditRequestInput && (
                <Button
                  size="sm" variant="outline" onClick={() => setShowEditRequestInput(true)}
                  className="gap-1.5 text-blue-600 border-blue-300 hover:bg-blue-50"
                >
                  <Pencil className="h-3.5 w-3.5" /> HR 수정 요청
                </Button>
              )}
              {editRequestPending && !isPastYear && (
                <Button
                  size="sm" variant="outline" onClick={withdrawEditRequest} disabled={saving}
                  className="gap-1.5 text-orange-600 border-orange-300 hover:bg-orange-50"
                >
                  <XCircle className="h-3.5 w-3.5" /> 수정 요청 회수
                </Button>
              )}
            </div>
          </div>

          {/* A4: 수정 요청 입력 박스 */}
          {showEditRequestInput && !editRequestPending && (
            <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-blue-700">
                <Pencil className="h-4 w-4" /> HR 수정 요청
              </div>
              <p className="text-xs text-gray-600">
                제출된 육성면담서를 수정하려면 HR 관리자에게 사유와 함께 요청하세요. HR 승인 후 다시 작성 가능 상태로 전환됩니다.
              </p>
              <Textarea
                rows={3}
                value={editRequestInputValue}
                onChange={e => setEditRequestInputValue(e.target.value)}
                placeholder="수정이 필요한 사유를 구체적으로 입력하세요"
              />
              <div className="flex gap-2 justify-end">
                <Button size="sm" variant="ghost" onClick={() => { setShowEditRequestInput(false); setEditRequestInputValue(''); }} disabled={saving}>
                  취소
                </Button>
                <Button size="sm" onClick={submitEditRequest} disabled={saving || !editRequestInputValue.trim()}>
                  {saving ? '요청 중...' : 'HR에 요청 보내기'}
                </Button>
              </div>
            </div>
          )}

          {/* A4: 수정 요청 진행 중 배너 */}
          {editRequestPending && (
            <div className="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm">
              <AlertCircle className="h-4 w-4 shrink-0 text-blue-600 mt-0.5" />
              <div className="flex-1 text-blue-800">
                <p className="font-medium">HR 수정 승인 대기 중</p>
                {editRequestReason && (
                  <p className="text-xs text-blue-700/80 mt-0.5 whitespace-pre-wrap">사유: {editRequestReason}</p>
                )}
                <p className="text-xs text-blue-700/70 mt-1">HR 관리자가 승인하면 다시 작성 가능 상태로 전환됩니다.</p>
              </div>
            </div>
          )}

          {/* 이전 데이터 불러오기 안내 */}
          {carriedOver && !isSubmitted && (
            <div className="flex items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-4 py-2.5 text-xs text-blue-700">
              <RefreshCw className="h-3.5 w-3.5 shrink-0" />
              현 직위, 승진일을 이전 저장 데이터로 자동 불러왔습니다. 내용을 확인하고 수정하세요.
            </div>
          )}

          {/* ── 섹션 1: 직무 정보 ── */}
          <SectionCard icon={<Briefcase className="h-4 w-4" />} title="직무 정보" color="violet">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="직책">
                  <Input value={form.currentPosition} disabled={isSubmitted}
                    onChange={e => set('currentPosition', e.target.value)} />
                </Field>
                <Field label="직무관련 보유자격증">
                  <div className="space-y-2">
                    {certList.map((cert, idx) => (
                      <div key={idx} className="flex gap-2 items-center">
                        <Input
                          placeholder={`자격증 ${idx + 1}`}
                          value={cert}
                          disabled={isSubmitted}
                          onChange={e => {
                            const next = [...certList];
                            next[idx] = e.target.value;
                            updateCerts(next);
                          }}
                        />
                        {!isSubmitted && certList.length > 1 && (
                          <button
                            type="button"
                            onClick={() => updateCerts(certList.filter((_, i) => i !== idx))}
                            className="p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    ))}
                    {!isSubmitted && (
                      <button
                        type="button"
                        onClick={() => updateCerts([...certList, ''])}
                        className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium mt-1"
                      >
                        <Plus className="h-3.5 w-3.5" /> 자격증 추가
                      </button>
                    )}
                  </div>
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

          {/* ── 경력개발 계획 ── */}
          <SectionCard icon={<TrendingUp className="h-4 w-4" />} title="경력개발 계획" color="emerald">
            <Field label="희망 Position 및 경력개발 방향"
              hint="향후 3~5년 이내의 희망 Position 및 경력개발 방향에 대하여 기술하세요.">
              <Textarea placeholder="예) 3년 내 팀장 직책을 목표로, 영업 전문성을 강화하고 리더십 역량을 키우고자 합니다..."
                value={form.careerPlan} disabled={isSubmitted} rows={5}
                className="resize-none" onChange={e => set('careerPlan', e.target.value)} />
            </Field>
          </SectionCard>

          {/* ── 현 직무 요청사항 ── */}
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

          {/* ── 종합의견 ── */}
          <SectionCard icon={<MessageSquare className="h-4 w-4" />} title="종합의견" color="gray">
            <Field label="작성자 종합의견"
              hint="CDP, 5S와 6E 작성 내용들을 종합한 1년간의 자기평가와 함께 회사에 대한 요청사항 등을 자유롭게 기술하세요.">
              <Textarea placeholder="본인의 1년간 성과와 성장에 대한 자기평가, 회사에 대한 요청사항 등을 자유롭게 작성하세요."
                value={form.selfOpinion} disabled={isSubmitted} rows={6}
                className="resize-none" onChange={e => set('selfOpinion', e.target.value)} />
            </Field>
          </SectionCard>

          {/* ── 버튼 영역 ── */}
          {!isSubmitted ? (
            <div className="space-y-3 pb-6">
              <div className="flex items-start gap-2 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs text-amber-700">
                <span className="mt-0.5 shrink-0">⚠️</span>
                <p>제출 후에는 내용 수정이 어렵습니다. 제출 전 모든 항목을 꼼꼼히 확인해 주세요. 수정이 필요한 경우 담당 HR 관리자에게 문의하세요.</p>
              </div>
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => handleSave(false)} disabled={saving} className="flex-1 gap-2 h-11">
                  <Save className="h-4 w-4" />
                  {saving ? '저장 중...' : '임시저장'}
                </Button>
                <Button onClick={() => handleSave(true)} disabled={saving} className="flex-1 gap-2 h-11 bg-blue-600 hover:bg-blue-700">
                  <Send className="h-4 w-4" />
                  {saving ? '제출 중...' : '제출하기'}
                </Button>
              </div>
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

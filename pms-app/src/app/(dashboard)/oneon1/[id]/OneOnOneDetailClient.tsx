'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { Send, MessageSquare, Trash2 } from 'lucide-react';
import MemberInfoModal from '@/components/members/MemberInfoModal';
import { useAuth } from '@/contexts/AuthContext';
import {
  getOneOnOne,
  getUser,
  addOneOnOneQuestion,
  answerOneOnOneQuestion,
  getOneOnOneQuestions,
  deleteOneOnOneQuestion,
  createNotification,
} from '@/lib/firestore';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import type { OneOnOne, OneOnOneQuestion, User } from '@/types';

export default function OneOnOneDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { userProfile } = useAuth();
  const router = useRouter();

  const [room, setRoom] = useState<OneOnOne | null>(null);
  const [leader, setLeader] = useState<User | null>(null);
  const [member, setMember] = useState<User | null>(null);
  const [questions, setQuestions] = useState<OneOnOneQuestion[]>([]);
  const [loading, setLoading] = useState(true);

  const [newQuestion, setNewQuestion] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [answerDraft, setAnswerDraft] = useState<Record<string, string>>({});
  const [answeringId, setAnsweringId] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);

  async function load() {
    try {
      const r = await getOneOnOne(id);
      if (!r) { router.push('/oneon1'); return; }
      const [l, mb, qs] = await Promise.all([
        getUser(r.leaderId),
        getUser(r.memberId),
        getOneOnOneQuestions(id),
      ]);
      setRoom(r);
      setLeader(l);
      setMember(mb);
      setQuestions(qs);
    } catch (e: any) {
      toast.error('1on1 정보를 불러오지 못했습니다.');
      router.push('/oneon1');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!id) return;
    load();
  }, [id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [questions]);

  async function handleAsk() {
    if (!userProfile || !newQuestion.trim() || !room) return;
    setSubmitting(true);
    try {
      await addOneOnOneQuestion(id, { askerId: userProfile.id, question: newQuestion.trim() });
      // 상대방에게 알림
      const targetId = userProfile.id === room.leaderId ? room.memberId : room.leaderId;
      try {
        await createNotification({
          userId: targetId,
          type: 'ONEONONE_MESSAGE',
          category: 'ONEONONE',
          title: `${userProfile.name}님이 1on1에 새 질문을 남겼습니다`,
          message: newQuestion.trim().slice(0, 100),
          link: `/oneon1/${id}`,
          read: false,
        });
      } catch { /* 알림 실패 무시 */ }
      setNewQuestion('');
      toast.success('질문이 등록되었습니다.');
      await load();
    } catch {
      toast.error('질문 등록에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAnswer(questionId: string) {
    if (!userProfile || !answerDraft[questionId]?.trim() || !room) return;
    const answerText = answerDraft[questionId].trim();
    setAnsweringId(questionId);
    try {
      await answerOneOnOneQuestion(id, questionId, {
        answer: answerText,
        answeredBy: userProfile.id,
      });
      // 질문 작성자(상대방)에게 알림
      const q = questions.find(qq => qq.id === questionId);
      const targetId = q?.askerId && q.askerId !== userProfile.id ? q.askerId : null;
      if (targetId) {
        try {
          await createNotification({
            userId: targetId,
            type: 'ONEONONE_MESSAGE',
            category: 'ONEONONE',
            title: `${userProfile.name}님이 1on1에 답변을 남겼습니다`,
            message: answerText.slice(0, 100),
            link: `/oneon1/${id}`,
            read: false,
          });
        } catch { /* 알림 실패 무시 */ }
      }
      setAnswerDraft(d => ({ ...d, [questionId]: '' }));
      toast.success('답변이 등록되었습니다.');
      await load();
    } catch {
      toast.error('답변 등록에 실패했습니다.');
    } finally {
      setAnsweringId(null);
    }
  }

  async function handleDelete(questionId: string) {
    if (!userProfile) return;
    if (!confirm('이 대화를 삭제하시겠습니까? 본인에게만 삭제되며 상대방은 영향을 받지 않습니다.')) return;
    try {
      await deleteOneOnOneQuestion(id, questionId, userProfile.id);
      toast.success('삭제되었습니다.');
      await load();
    } catch {
      toast.error('삭제에 실패했습니다.');
    }
  }

  if (loading || !room || !userProfile) {
    return (
      <div className="flex flex-col h-full">
        <Header title="1on1" showBack />
        <div className="flex flex-1 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </div>
    );
  }

  const isLeader = userProfile.id === room.leaderId;
  const canAnswer = (q: OneOnOneQuestion) => !q.answer && q.askerId !== userProfile.id;
  const visibleQuestions = questions.filter(q => !q.hiddenFor?.includes(userProfile.id));

  return (
    <div className="flex flex-col h-full">
      <Header title="1on1 Q&A" showBack />
      <div className="flex-1 overflow-y-auto">

        <div className="border-b bg-white px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-600 font-semibold">
              {(isLeader ? member?.name : leader?.name)?.[0] ?? '?'}
            </div>
            <div>
              <p className="font-semibold text-gray-900">
                {(isLeader ? member : leader) && (
                  <MemberInfoModal
                    userId={(isLeader ? member : leader)!.id}
                    userName={(isLeader ? member : leader)!.name}
                  />
                )}
                <span className="ml-2 text-xs font-normal text-gray-400">
                  {(() => {
                    const cp = isLeader ? member : leader;
                    if (cp?.position) return cp.position;
                    if (cp?.role === 'CEO') return '최고관리자';
                    if (cp?.role === 'EXECUTIVE') return '임원';
                    if (cp?.role === 'TEAM_LEAD') return '팀장';
                    return '팀원';
                  })()}
                </span>
              </p>
              {room.title && <p className="text-sm text-gray-500">{room.title}</p>}
            </div>
          </div>
        </div>

        <div className="p-6 space-y-4 max-w-2xl mx-auto w-full">
          {visibleQuestions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <MessageSquare className="h-10 w-10 mb-3 text-gray-200" />
              <p className="text-sm">아직 질문이 없습니다. 첫 질문을 남겨보세요.</p>
            </div>
          ) : (
            visibleQuestions.map(q => {
              const asker = q.askerId === room.leaderId ? leader : member;
              const answerer = q.answeredBy
                ? (q.answeredBy === room.leaderId ? leader : member)
                : null;
              return (
                <div key={q.id} className="rounded-xl border bg-white overflow-hidden">
                  <div className="p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 text-blue-600 text-xs font-semibold shrink-0">
                        {asker?.name?.[0] ?? '?'}
                      </div>
                      {asker && <MemberInfoModal userId={asker.id} userName={asker.name} />}
                      <span className="text-xs text-gray-400">
                        {format(q.createdAt, 'MM.dd HH:mm', { locale: ko })}
                      </span>
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600">
                        Q
                      </span>
                      <button
                        onClick={() => handleDelete(q.id)}
                        className="ml-auto p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                        title="대화 삭제 (나에게만)"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <p className="text-sm text-gray-800 whitespace-pre-wrap pl-9">{q.question}</p>
                  </div>

                  {q.answer ? (
                    <div className="border-t bg-gray-50 p-4 space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-green-100 text-green-600 text-xs font-semibold shrink-0">
                          {answerer?.name?.[0] ?? '?'}
                        </div>
                        {answerer && <MemberInfoModal userId={answerer.id} userName={answerer.name} />}
                        {q.answeredAt && (
                          <span className="text-xs text-gray-400">
                            {format(q.answeredAt, 'MM.dd HH:mm', { locale: ko })}
                          </span>
                        )}
                        <span className="ml-auto rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-600">
                          A
                        </span>
                      </div>
                      <p className="text-sm text-gray-700 whitespace-pre-wrap pl-9">{q.answer}</p>
                    </div>
                  ) : canAnswer(q) ? (
                    <div className="border-t bg-gray-50 p-4 space-y-2">
                      <p className="text-xs text-gray-400 font-medium">답변 작성</p>
                      <Textarea
                        rows={2}
                        placeholder="답변을 입력하세요..."
                        value={answerDraft[q.id] ?? ''}
                        onChange={e => setAnswerDraft(d => ({ ...d, [q.id]: e.target.value }))}
                        className="text-sm"
                      />
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          disabled={answeringId === q.id || !answerDraft[q.id]?.trim()}
                          onClick={() => handleAnswer(q.id)}
                          className="gap-1.5"
                        >
                          <Send className="h-3.5 w-3.5" />
                          {answeringId === q.id ? '등록 중...' : '답변 등록'}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="border-t bg-gray-50 px-4 py-3">
                      <p className="text-xs text-gray-400">아직 답변이 없습니다.</p>
                    </div>
                  )}
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t bg-white p-4">
        <div className="max-w-2xl mx-auto flex gap-2 items-end">
          <Textarea
            rows={2}
            placeholder="질문을 입력하세요..."
            value={newQuestion}
            onChange={e => setNewQuestion(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAsk();
            }}
            className="text-sm resize-none"
          />
          <Button
            onClick={handleAsk}
            disabled={submitting || !newQuestion.trim()}
            className="gap-1.5 shrink-0"
          >
            <Send className="h-4 w-4" />
            {submitting ? '등록 중...' : '질문'}
          </Button>
        </div>
        <p className="text-center text-xs text-gray-400 mt-2">Ctrl+Enter로 빠르게 등록</p>
      </div>
    </div>
  );
}

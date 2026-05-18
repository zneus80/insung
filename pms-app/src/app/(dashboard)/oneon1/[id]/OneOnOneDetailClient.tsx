'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { ArrowLeft, Send, MessageSquare } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import {
  getOneOnOne,
  getUser,
  addOneOnOneQuestion,
  answerOneOnOneQuestion,
  getOneOnOneQuestions,
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
    if (!userProfile || !newQuestion.trim()) return;
    setSubmitting(true);
    try {
      await addOneOnOneQuestion(id, { askerId: userProfile.id, question: newQuestion.trim() });
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
    if (!userProfile || !answerDraft[questionId]?.trim()) return;
    setAnsweringId(questionId);
    try {
      await answerOneOnOneQuestion(id, questionId, {
        answer: answerDraft[questionId].trim(),
        answeredBy: userProfile.id,
      });
      setAnswerDraft(d => ({ ...d, [questionId]: '' }));
      toast.success('답변이 등록되었습니다.');
      await load();
    } catch {
      toast.error('답변 등록에 실패했습니다.');
    } finally {
      setAnsweringId(null);
    }
  }

  if (loading || !room || !userProfile) {
    return (
      <div className="flex flex-col h-full">
        <Header title="1on1" />
        <div className="flex flex-1 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </div>
    );
  }

  const isLeader = userProfile.id === room.leaderId;
  const canAnswer = (q: OneOnOneQuestion) => !q.answer && q.askerId !== userProfile.id;

  return (
    <div className="flex flex-col h-full">
      <Header title="1on1 Q&A" />
      <div className="flex-1 overflow-y-auto">

        <div className="border-b bg-white px-6 py-4">
          <button
            onClick={() => router.back()}
            className="mb-3 flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
          >
            <ArrowLeft className="h-4 w-4" /> 목록으로
          </button>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-600 font-semibold">
              {(isLeader ? member?.name : leader?.name)?.[0] ?? '?'}
            </div>
            <div>
              <p className="font-semibold text-gray-900">
                {isLeader ? member?.name : leader?.name}
                <span className="ml-2 text-xs font-normal text-gray-400">
                  {isLeader ? '팀원' : '팀장'}
                </span>
              </p>
              {room.title && <p className="text-sm text-gray-500">{room.title}</p>}
            </div>
          </div>
        </div>

        <div className="p-6 space-y-4 max-w-2xl mx-auto w-full">
          {questions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <MessageSquare className="h-10 w-10 mb-3 text-gray-200" />
              <p className="text-sm">아직 질문이 없습니다. 첫 질문을 남겨보세요.</p>
            </div>
          ) : (
            questions.map(q => {
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
                      <span className="text-sm font-medium text-gray-800">{asker?.name}</span>
                      <span className="text-xs text-gray-400">
                        {format(q.createdAt, 'MM.dd HH:mm', { locale: ko })}
                      </span>
                      <span className="ml-auto rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600">
                        Q
                      </span>
                    </div>
                    <p className="text-sm text-gray-800 whitespace-pre-wrap pl-9">{q.question}</p>
                  </div>

                  {q.answer ? (
                    <div className="border-t bg-gray-50 p-4 space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-green-100 text-green-600 text-xs font-semibold shrink-0">
                          {answerer?.name?.[0] ?? '?'}
                        </div>
                        <span className="text-sm font-medium text-gray-800">{answerer?.name}</span>
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

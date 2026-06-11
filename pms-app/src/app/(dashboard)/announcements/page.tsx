'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  getAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
} from '@/lib/firestore';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ChevronDown, ChevronUp, Pencil, Trash2, Plus } from 'lucide-react';
import type { Announcement } from '@/types';
import { shiftEnterSubmit } from '@/lib/utils';

export default function AnnouncementsPage() {
  const { userProfile } = useAuth();
  const isHrAdmin = !!userProfile?.isHrAdmin;

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // 모달 상태
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Announcement | null>(null);
  const [formTitle, setFormTitle] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formIsPinned, setFormIsPinned] = useState(false);
  const [formExpiresAt, setFormExpiresAt] = useState(''); // yyyy-MM-dd, 빈 값이면 무기한
  const [saving, setSaving] = useState(false);

  async function loadAnnouncements() {
    try {
      const items = await getAnnouncements();
      setAnnouncements(items);
    } catch (e: any) {
      console.error('공지사항 로드 실패:', e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAnnouncements();
  }, []);

  function openCreate() {
    setEditTarget(null);
    setFormTitle('');
    setFormContent('');
    setFormIsPinned(false);
    setFormExpiresAt('');
    setModalOpen(true);
  }

  function openEdit(a: Announcement) {
    setEditTarget(a);
    setFormTitle(a.title);
    setFormContent(a.content);
    setFormIsPinned(a.isPinned);
    setFormExpiresAt(a.expiresAt ? a.expiresAt.toISOString().slice(0, 10) : '');
    setModalOpen(true);
  }

  async function handleSave() {
    if (!userProfile) return;
    if (!formTitle.trim() || !formContent.trim()) return;
    setSaving(true);
    try {
      // 종료일은 해당일 23:59:59 까지 유효
      const expiresAt = formExpiresAt
        ? new Date(`${formExpiresAt}T23:59:59`)
        : undefined;
      if (editTarget) {
        await updateAnnouncement(editTarget.id, {
          title: formTitle.trim(),
          content: formContent.trim(),
          isPinned: formIsPinned,
          expiresAt,
        });
      } else {
        await createAnnouncement({
          title: formTitle.trim(),
          content: formContent.trim(),
          isPinned: formIsPinned,
          authorId: userProfile.id,
          authorName: userProfile.name,
          ...(expiresAt ? { expiresAt } : {}),
        });
      }
      setModalOpen(false);
      await loadAnnouncements();
    } catch (e: any) {
      console.error('공지사항 저장 실패:', e);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('이 공지사항을 삭제하시겠습니까?')) return;
    try {
      await deleteAnnouncement(id);
      setAnnouncements(prev => prev.filter(a => a.id !== id));
    } catch (e: any) {
      console.error('공지사항 삭제 실패:', e);
    }
  }

  function toggleExpand(id: string) {
    setExpandedId(prev => (prev === id ? null : id));
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="공지사항" />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-4">
          {/* 작성 버튼 (HR관리자만) */}
          {isHrAdmin && (
            <div className="flex justify-end">
              <Button onClick={openCreate} size="sm" className="flex items-center gap-1.5">
                <Plus className="h-4 w-4" />
                공지사항 작성
              </Button>
            </div>
          )}

          {/* 목록 */}
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-20 animate-pulse rounded-xl bg-gray-100" />
              ))}
            </div>
          ) : announcements.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-gray-50 p-12 text-center">
              <p className="text-sm text-gray-400">등록된 공지사항이 없습니다.</p>
            </div>
          ) : (
            <div className="rounded-xl border bg-white divide-y divide-gray-100 overflow-hidden">
              {announcements.map(a => (
                <div key={a.id}>
                  {/* 헤더 행 */}
                  <div
                    className="flex items-start gap-3 px-4 py-3.5 cursor-pointer hover:bg-gray-50 transition-colors"
                    onClick={() => toggleExpand(a.id)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {a.isPinned && (
                          <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                            📌 고정
                          </span>
                        )}
                        <span className="text-sm font-semibold text-gray-900 truncate">{a.title}</span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-400">
                        <span>{a.authorName}</span>
                        <span>·</span>
                        <span>
                          {a.createdAt.toLocaleDateString('ko-KR', {
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                          })}
                        </span>
                        {a.expiresAt && (
                          <>
                            <span>·</span>
                            <span className="text-orange-500">
                              ~ {a.expiresAt.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })} 까지
                            </span>
                          </>
                        )}
                      </div>
                      {expandedId !== a.id && (
                        <p className="mt-1 text-xs text-gray-500 line-clamp-2 whitespace-pre-wrap">
                          {a.content}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0 mt-0.5">
                      {isHrAdmin && (
                        <>
                          <button
                            onClick={e => { e.stopPropagation(); openEdit(a); }}
                            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                            title="수정"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); handleDelete(a.id); }}
                            className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                            title="삭제"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}
                      {expandedId === a.id
                        ? <ChevronUp className="h-4 w-4 text-gray-400" />
                        : <ChevronDown className="h-4 w-4 text-gray-400" />
                      }
                    </div>
                  </div>

                  {/* 펼친 내용 */}
                  {expandedId === a.id && (
                    <div className="bg-gray-50 px-4 py-4 border-t border-gray-100">
                      <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                        {a.content}
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 작성/수정 모달 */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-lg mx-4 rounded-2xl bg-white shadow-xl">
            <div className="border-b border-gray-100 px-6 py-4">
              <h3 className="text-base font-semibold text-gray-900">
                {editTarget ? '공지사항 수정' : '공지사항 작성'}
              </h3>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="ann-title">제목</Label>
                <Input
                  id="ann-title"
                  value={formTitle}
                  onChange={e => setFormTitle(e.target.value)}
                  placeholder="제목을 입력하세요"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ann-content">내용</Label>
                <textarea
                  id="ann-content"
                  value={formContent}
                  onChange={e => setFormContent(e.target.value)}
                  onKeyDown={shiftEnterSubmit(handleSave, !saving)}
                  placeholder="내용을 입력하세요 (Shift+Enter 저장)"
                  rows={6}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ann-expires">게시 종료일 <span className="text-xs text-gray-400 font-normal">(미지정 시 무기한 / 종료일 지나면 자동 삭제)</span></Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="ann-expires"
                    type="date"
                    value={formExpiresAt}
                    onChange={e => setFormExpiresAt(e.target.value)}
                    min={new Date().toISOString().slice(0, 10)}
                    className="flex-1"
                  />
                  {formExpiresAt && (
                    <Button variant="ghost" size="sm" onClick={() => setFormExpiresAt('')} className="text-xs text-gray-500">
                      해제
                    </Button>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="ann-pinned"
                  type="checkbox"
                  checked={formIsPinned}
                  onChange={e => setFormIsPinned(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 accent-blue-600 cursor-pointer"
                />
                <Label htmlFor="ann-pinned" className="cursor-pointer font-normal">
                  상단 고정 (📌 핀)
                </Label>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-100 px-6 py-4">
              <Button
                variant="outline"
                onClick={() => setModalOpen(false)}
                disabled={saving}
              >
                취소
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || !formTitle.trim() || !formContent.trim()}
              >
                {saving ? '저장 중...' : '저장'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

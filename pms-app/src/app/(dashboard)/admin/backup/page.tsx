'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useActiveYear } from '@/contexts/ActiveYearContext';
import { auth } from '@/lib/firebase';
import {
  getAllUsers, getAllGoalsByYear, getAllIndividualEvaluations,
  getOrgEvaluations, getMentoringFormsByUsers,
  getBackups, deleteBackup,
  createAuditLog,
  type BackupRecord,
} from '@/lib/firestore';
import Header from '@/components/layout/Header';
import AuthGuard from '@/components/layout/AuthGuard';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { DatabaseBackup, Trash2, Download, AlertCircle, Upload, RotateCcw } from 'lucide-react';
import * as XLSX from 'xlsx';

export default function BackupPage() {
  return (
    <AuthGuard requireHrMaster>
      <BackupContent />
    </AuthGuard>
  );
}

function BackupContent() {
  const { userProfile } = useAuth();
  const { activeYear } = useActiveYear();
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [jsonDownloading, setJsonDownloading] = useState<string | null>(null);

  // 백업 JSON 원본 다운로드 (HR 마스터 검증용)
  async function handleJsonDownload(backup: BackupRecord) {
    if (!backup.storagePath) {
      toast.error('이 백업은 구버전 메타데이터라 원본 JSON 이 없습니다.');
      return;
    }
    setJsonDownloading(backup.id);
    try {
      const fbUser = auth.currentUser;
      if (!fbUser) throw new Error('로그인이 필요합니다.');
      const idToken = await fbUser.getIdToken();
      const res = await fetch(`/api/admin/backup/file?id=${backup.id}`, {
        headers: { 'Authorization': `Bearer ${idToken}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? '다운로드 실패');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup_${backup.year}_${format(backup.createdAt, 'yyyyMMdd_HHmm', { locale: ko })}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('JSON 원본을 다운로드했습니다.');
    } catch (e: any) {
      toast.error(`JSON 다운로드 실패: ${e?.message ?? '알 수 없는 오류'}`);
    } finally {
      setJsonDownloading(null);
    }
  }

  async function loadBackups() {
    try {
      const list = await getBackups();
      setBackups(list);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadBackups(); }, []);

  async function handleCreateBackup() {
    if (!userProfile) return;
    if (!confirm(`전체 인사평가 데이터를 백업하시겠습니까?\n백업은 복원이 가능한 전체 스냅샷 JSON으로 저장됩니다.`)) return;

    setCreatingBackup(true);
    try {
      const fbUser = auth.currentUser;
      if (!fbUser) throw new Error('로그인이 필요합니다.');
      const idToken = await fbUser.getIdToken();
      const res = await fetch('/api/admin/backup/snapshot', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${idToken}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? '백업 실패');
      const sizeKB = Math.round((data.sizeBytes ?? 0) / 1024);
      toast.success(`백업이 완료되었습니다. (${sizeKB.toLocaleString()}KB)`);
      await loadBackups();
    } catch (e: any) {
      toast.error(`백업 실패: ${e?.message ?? '알 수 없는 오류'}`);
    } finally {
      setCreatingBackup(false);
    }
  }

  async function handleRestore(backup: BackupRecord) {
    if (!userProfile) return;
    if (!backup.storagePath) {
      toast.error('이 백업은 메타데이터만 있는 구버전 기록이라 복원할 수 없습니다.');
      return;
    }
    const dt = format(backup.createdAt, 'yyyy.MM.dd HH:mm', { locale: ko });
    const msg =
      `⚠️ 매우 위험한 작업입니다.\n\n` +
      `이 백업 (${backup.year}년, ${dt}) 으로 전체 데이터를 덮어씁니다.\n` +
      `현재 모든 사용자·목표·평가·면담서 등이 백업 시점의 상태로 되돌아갑니다.\n` +
      `이 작업은 되돌릴 수 없습니다.\n\n` +
      `정말 진행하시려면 다음 입력창에 "RESTORE" 를 입력하세요.`;
    if (!confirm(msg)) return;
    const typed = prompt('확인을 위해 "RESTORE" 를 입력하세요:');
    if (typed !== 'RESTORE') {
      toast.message('취소되었습니다.');
      return;
    }
    setRestoring(backup.id);
    try {
      const fbUser = auth.currentUser;
      if (!fbUser) throw new Error('로그인이 필요합니다.');
      const idToken = await fbUser.getIdToken();
      const res = await fetch('/api/admin/backup/restore', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ backupId: backup.id, confirmText: 'RESTORE' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? '복원 실패');
      toast.success('복원이 완료되었습니다. 페이지를 새로고침합니다.');
      setTimeout(() => window.location.reload(), 1500);
    } catch (e: any) {
      toast.error(`복원 실패: ${e?.message ?? '알 수 없는 오류'}`);
    } finally {
      setRestoring(null);
    }
  }

  async function handleDelete(backup: BackupRecord) {
    if (!confirm(`${backup.year}년 백업 (${format(backup.createdAt, 'yyyy.MM.dd HH:mm', { locale: ko })})을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;
    setDeleting(backup.id);
    try {
      await deleteBackup(backup.id);
      if (userProfile) {
        await createAuditLog({
          action: 'BACKUP_DELETE',
          actorId: userProfile.id,
          actorName: userProfile.name,
          details: `${backup.year}년 백업 삭제 (${format(backup.createdAt, 'yyyy.MM.dd HH:mm', { locale: ko })})`,
        });
      }
      toast.success('백업이 삭제되었습니다.');
      setBackups(prev => prev.filter(b => b.id !== backup.id));
    } catch (e: any) {
      toast.error(`삭제 실패: ${e?.message ?? '알 수 없는 오류'}`);
    } finally {
      setDeleting(null);
    }
  }

  async function handleDownload(backup: BackupRecord) {
    setDownloading(backup.id);
    try {
      // 백업 시점의 스냅샷 JSON 을 그대로 읽어 Excel 로 변환 — "백업 당시" 데이터를 정확히 반영.
      // (구버전 백업은 storagePath 가 없어 live 쿼리로 폴백)
      const fbUser = auth.currentUser;
      if (!fbUser) throw new Error('로그인이 필요합니다.');
      let snapshot: any = null;
      if (backup.storagePath) {
        const idToken = await fbUser.getIdToken();
        const res = await fetch(`/api/admin/backup/file?id=${backup.id}`, {
          headers: { 'Authorization': `Bearer ${idToken}` },
        });
        if (res.ok) snapshot = await res.json();
      }

      const wb = XLSX.utils.book_new();
      // 직렬화된 {__ts: iso} 또는 Date 문자열을 yyyy-MM-dd HH:mm 으로 표시
      const fmtDate = (v: any): string => {
        if (!v) return '';
        if (typeof v === 'object' && '__ts' in v) return format(new Date(v.__ts), 'yyyy-MM-dd HH:mm');
        if (typeof v === 'string') return v;
        return '';
      };
      const join = (v: any): string => Array.isArray(v) ? v.join(', ') : String(v ?? '');

      if (snapshot?.data) {
        // ─── 신규: 백업 JSON 기반 (정확한 시점 데이터) ───
        const collMap: Record<string, any[]> = {};
        for (const name of (snapshot.collections as string[])) {
          collMap[name] = (snapshot.data[name] ?? []).map((doc: any) => ({ id: doc.id, ...doc.data }));
        }
        const userMap: Record<string, string> = Object.fromEntries(
          (collMap.users ?? []).map(u => [u.id, u.name])
        );
        const orgMap: Record<string, string> = Object.fromEntries(
          (collMap.organizations ?? []).map(o => [o.id, o.name])
        );

        // ① 사용자
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
          (collMap.users ?? []).map((u: any) => ({
            '이름': u.name ?? '', '이메일': u.email ?? '', '역할': u.role ?? '',
            '소속 조직': orgMap[u.organizationId] ?? u.organizationId ?? '',
            '직책': u.position ?? '', '직급': u.rank ?? '', '입사일': u.hireDate ?? '',
            'HR관리자': u.isHrAdmin ? 'O' : '', 'HR마스터': u.isHrMaster ? 'O' : '',
            '활성': u.isActive ? 'O' : '',
          }))
        ), '사용자');

        // ② 조직
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
          (collMap.organizations ?? []).map((o: any) => ({
            '조직명': o.name ?? '', '유형': o.type ?? '',
            '상위': orgMap[o.parentId] ?? '', '책임자': userMap[o.leaderId] ?? '',
            '정렬순서': o.displayOrder ?? '',
          }))
        ), '조직');

        // ③ 목표 (전체 필드 + 진행률 + 가중치 + 협업자)
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
          (collMap.goals ?? []).map((g: any) => ({
            '담당자': userMap[g.userId] ?? g.userId ?? '',
            '조직': orgMap[g.organizationId] ?? '',
            '연도': g.year ?? '', '제목': g.title ?? '', '내용': g.description ?? '',
            '유형': g.goalType ?? '', '카테고리': g.taskCategory ?? g.generalType ?? '',
            '상태': g.status ?? '', '진행률': `${g.progress ?? 0}%`,
            '가중치': g.weight ?? '', '중요도': g.importance ?? '',
            '마감일': g.dueDate ?? '',
            '공동수행자': (g.collaboratorIds ?? []).map((id: string) => userMap[id] ?? id).join(', '),
            '이관 이전': g.previousOwnerName ?? '',
          }))
        ), '목표');

        // ④ 목표 진행 업데이트
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
          (collMap.progressUpdates ?? []).map((p: any) => ({
            '목표 ID': p.goalId ?? '', '작성자': userMap[p.userId] ?? p.userId ?? '',
            '진행률': `${p.progress ?? 0}%`, '코멘트': p.comment ?? '',
            '작성일': fmtDate(p.createdAt),
          }))
        ), '목표 진행이력');

        // ⑤ 자기평가
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
          (collMap.selfEvaluations ?? []).map((s: any) => ({
            '대상자': userMap[s.userId] ?? s.userId ?? '', '연도': s.cycleYear ?? '',
            '과제업무 의견': s.taskOpinion ?? '', '일반업무 의견': s.generalOpinion ?? '',
            '상태': s.status ?? '', '제출일': fmtDate(s.submittedAt),
          }))
        ), '자기평가');

        // ⑥ 개인평가 (등급·의견 포함 — 백업 본인 보호 용도)
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
          (collMap.individualEvaluations ?? []).map((e: any) => ({
            '대상자': userMap[e.userId] ?? e.userId ?? '', '연도': e.cycleYear ?? '',
            '팀장 등급': e.leadGrade ?? '', '본부장 등급': e.hqGrade ?? '',
            '임원 최종등급': e.execGrade ?? '',
            '팀장 의견': e.leadComment ?? '', '본부장 의견': e.hqComment ?? '',
            '임원 의견': e.execComment ?? '', '상태': e.status ?? '',
            '확정일': fmtDate(e.execConfirmedAt),
          }))
        ), '개인평가');

        // ⑦ 조직평가
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
          (collMap.orgEvaluations ?? []).map((e: any) => ({
            '조직': orgMap[e.organizationId] ?? e.organizationId ?? '',
            '연도': e.cycleYear ?? '', '등급': e.grade ?? '', '상태': e.status ?? '',
          }))
        ), '조직평가');

        // ⑧ 조직평가 이력
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
          (collMap.orgGradeHistories ?? []).map((h: any) => ({
            '조직': orgMap[h.organizationId] ?? '', '연도': h.cycleYear ?? '',
            '이전 등급': h.previousGrade ?? '', '새 등급': h.newGrade ?? '',
            '변경자': userMap[h.changedBy] ?? '', '사유': h.reason ?? '',
            '변경일': fmtDate(h.changedAt),
          }))
        ), '조직평가 이력');

        // ⑨ 육성면담서
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
          (collMap.mentoringForms ?? []).map((m: any) => ({
            '담당자': userMap[m.userId] ?? '', '연도': m.cycleYear ?? '',
            '직위/직책': m.currentPosition ?? '', '주요 담당업무': m.mainDuties ?? '',
            '당해년도 업적': m.achievements ?? '', '경력개발 계획': m.careerPlan ?? '',
            '본인 종합의견': m.selfOpinion ?? '', '팀장 의견': m.leadOpinion ?? '',
            '임원 의견': m.execOpinion ?? '', '상태': m.status ?? '',
            '제출일': fmtDate(m.submittedAt),
          }))
        ), '육성면담서');

        // ⑩ 주간업무 (실적 + 계획)
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
          (collMap.weeklyTasks ?? []).flatMap((w: any) => {
            const done = (w.hasDoneItems ?? []).map((it: any) => ({
              '담당자': userMap[w.userId] ?? '', '연도': w.year ?? '', '주차': w.weekNumber ?? '',
              '구분': '한일', '제목': it.title ?? '', '내용': it.content ?? '',
              '중요표시': it.starred ? '★' : '',
            }));
            const willDo = (w.willDoItems ?? []).map((it: any) => ({
              '담당자': userMap[w.userId] ?? '', '연도': w.year ?? '', '주차': w.weekNumber ?? '',
              '구분': '할일', '제목': it.title ?? '', '내용': it.content ?? '',
              '중요표시': it.starred ? '★' : '',
            }));
            return [...done, ...willDo];
          })
        ), '주간업무');

        // ⑪ 연간목표
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
          (collMap.annualGoals ?? []).map((a: any) => ({
            '조직': orgMap[a.organizationId] ?? '', '연도': a.year ?? '',
            '제목': a.title ?? '', '내용': a.description ?? '',
            '담당자': userMap[a.ownerId] ?? '',
          }))
        ), '연간목표');

        // ⑫ 포상 이력
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
          (collMap.awards ?? []).map((a: any) => ({
            '수상자': userMap[a.userId] ?? '', '명칭': a.name ?? '',
            '카테고리': a.category ?? '', '수여일': a.date ?? '',
            '내용': a.description ?? '', '수여자': userMap[a.grantedBy] ?? '',
          }))
        ), '포상 이력');

        // ⑬ 마일리지
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
          (collMap.mileages ?? []).map((m: any) => ({
            '대상자': userMap[m.userId] ?? '', '연도': m.year ?? '',
            '유형': m.type ?? '', '점수': m.points ?? '',
            '내용': m.description ?? '', '발급자': userMap[m.grantedBy] ?? '',
            '발급일': fmtDate(m.createdAt),
          }))
        ), '마일리지');

        // ⑭ 혁신활동 이력
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
          (collMap.innovationActivities ?? []).map((i: any) => ({
            '제목': i.title ?? '', '내용': i.description ?? '',
            'PM': (i.pmIds ?? []).map((id: string) => userMap[id] ?? id).join(', '),
            '수행자': (i.performerIds ?? []).map((id: string) => userMap[id] ?? id).join(', '),
            '상태': i.status ?? '', '시작일': i.startDate ?? '', '종료일': i.endDate ?? '',
            '효과': i.effect ?? '',
          }))
        ), '혁신활동');

        // ⑮ 1on1
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
          (collMap.oneOnOnes ?? []).map((o: any) => ({
            '참여자 A': userMap[o.participantAId] ?? '',
            '참여자 B': userMap[o.participantBId] ?? '',
            '주제': o.topic ?? '', '생성일': fmtDate(o.createdAt),
          }))
        ), '1on1');

        // ⑯ 통계 (메타)
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
          Object.entries(snapshot.stats ?? {}).map(([k, v]) => ({ '컬렉션': k, '문서 수': v }))
        ), '통계');
      } else {
        // ─── 구버전 폴백: live 쿼리 ───
        const [allUsers, goals, indivEvals, orgEvals] = await Promise.all([
          getAllUsers(),
          getAllGoalsByYear(backup.year),
          getAllIndividualEvaluations(backup.year),
          getOrgEvaluations(backup.year),
        ]);
        const activeUsers = allUsers.filter(u => u.isActive);
        const mentoringForms = await getMentoringFormsByUsers(activeUsers.map(u => u.id), backup.year);
        const userMap = Object.fromEntries(allUsers.map(u => [u.id, u.name]));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(activeUsers.map(u => ({
          '이름': u.name, '이메일': u.email, '역할': u.role, '직책': u.position ?? '',
        }))), '사용자');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(goals.map(g => ({
          '담당자': userMap[g.userId] ?? g.userId, '제목': g.title, '진행률': `${g.progress}%`,
        }))), '목표');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(indivEvals.map(e => ({
          '대상자': userMap[e.userId] ?? e.userId, '상태': e.status,
        }))), '개인평가');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(orgEvals.map(e => ({
          '조직 ID': e.organizationId, '평가등급': e.grade ?? '', '상태': e.status,
        }))), '조직평가');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(mentoringForms.map(m => ({
          '담당자': userMap[m.userId] ?? m.userId, '상태': m.status,
        }))), '육성면담서');
      }

      XLSX.writeFile(wb, `인사데이터_${backup.year}년_${format(backup.createdAt, 'yyyyMMdd_HHmm', { locale: ko })}.xlsx`);
      if (userProfile) {
        await createAuditLog({
          action: 'BACKUP_DOWNLOAD',
          actorId: userProfile.id,
          actorName: userProfile.name,
          details: `${backup.year}년 백업 Excel 다운로드 (백업 스냅샷 기반, 전체 시트)`,
        });
      }
      toast.success('Excel 파일이 다운로드되었습니다.');
    } catch (e: any) {
      toast.error(`다운로드 실패: ${e?.message ?? '알 수 없는 오류'}`);
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="데이터 백업 관리" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-3xl">

        {/* 백업 생성 */}
        <div className="rounded-xl border bg-white p-6 space-y-4">
          <div className="flex items-center gap-2">
            <DatabaseBackup className="h-5 w-5 text-blue-600" />
            <h2 className="font-semibold text-gray-900">{activeYear}년 데이터 백업</h2>
          </div>
          <p className="text-sm text-gray-500">
            전체 인사평가 데이터(사용자·조직·목표·평가·육성면담서·연간목표·주간업무 등)의 <strong>완전한 스냅샷</strong>을 백업합니다.<br />
            백업 파일은 Firebase Storage 에 JSON 으로 저장되며, 필요 시 업로드(복원) 버튼으로 전체 데이터를 백업 시점으로 되돌릴 수 있습니다.
          </p>
          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold mb-1">백업·복원 안내</p>
              <ul className="list-disc list-inside text-xs space-y-0.5">
                <li>매주 <strong>월요일 09:00</strong> 자동 백업이 실행됩니다.</li>
                <li>업로드(복원) 시 현재 데이터는 백업 시점 상태로 <strong>전체 덮어쓰기</strong> 됩니다.</li>
                <li>복원 작업은 비가역적이며 HR 마스터만 실행 가능합니다.</li>
                <li>Excel 다운로드는 등급·의견을 제외한 보고용입니다.</li>
              </ul>
            </div>
          </div>
          <Button onClick={handleCreateBackup} disabled={creatingBackup} className="gap-2">
            <DatabaseBackup className="h-4 w-4" />
            {creatingBackup ? '백업 중...' : `지금 백업하기`}
          </Button>
        </div>

        {/* 백업 목록 */}
        <div className="rounded-xl border bg-white overflow-hidden">
          <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">백업 목록</h3>
            <span className="text-xs text-gray-400">{backups.length}건</span>
          </div>
          {loading ? (
            <div className="p-4 space-y-2">
              {[1,2,3].map(i => <div key={i} className="h-14 animate-pulse rounded-lg bg-gray-100" />)}
            </div>
          ) : backups.length === 0 ? (
            <div className="p-12 text-center text-sm text-gray-400">백업 이력이 없습니다.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left">백업 연도</th>
                  <th className="px-4 py-3 text-left">생성일시</th>
                  <th className="px-4 py-3 text-left">통계</th>
                  <th className="px-4 py-3 text-right">액션</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {backups.map(backup => (
                  <tr key={backup.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-semibold text-gray-900">
                      {backup.year}년
                      {backup.isAuto && <span className="ml-1.5 inline-block rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">자동</span>}
                      {!backup.storagePath && <span className="ml-1.5 inline-block rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-600" title="복원 불가 (구버전 메타데이터)">구버전</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {format(backup.createdAt, 'yyyy.MM.dd HH:mm', { locale: ko })}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs space-x-2">
                      <span>목표 {backup.stats.goals}건</span>
                      <span>·</span>
                      <span>평가 {backup.stats.individualEvaluations}건</span>
                      <span>·</span>
                      <span>면담서 {backup.stats.mentoringForms}건</span>
                      {backup.sizeBytes && <>
                        <span>·</span>
                        <span>{Math.round(backup.sizeBytes / 1024).toLocaleString()}KB</span>
                      </>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleRestore(backup)}
                          disabled={restoring === backup.id || !backup.storagePath}
                          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-orange-600 hover:bg-orange-50 transition-colors disabled:opacity-30"
                          title={backup.storagePath ? '이 백업으로 전체 복원 (덮어쓰기)' : '구버전 백업 — 복원 불가'}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          {restoring === backup.id ? '복원 중...' : '복원'}
                        </button>
                        <button
                          onClick={() => handleJsonDownload(backup)}
                          disabled={jsonDownloading === backup.id || !backup.storagePath}
                          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-purple-600 hover:bg-purple-50 transition-colors disabled:opacity-30"
                          title="백업 JSON 원본 다운로드 (전체 데이터)"
                        >
                          <Download className="h-3.5 w-3.5" />
                          {jsonDownloading === backup.id ? '...' : 'JSON'}
                        </button>
                        <button
                          onClick={() => handleDownload(backup)}
                          disabled={downloading === backup.id}
                          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 transition-colors disabled:opacity-50"
                          title="Excel 변환 (16개 시트)"
                        >
                          <Download className="h-3.5 w-3.5" />
                          {downloading === backup.id ? '...' : 'Excel'}
                        </button>
                        <button
                          onClick={() => handleDelete(backup)}
                          disabled={deleting === backup.id}
                          className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
                          title="삭제"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

      </div>
    </div>
  );
}

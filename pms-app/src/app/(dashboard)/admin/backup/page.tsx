'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useActiveYear } from '@/contexts/ActiveYearContext';
import {
  getAllUsers, getAllGoalsByYear, getAllIndividualEvaluations,
  getOrgEvaluations, getMentoringFormsByUsers,
  getBackups, createBackup, deleteBackup,
  createAuditLog,
  type BackupRecord,
} from '@/lib/firestore';
import Header from '@/components/layout/Header';
import AuthGuard from '@/components/layout/AuthGuard';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { DatabaseBackup, Trash2, Download, AlertCircle } from 'lucide-react';
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
    if (!confirm(`${activeYear}년 데이터를 백업하시겠습니까?\n백업된 데이터는 목록에서 확인하고 Excel로 다운로드할 수 있습니다.`)) return;

    setCreatingBackup(true);
    try {
      const [allUsers, goals, indivEvals, orgEvals] = await Promise.all([
        getAllUsers(),
        getAllGoalsByYear(activeYear),
        getAllIndividualEvaluations(activeYear),
        getOrgEvaluations(activeYear),
      ]);
      const activeUsers = allUsers.filter(u => u.isActive);
      const mentoringForms = await getMentoringFormsByUsers(activeUsers.map(u => u.id), activeYear);

      const stats = {
        goals: goals.length,
        users: activeUsers.length,
        orgEvaluations: orgEvals.length,
        individualEvaluations: indivEvals.length,
        mentoringForms: mentoringForms.length,
      };

      await createBackup(activeYear, userProfile.id, stats);
      await createAuditLog({
        action: 'BACKUP_CREATE',
        actorId: userProfile.id,
        actorName: userProfile.name,
        details: `${activeYear}년 백업 생성 (목표 ${stats.goals}건, 평가 ${stats.individualEvaluations}건, 면담서 ${stats.mentoringForms}건)`,
      });
      toast.success(`${activeYear}년 백업이 완료되었습니다.`);
      await loadBackups();
    } catch (e: any) {
      toast.error(`백업 실패: ${e?.message ?? '알 수 없는 오류'}`);
    } finally {
      setCreatingBackup(false);
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
      const [allUsers, goals, indivEvals, orgEvals] = await Promise.all([
        getAllUsers(),
        getAllGoalsByYear(backup.year),
        getAllIndividualEvaluations(backup.year),
        getOrgEvaluations(backup.year),
      ]);
      const activeUsers = allUsers.filter(u => u.isActive);
      const mentoringForms = await getMentoringFormsByUsers(activeUsers.map(u => u.id), backup.year);

      const wb = XLSX.utils.book_new();

      // ① 사용자 시트
      const usersData = activeUsers.map(u => ({
        '이름': u.name,
        '이메일': u.email,
        '역할': u.role,
        '직위': u.position ?? '',
        '직급': u.rank ?? '',
        '입사일': u.hireDate ?? '',
        'HR관리자': u.isHrAdmin ? 'O' : '',
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(usersData), '사용자');

      // ② 목표 시트
      const userMap = Object.fromEntries(allUsers.map(u => [u.id, u.name]));
      const goalsData = goals.map(g => ({
        '담당자': userMap[g.userId] ?? g.userId,
        '제목': g.title,
        '유형': g.goalType,
        '상태': g.status,
        '진행률': `${g.progress}%`,
        '가중치': g.weight ?? '',
        '마감일': g.dueDate ? format(new Date(g.dueDate), 'yyyy-MM-dd') : '',
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(goalsData), '목표');

      // ③ 개인평가 시트 — 등급·의견 항상 제외 (다운로드 보안 정책)
      const indivData = indivEvals.map(e => ({
        '대상자': userMap[e.userId] ?? e.userId,
        '상태': e.status,
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(indivData), '개인평가');

      // ④ 조직평가 시트
      const orgEvalsData = orgEvals.map(e => ({
        '조직 ID': e.organizationId,
        '평가등급': e.grade ?? '',
        '상태': e.status,
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(orgEvalsData), '조직평가');

      // ⑤ 육성면담서 시트
      const mentoringData = mentoringForms.map(m => ({
        '담당자': userMap[m.userId] ?? m.userId,
        '상태': m.status,
        '직위/직책': m.currentPosition ?? '',
        '주요 담당업무': m.mainDuties ?? '',
        '당해년도 업적': m.achievements ?? '',
        '경력개발 계획': m.careerPlan ?? '',
        '종합의견': m.selfOpinion ?? '',
        '제출일': m.submittedAt ? format(new Date(m.submittedAt), 'yyyy-MM-dd') : '',
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(mentoringData), '육성면담서');

      XLSX.writeFile(wb, `인사데이터_${backup.year}년_${format(new Date(), 'yyyyMMdd')}.xlsx`);
      if (userProfile) {
        await createAuditLog({
          action: 'BACKUP_DOWNLOAD',
          actorId: userProfile.id,
          actorName: userProfile.name,
          details: `${backup.year}년 백업 Excel 다운로드 (등급/의견 제외)`,
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
            현재 활성 연도({activeYear}년)의 목표, 평가, 육성면담서 등 모든 인사 데이터를 백업합니다.<br />
            백업 후 Excel로 다운로드할 수 있습니다.
          </p>
          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold mb-1">백업 주의사항</p>
              <ul className="list-disc list-inside text-xs space-y-0.5">
                <li>백업은 기록 용도이며, 원본 데이터는 삭제되지 않습니다.</li>
                <li>백업 삭제는 HR관리자만 가능합니다.</li>
                <li>연도 전환 전 백업을 권장합니다.</li>
              </ul>
            </div>
          </div>
          <Button onClick={handleCreateBackup} disabled={creatingBackup} className="gap-2">
            <DatabaseBackup className="h-4 w-4" />
            {creatingBackup ? '백업 중...' : `${activeYear}년 데이터 백업하기`}
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
                    <td className="px-4 py-3 font-semibold text-gray-900">{backup.year}년</td>
                    <td className="px-4 py-3 text-gray-500">
                      {format(backup.createdAt, 'yyyy.MM.dd HH:mm', { locale: ko })}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs space-x-2">
                      <span>목표 {backup.stats.goals}건</span>
                      <span>·</span>
                      <span>평가 {backup.stats.individualEvaluations}건</span>
                      <span>·</span>
                      <span>면담서 {backup.stats.mentoringForms}건</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleDownload(backup)}
                          disabled={downloading === backup.id}
                          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 transition-colors disabled:opacity-50"
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

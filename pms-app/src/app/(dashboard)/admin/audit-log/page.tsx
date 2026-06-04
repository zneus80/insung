'use client';

import { useEffect, useState } from 'react';
import { listAuditLogs } from '@/lib/firestore';
import { auth } from '@/lib/firebase';
import Header from '@/components/layout/Header';
import AuthGuard from '@/components/layout/AuthGuard';
import { SearchInput } from '@/components/ui/search-input';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { Download, ShieldAlert, ScanSearch, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AuditLog, AuditLogAction } from '@/types';

interface ScanUser { email: string; count: number; ips: string[]; byCollection: Record<string, number>; }
interface ScanResult { windowMin: number; threshold: number; scannedEntries: number; anomalyCount: number; topUsers: ScanUser[]; }

const ACTION_LABEL: Record<AuditLogAction, string> = {
  HR_ROLE_GRANT:     'HR 권한 부여',
  HR_ROLE_REVOKE:    'HR 권한 제거',
  PASSWORD_RESET:    '비밀번호 초기화',
  BACKUP_CREATE:     '백업 생성',
  BACKUP_DOWNLOAD:   '백업 다운로드',
  BACKUP_DELETE:     '백업 삭제',
  BACKUP_RESTORE:    '백업 복원',
  BACKUP_FAILED:     '백업 실패',
  USER_DELETE:       '사용자 삭제',
  EVAL_GRADE_CHANGE: '평가 등급 변경',
  READ_ANOMALY_DETECTED: '대량 조회 감지',
  AI_EVAL_SUMMARY: 'AI 성과 요약',
};

const ACTION_COLOR: Record<AuditLogAction, string> = {
  HR_ROLE_GRANT:     'bg-blue-100 text-blue-700',
  HR_ROLE_REVOKE:    'bg-orange-100 text-orange-700',
  PASSWORD_RESET:    'bg-purple-100 text-purple-700',
  BACKUP_CREATE:     'bg-green-100 text-green-700',
  BACKUP_DOWNLOAD:   'bg-teal-100 text-teal-700',
  BACKUP_DELETE:     'bg-red-100 text-red-700',
  BACKUP_RESTORE:    'bg-orange-100 text-orange-700',
  BACKUP_FAILED:     'bg-red-100 text-red-700',
  USER_DELETE:       'bg-red-100 text-red-700',
  EVAL_GRADE_CHANGE: 'bg-indigo-100 text-indigo-700',
  READ_ANOMALY_DETECTED: 'bg-red-100 text-red-700',
  AI_EVAL_SUMMARY: 'bg-violet-100 text-violet-700',
};

export default function AuditLogPage() {
  return (
    <AuthGuard requireHrMaster>
      <AuditLogContent />
    </AuthGuard>
  );
}

function AuditLogContent() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState<AuditLogAction | 'ALL'>('ALL');
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanWindow, setScanWindow] = useState(60);

  async function handleScan() {
    setScanning(true);
    setScanResult(null);
    try {
      const fbUser = auth.currentUser;
      if (!fbUser) throw new Error('로그인이 필요합니다.');
      const idToken = await fbUser.getIdToken();
      // report=1: 현황 조회 전용 (알림 미발동). windowMin 으로 조회 구간 지정.
      const res = await fetch(`/api/admin/read-anomaly-scan?report=1&windowMin=${scanWindow}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? '스캔 실패');
      setScanResult({
        windowMin: data.windowMin,
        threshold: data.threshold,
        scannedEntries: data.scannedEntries,
        anomalyCount: data.anomalyCount,
        topUsers: data.topUsers ?? [],
      });
      toast.success(`스캔 완료 — 최근 ${data.windowMin}분간 평가 조회 ${data.scannedEntries}건`);
    } catch (e: any) {
      toast.error(`스캔 실패: ${e?.message ?? '알 수 없는 오류'}`);
    } finally {
      setScanning(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const list = await listAuditLogs(500);
        if (!cancelled) setLogs(list);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const filtered = logs.filter(l => {
    if (actionFilter !== 'ALL' && l.action !== actionFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      return l.actorName.toLowerCase().includes(q)
        || (l.targetName ?? '').toLowerCase().includes(q)
        || (l.details ?? '').toLowerCase().includes(q);
    }
    return true;
  });

  function handleDownload() {
    const rows = filtered.map(l => ({
      '시각':   format(l.createdAt, 'yyyy-MM-dd HH:mm:ss', { locale: ko }),
      '액션':   ACTION_LABEL[l.action] ?? l.action,
      '행위자': l.actorName,
      '대상':   l.targetName ?? '',
      '상세':   l.details ?? '',
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), '감사 로그');
    XLSX.writeFile(wb, `감사로그_${format(new Date(), 'yyyyMMdd_HHmm')}.xlsx`);
  }

  const ACTIONS: ('ALL' | AuditLogAction)[] = [
    'ALL', 'HR_ROLE_GRANT', 'HR_ROLE_REVOKE', 'PASSWORD_RESET',
    'BACKUP_CREATE', 'BACKUP_DOWNLOAD', 'BACKUP_DELETE', 'USER_DELETE',
  ];

  return (
    <div className="flex flex-col h-full">
      <Header title="감사 로그" />
      <div className="flex-1 overflow-y-auto p-6 space-y-4">

        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3 text-sm text-amber-800">
          <ShieldAlert className="h-5 w-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold mb-1">민감 액션 추적</p>
            <p className="text-xs">HR 권한 변경·비밀번호 초기화·백업 액션·사용자 삭제 등의 이력이 자동 기록됩니다. 최대 500건까지 표시.</p>
          </div>
        </div>

        {/* ── 평가 데이터 대량 조회(read) 스캔 ─────────────── */}
        <div className="rounded-xl border bg-white p-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <ScanSearch className="h-5 w-5 text-red-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900">평가 데이터 대량 조회 스캔</p>
              <p className="text-xs text-gray-500">
                최근 구간 동안 평가 데이터(개인평가·자기평가·연말평가·육성면담서)를 많이 조회한 사용자를 확인합니다.
                10분마다 자동 감시되며, 이 버튼은 지금 즉시 현황을 조회합니다 (알림은 발송되지 않음).
              </p>
            </div>
            <select
              value={scanWindow}
              onChange={e => setScanWindow(Number(e.target.value))}
              disabled={scanning}
              className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm bg-white"
            >
              <option value={10}>최근 10분</option>
              <option value={30}>최근 30분</option>
              <option value={60}>최근 1시간</option>
            </select>
            <button
              type="button"
              onClick={handleScan}
              disabled={scanning}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
            >
              <ScanSearch className="h-4 w-4" />
              {scanning ? '스캔 중...' : '지금 스캔'}
            </button>
          </div>

          {scanResult && (
            <div className="rounded-lg border bg-gray-50 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <p className="text-sm text-gray-700">
                  최근 <span className="font-semibold">{scanResult.windowMin}분</span> · 평가 조회 총{' '}
                  <span className="font-semibold">{scanResult.scannedEntries}건</span>
                  {scanResult.anomalyCount > 0 ? (
                    <span className="text-red-600 font-semibold"> · 임계({scanResult.threshold}건/10분) 초과 {scanResult.anomalyCount}명</span>
                  ) : (
                    <span className="text-green-600"> · 임계 초과 없음</span>
                  )}
                </p>
                <button onClick={() => setScanResult(null)} className="ml-auto text-gray-400 hover:text-gray-600" title="닫기">
                  <X className="h-4 w-4" />
                </button>
              </div>
              {scanResult.topUsers.length === 0 ? (
                <p className="text-xs text-gray-400">해당 구간에 평가 데이터 조회 기록이 없습니다.</p>
              ) : (
                <ul className="divide-y divide-gray-200 rounded-lg border bg-white overflow-hidden">
                  {scanResult.topUsers.map((u, i) => {
                    const over = u.count >= scanResult.threshold;
                    return (
                      <li key={i} className="px-3 py-2 flex items-center gap-3 text-sm">
                        <span className={cn('font-medium', over ? 'text-red-700' : 'text-gray-900')}>{u.email}</span>
                        {over && <span className="rounded-full bg-red-100 text-red-700 text-[10px] font-bold px-2 py-0.5">과다</span>}
                        <span className="text-xs text-gray-400 truncate">
                          {Object.entries(u.byCollection).map(([c, n]) => `${c} ${n}`).join(', ')} · IP {u.ips.join(', ') || '미상'}
                        </span>
                        <span className={cn('ml-auto font-semibold tabular-nums', over ? 'text-red-700' : 'text-gray-700')}>{u.count}건</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <SearchInput
            placeholder="행위자·대상·상세 검색"
            value={search}
            onChange={setSearch}
            className="max-w-xs"
          />
          <div className="flex gap-1 flex-wrap">
            {ACTIONS.map(a => (
              <button
                key={a}
                type="button"
                onClick={() => setActionFilter(a)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                  actionFilter === a ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {a === 'ALL' ? '전체' : ACTION_LABEL[a]}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={handleDownload}
            disabled={loading || filtered.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-green-600 text-white hover:bg-green-700 transition-colors disabled:opacity-50 ml-auto"
          >
            <Download className="h-4 w-4" />
            Excel
          </button>
          <span className="text-xs text-gray-400">{filtered.length}건</span>
        </div>

        <div className="rounded-xl border bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="px-4 py-3 text-left w-44">시각</th>
                <th className="px-4 py-3 text-left w-32">액션</th>
                <th className="px-4 py-3 text-left w-32">행위자</th>
                <th className="px-4 py-3 text-left w-32">대상</th>
                <th className="px-4 py-3 text-left">상세</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                [1, 2, 3, 4, 5].map(i => (
                  <tr key={i}>
                    <td colSpan={5} className="px-4 py-3">
                      <div className="h-4 animate-pulse rounded bg-gray-100" />
                    </td>
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400 text-sm">기록이 없습니다.</td>
                </tr>
              ) : filtered.map(l => (
                <tr key={l.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                    {format(l.createdAt, 'yyyy-MM-dd HH:mm:ss', { locale: ko })}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${ACTION_COLOR[l.action] ?? 'bg-gray-100 text-gray-600'}`}>
                      {ACTION_LABEL[l.action] ?? l.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900">{l.actorName}</td>
                  <td className="px-4 py-3 text-gray-500">{l.targetName ?? '-'}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs whitespace-pre-wrap">{l.details ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

      </div>
    </div>
  );
}

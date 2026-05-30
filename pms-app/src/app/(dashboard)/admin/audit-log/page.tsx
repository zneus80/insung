'use client';

import { useEffect, useState } from 'react';
import { listAuditLogs } from '@/lib/firestore';
import Header from '@/components/layout/Header';
import AuthGuard from '@/components/layout/AuthGuard';
import { SearchInput } from '@/components/ui/search-input';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import * as XLSX from 'xlsx';
import { Download, ShieldAlert } from 'lucide-react';
import type { AuditLog, AuditLogAction } from '@/types';

const ACTION_LABEL: Record<AuditLogAction, string> = {
  HR_ROLE_GRANT:    'HR 권한 부여',
  HR_ROLE_REVOKE:   'HR 권한 제거',
  PASSWORD_RESET:   '비밀번호 초기화',
  BACKUP_CREATE:    '백업 생성',
  BACKUP_DOWNLOAD:  '백업 다운로드',
  BACKUP_DELETE:    '백업 삭제',
  USER_DELETE:      '사용자 삭제',
};

const ACTION_COLOR: Record<AuditLogAction, string> = {
  HR_ROLE_GRANT:    'bg-blue-100 text-blue-700',
  HR_ROLE_REVOKE:   'bg-orange-100 text-orange-700',
  PASSWORD_RESET:   'bg-purple-100 text-purple-700',
  BACKUP_CREATE:    'bg-green-100 text-green-700',
  BACKUP_DOWNLOAD:  'bg-teal-100 text-teal-700',
  BACKUP_DELETE:    'bg-red-100 text-red-700',
  USER_DELETE:      'bg-red-100 text-red-700',
};

export default function AuditLogPage() {
  return (
    <AuthGuard allowedRoles={['CEO']} requireHrMaster>
      <AuditLogContent />
    </AuthGuard>
  );
}

function AuditLogContent() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState<AuditLogAction | 'ALL'>('ALL');

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

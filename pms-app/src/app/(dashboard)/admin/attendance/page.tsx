'use client';

import { useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { getAllUsers, getOrganizations, getAttendancesByYear, upsertAttendance } from '@/lib/firestore';
import { resolveUserByName } from '@/lib/excel-helpers';
import { useAuth } from '@/contexts/AuthContext';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SearchInput } from '@/components/ui/search-input';
import AuthGuard from '@/components/layout/AuthGuard';
import { Lock, Download, Upload, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { User, Organization, Attendance } from '@/types';

const NOW_YEAR = new Date().getFullYear();

export default function AttendancePage() {
  return (
    <AuthGuard allowedRoles={['CEO']} requireHrAdmin>
      <AttendanceContent />
    </AuthGuard>
  );
}

function AttendanceContent() {
  const { userProfile } = useAuth();
  const [year, setYear] = useState(NOW_YEAR);
  const [users, setUsers] = useState<User[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [att, setAtt] = useState<Record<string, Attendance>>({});
  const [drafts, setDrafts] = useState<Record<string, { late: string; absent: string }>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ success: number; failed: { row: number; reason: string }[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const isReadOnly = userProfile?.role === 'CEO';
  const orgName = (id?: string) => orgs.find(o => o.id === id)?.name ?? '-';

  async function load() {
    setLoading(true);
    try {
      // 사용자·조직은 항상 로드(근태 규칙 미배포 시에도 목록은 떠야 함)
      const [allUsers, allOrgs] = await Promise.all([getAllUsers(), getOrganizations()]);
      // CEO·임원 제외 — 근태 입력 대상은 팀장·팀원(차순위 임원 포함)
      const active = allUsers.filter(u => u.isActive && u.role !== 'CEO' && u.role !== 'EXECUTIVE');
      setUsers(active);
      setOrgs(allOrgs);
      // 근태값은 별도 조회(권한·규칙 문제로 실패해도 목록·입력은 가능)
      const list = await getAttendancesByYear(year).catch(() => [] as Attendance[]);
      const map = Object.fromEntries(list.map(a => [a.userId, a]));
      setAtt(map);
      setDrafts(Object.fromEntries(active.map(u => [u.id, {
        late: String(map[u.id]?.latenessCount ?? ''),
        absent: String(map[u.id]?.absenceCount ?? ''),
      }])));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [year]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveRow(user: User) {
    if (!userProfile) return;
    const d = drafts[user.id] ?? { late: '', absent: '' };
    const late = parseInt(d.late, 10);
    const absent = parseInt(d.absent, 10);
    if ((d.late !== '' && (isNaN(late) || late < 0)) || (d.absent !== '' && (isNaN(absent) || absent < 0))) {
      toast.error('지각·결근은 0 이상의 숫자여야 합니다.'); return;
    }
    setSavingId(user.id);
    try {
      await upsertAttendance(user.id, year, {
        organizationId: user.organizationId,
        latenessCount: isNaN(late) ? 0 : late,
        absenceCount: isNaN(absent) ? 0 : absent,
        updatedBy: userProfile.id,
      });
      toast.success(`${user.name}님 근태 저장`);
      await load();
    } catch (e: any) {
      toast.error(`저장 실패: ${e?.code ?? e?.message ?? '오류'}`);
    } finally {
      setSavingId(null);
    }
  }

  // ── 엑셀 양식: 이름·직책·이메일·소속 + 현재 지각/결근 prefill ──
  function downloadTemplate() {
    const sorted = users.slice().sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    const ws = XLSX.utils.aoa_to_sheet([
      ['이름', '직책', '이메일', '소속', '지각 횟수(숫자)', '결근 횟수(숫자)'],
      ...sorted.map(u => [u.name, u.position ?? '', u.email, orgName(u.organizationId), att[u.id]?.latenessCount ?? '', att[u.id]?.absenceCount ?? '']),
    ]);
    ws['!cols'] = [{ wch: 14 }, { wch: 14 }, { wch: 26 }, { wch: 18 }, { wch: 14 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `근태_${year}`);
    XLSX.writeFile(wb, `INSUNG_근태현황_${year}_양식.xlsx`);
  }

  function resolveRow(name: string, email: string): { id: string; org: string } | { error: string } {
    const em = email.trim().toLowerCase();
    if (em) {
      const matches = users.filter(u => u.email.toLowerCase() === em);
      if (matches.length === 1) return { id: matches[0].id, org: matches[0].organizationId };
      if (matches.length === 0) return { error: `이메일 "${email}" 사용자를 찾을 수 없습니다.` };
    }
    const r = resolveUserByName(name, users);
    if ('error' in r) return r;
    const u = users.find(x => x.id === r.id)!;
    return { id: u.id, org: u.organizationId };
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !userProfile) return;
    e.target.value = '';
    setUploading(true);
    setUploadResult(null);
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' }) as any[][];
      const dataRows = rows.slice(1);
      let success = 0;
      const failed: { row: number; reason: string }[] = [];
      for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        const rowNum = i + 2;
        const name = row[0]?.toString().trim();
        const email = row[2]?.toString().trim() ?? '';
        if (!name && !email) continue;
        const lateStr = row[4]?.toString().trim() ?? '';
        const absentStr = row[5]?.toString().trim() ?? '';
        if (lateStr === '' && absentStr === '') continue; // 둘 다 비면 변경 안 함
        const late = lateStr === '' ? 0 : parseInt(lateStr, 10);
        const absent = absentStr === '' ? 0 : parseInt(absentStr, 10);
        if (isNaN(late) || late < 0 || isNaN(absent) || absent < 0) {
          failed.push({ row: rowNum, reason: `지각/결근 값이 올바른 숫자가 아닙니다.` }); continue;
        }
        const r = resolveRow(name, email);
        if ('error' in r) { failed.push({ row: rowNum, reason: r.error }); continue; }
        try {
          await upsertAttendance(r.id, year, { organizationId: r.org, latenessCount: late, absenceCount: absent, updatedBy: userProfile.id });
          success++;
        } catch (err: any) {
          failed.push({ row: rowNum, reason: err?.message ?? '처리 실패' });
        }
      }
      setUploadResult({ success, failed });
      if (success > 0) { toast.success(`${success}명 근태 반영 완료`); await load(); }
      if (failed.length > 0) toast.error(`${failed.length}건 실패`);
      if (success === 0 && failed.length === 0) toast.info('입력된 근태 값이 없습니다.');
    } catch {
      toast.error('파일을 읽는 중 오류가 발생했습니다.');
    } finally {
      setUploading(false);
    }
  }

  const filtered = users
    .filter(u => {
      const txt = search.toLowerCase();
      return !txt || u.name.toLowerCase().includes(txt) || u.email.toLowerCase().includes(txt) || orgName(u.organizationId).toLowerCase().includes(txt);
    })
    .sort((a, b) => orgName(a.organizationId).localeCompare(orgName(b.organizationId), 'ko') || a.name.localeCompare(b.name, 'ko'));

  return (
    <div className="flex flex-col h-full">
      <Header title="근태 현황 관리" />
      <div className="flex-1 min-h-0 flex flex-col gap-4 p-6 overflow-hidden">

        {isReadOnly && (
          <div className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-700 shrink-0">
            <Lock className="h-4 w-4 shrink-0" />
            최고관리자는 근태현황을 조회만 할 수 있습니다. 입력은 HR관리자 계정으로 로그인하세요.
          </div>
        )}

        {!isReadOnly && (
          <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 space-y-2 shrink-0">
            <p className="text-sm font-semibold text-indigo-700">엑셀로 일괄 입력</p>
            <p className="text-xs text-indigo-600/90">
              양식을 받으면 사용자 기본정보·현재 근태가 미리 채워져 있습니다. <b>‘지각/결근 횟수’ 칸을 채워</b> 업로드하세요.
              둘 다 비워둔 사람은 변경되지 않습니다. (동명이인은 이메일로 매칭)
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={downloadTemplate} disabled={loading} className="gap-1.5">
                <Download className="h-4 w-4" /> 양식 다운로드
              </Button>
              <Button size="sm" onClick={() => fileRef.current?.click()} disabled={uploading} className="gap-1.5">
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {uploading ? '업로드 중…' : '엑셀 업로드'}
              </Button>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleUpload} className="hidden" />
            </div>
            {uploadResult && (
              <div className="text-xs space-y-1 pt-1">
                <p className="font-medium text-gray-700">결과: 성공 {uploadResult.success}명 / 실패 {uploadResult.failed.length}건</p>
                {uploadResult.failed.length > 0 && (
                  <ul className="max-h-28 overflow-y-auto list-disc ml-4 text-red-500">
                    {uploadResult.failed.map((f, i) => <li key={i}>{f.row}행: {f.reason}</li>)}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2 items-center shrink-0">
          <select value={year} onChange={e => setYear(Number(e.target.value))}
            className="h-9 rounded-md border border-gray-200 bg-white px-3 text-sm">
            {[NOW_YEAR, NOW_YEAR - 1, NOW_YEAR - 2].map(y => <option key={y} value={y}>{y}년</option>)}
          </select>
          <SearchInput placeholder="이름·이메일·소속 검색" value={search} onChange={setSearch} className="max-w-xs" />
          <span className="text-xs text-gray-400 ml-auto">총 {filtered.length}명</span>
        </div>

        <div className="flex-1 min-h-0 rounded-xl border bg-white overflow-y-auto overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="bg-gray-50 text-gray-500 text-xs sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3 text-left">이름</th>
                <th className="px-4 py-3 text-left">직책</th>
                <th className="px-4 py-3 text-left">소속</th>
                <th className="px-4 py-3 text-center">지각</th>
                <th className="px-4 py-3 text-center">결근</th>
                {!isReadOnly && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                [1, 2, 3].map(i => <tr key={i}><td colSpan={6} className="px-4 py-3"><div className="h-4 animate-pulse rounded bg-gray-100" /></td></tr>)
              ) : filtered.map(user => {
                const d = drafts[user.id] ?? { late: '', absent: '' };
                return (
                  <tr key={user.id}>
                    <td className="px-4 py-3 font-medium text-gray-900">{user.name}</td>
                    <td className="px-4 py-3 text-gray-500">{user.position ?? '-'}</td>
                    <td className="px-4 py-3 text-gray-500">{orgName(user.organizationId)}</td>
                    <td className="px-4 py-2 text-center">
                      {isReadOnly
                        ? <span>{att[user.id]?.latenessCount ?? '-'}</span>
                        : <Input type="number" min={0} value={d.late}
                            onChange={e => setDrafts(p => ({ ...p, [user.id]: { ...d, late: e.target.value } }))}
                            className="w-20 h-8 text-center mx-auto" placeholder="0" />}
                    </td>
                    <td className="px-4 py-2 text-center">
                      {isReadOnly
                        ? <span>{att[user.id]?.absenceCount ?? '-'}</span>
                        : <Input type="number" min={0} value={d.absent}
                            onChange={e => setDrafts(p => ({ ...p, [user.id]: { ...d, absent: e.target.value } }))}
                            className="w-20 h-8 text-center mx-auto" placeholder="0" />}
                    </td>
                    {!isReadOnly && (
                      <td className="px-4 py-2">
                        <Button size="sm" variant="outline" disabled={savingId === user.id} onClick={() => saveRow(user)}>
                          {savingId === user.id ? '저장 중…' : '저장'}
                        </Button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

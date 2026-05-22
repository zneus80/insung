'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getAllUsers, getOrganizations, createUser, updateUser, deleteUser, createInvitation } from '@/lib/firestore';
import MemberInfoModal from '@/components/members/MemberInfoModal';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import AuthGuard from '@/components/layout/AuthGuard';
import { Plus, Pencil, UserX, Download, Upload, AlertCircle, Trash2, Mail, Copy, Check, UserCheck, KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import type { User, Organization, UserRole } from '@/types';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } from 'firebase/auth';
import { firebaseConfig } from '@/lib/firebase';
import { isEmulator } from '@/lib/auth';
import * as XLSX from 'xlsx';

const TEMP_PASSWORD = 'Insung@1234!';

const ROLES: { value: UserRole; label: string }[] = [
  { value: 'MEMBER',    label: '팀원' },
  { value: 'TEAM_LEAD', label: '팀장' },
  { value: 'EXECUTIVE', label: '임원' },
  { value: 'CEO',       label: '최고관리자' },
];

const ROLE_LABEL: Record<string, UserRole> = {
  '팀원': 'MEMBER', '팀장': 'TEAM_LEAD', '임원': 'EXECUTIVE', '최고관리자': 'CEO',
  'MEMBER': 'MEMBER', 'TEAM_LEAD': 'TEAM_LEAD', 'EXECUTIVE': 'EXECUTIVE', 'CEO': 'CEO',
};

const ROLE_COLOR: Record<UserRole, string> = {
  MEMBER:    'bg-gray-100 text-gray-700',
  TEAM_LEAD: 'bg-green-100 text-green-700',
  EXECUTIVE: 'bg-purple-100 text-purple-700',
  CEO:       'bg-blue-100 text-blue-700',
};

export default function UsersPage() {
  return (
    <AuthGuard allowedRoles={['CEO']} requireHrAdmin>
      <UsersContent />
    </AuthGuard>
  );
}

function UsersContent() {
  const { userProfile } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [form, setForm] = useState({ name: '', email: '', role: 'MEMBER' as UserRole, organizationId: '', position: '', isHrAdmin: false });
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [deleting, setDeleting] = useState(false);

  // 초대 링크 상태
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [copied, setCopied] = useState(false);

  // 엑셀 업로드
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ success: number; failed: { row: number; reason: string }[] } | null>(null);

  async function load() {
    try {
      const [u, o] = await Promise.all([getAllUsers(), getOrganizations()]);
      setUsers(u);
      setOrgs(o);
    } catch (e: any) {
      console.error('사용자/조직 로드 실패:', e);
      toast.error(`데이터 로드 실패: ${e?.code ?? e?.message ?? '알 수 없는 오류'}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // ── 양식 다운로드 ────────────────────────────
  function downloadTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([
      ['이름*', '이메일*', '역할*', '직책', '소속조직명'],
      ['-- 아래에 데이터를 입력하세요 --', '', '', '', ''],
      ['홍길동', 'hong@insung.co.kr', '팀원', '선임연구원', orgs[0]?.name ?? 'INSUNG'],
      ['김팀장', 'kim@insung.co.kr', '팀장', '팀장', orgs[0]?.name ?? 'INSUNG'],
    ]);
    ws['!cols'] = [{ wch: 12 }, { wch: 28 }, { wch: 14 }, { wch: 14 }, { wch: 20 }];
    const ws2 = XLSX.utils.aoa_to_sheet([
      ['역할값 (영문/한글 모두 허용)'],
      ['팀원 (MEMBER)'], ['팀장 (TEAM_LEAD)'], ['임원 (EXECUTIVE)'], ['최고관리자 (CEO)'], ['HR관리자 (HR_ADMIN)'],
      [''], ['소속조직명 목록'],
      ...orgs.map(o => [o.name]),
    ]);
    ws2['!cols'] = [{ wch: 30 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '사용자등록');
    XLSX.utils.book_append_sheet(wb, ws2, '입력안내');
    XLSX.writeFile(wb, 'INSUNG_사용자등록_양식.xlsx');
  }

  // ── 초대 링크 생성 (기존 사용자 기반) ──────────
  async function handleSendInvite(user: User) {
    if (!userProfile) return;
    const token = await createInvitation({
      userId: user.id,   // 기등록된 Firestore 문서 ID
      email: user.email,
      name: user.name,
      role: user.role,
      organizationId: user.organizationId || '',
      position: user.position || '',
      createdBy: userProfile.id,
    });
    const link = `${window.location.origin}/invite/${token}`;
    setInviteLink(link);
    setInviteEmail(user.email);
    setInviteName(user.name);
    setCopied(false);
  }

  function copyLink() {
    if (!inviteLink) return;
    navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function openMailto() {
    if (!inviteLink) return;
    const subject = encodeURIComponent('[INSUNG] 시스템 초대');
    const body = encodeURIComponent(
      `${inviteName}님, 안녕하세요.\n\nINSUNG 목표성과관리 시스템에 초대되었습니다.\n\n아래 링크를 클릭하여 계정을 설정해주세요.\n\n${inviteLink}\n\n링크는 7일간 유효합니다.`
    );
    window.location.href = `mailto:${inviteEmail}?subject=${subject}&body=${body}`;
  }

  // ── 엑셀 업로드 ──────────────────────────────
  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setUploading(true);
    setUploadResult(null);
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '' }) as string[][];
      const dataRows = rows.slice(2).filter(r => r[0]?.toString().trim() && !r[0].startsWith('--'));
      const orgNameMap = Object.fromEntries(orgs.map(o => [o.name.trim(), o.id]));
      const existingEmails = new Set(users.map(u => u.email.toLowerCase()));
      let success = 0;
      const failed: { row: number; reason: string }[] = [];

      for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        const rowNum = i + 3;
        const name = row[0]?.toString().trim();
        const email = row[1]?.toString().trim().toLowerCase();
        const roleRaw = row[2]?.toString().trim();
        const position = row[3]?.toString().trim();
        const orgName = row[4]?.toString().trim();

        if (!name) { failed.push({ row: rowNum, reason: '이름이 비어있습니다.' }); continue; }
        if (!email || !email.includes('@')) { failed.push({ row: rowNum, reason: '이메일이 올바르지 않습니다.' }); continue; }
        if (!roleRaw) { failed.push({ row: rowNum, reason: '역할이 비어있습니다.' }); continue; }
        const role = ROLE_LABEL[roleRaw];
        if (!role) { failed.push({ row: rowNum, reason: `역할값 "${roleRaw}"이 올바르지 않습니다.` }); continue; }

        const organizationId = orgName ? (orgNameMap[orgName] ?? '') : '';

        try {
          if (existingEmails.has(email)) {
            const existing = users.find(u => u.email.toLowerCase() === email)!;
            await updateUser(existing.id, { name, role, organizationId, position: position || '' });
          } else {
            // 사용자 정보만 저장 (초대는 별도로 진행)
            await createUser(crypto.randomUUID(), {
              email, name, role,
              organizationId: organizationId || '',
              position: position || '',
              isActive: false,
            });
            existingEmails.add(email);
          }
          success++;
        } catch (err: any) {
          failed.push({ row: rowNum, reason: err?.message ?? '처리 실패' });
        }
      }
      setUploadResult({ success, failed });
      if (success > 0) { toast.success(`${success}명 처리 완료`); await load(); }
      if (failed.length > 0) { toast.error(`${failed.length}건 실패`); }
    } catch {
      toast.error('파일을 읽는 중 오류가 발생했습니다.');
    } finally { setUploading(false); }
  }

  // ── 단건 저장 ─────────────────────────────────
  function openNew() {
    setEditing(null);
    setForm({ name: '', email: '', role: 'MEMBER', organizationId: '', position: '', isHrAdmin: false });
    setShowDialog(true);
  }

  function openEdit(user: User) {
    setEditing(user);
    setForm({ name: user.name, email: user.email, role: user.role, organizationId: user.organizationId, position: user.position ?? '', isHrAdmin: !!user.isHrAdmin });
    setShowDialog(true);
  }

  // 초대 방식: Firestore에 정보만 저장 (isActive: false)
  async function handleSave() {
    if (!form.name) { toast.error('이름을 입력하세요.'); return; }
    setSaving(true);
    try {
      if (editing) {
        await updateUser(editing.id, {
          name: form.name, role: form.role,
          organizationId: form.organizationId || '',
          position: form.position,
          isHrAdmin: form.isHrAdmin,
        });
        toast.success('수정되었습니다.');
        setShowDialog(false);
        await load();
      } else {
        if (!form.email) { toast.error('이메일을 입력하세요.'); return; }
        await createUser(crypto.randomUUID(), {
          email: form.email, name: form.name, role: form.role,
          organizationId: form.organizationId || '',
          position: form.position || '',
          isHrAdmin: form.isHrAdmin,
          isActive: false,
        });
        toast.success('사용자가 등록되었습니다. 초대 또는 직접 등록 버튼으로 계정을 활성화하세요.');
        setShowDialog(false);
        await load();
      }
    } catch (e: any) {
      toast.error(e?.message ?? '오류가 발생했습니다.');
    } finally { setSaving(false); }
  }

  async function handleInvite(user: User) {
    await handleSendInvite(user);
  }

  // 직접 등록: Firebase Auth 계정 즉시 생성 + 임시 비밀번호 부여
  const [directResult, setDirectResult] = useState<{ name: string; email: string; password: string } | null>(null);

  async function handleDirectRegister(user: User) {
    setSaving(true);
    // 현재 HR 관리자 세션을 유지하기 위해 세컨더리 앱으로 신규 계정 생성
    const secondaryAppName = `secondary-${Date.now()}`;
    const secondaryApp = initializeApp(firebaseConfig, secondaryAppName);
    const secondaryAuth = getAuth(secondaryApp);
    try {
      if (isEmulator) {
        const host = process.env.NEXT_PUBLIC_EMULATOR_HOST ?? 'localhost';
        connectAuthEmulator(secondaryAuth, `http://${host}:9099`, { disableWarnings: true });
      }
      const cred = await createUserWithEmailAndPassword(secondaryAuth, user.email, TEMP_PASSWORD);
      // 기존 placeholder 문서(random UUID) 삭제 후 Firebase Auth UID로 재생성
      // (메인 auth는 HR 관리자로 유지되므로 Firestore 권한 정상)
      await createUser(cred.user.uid, {
        email: user.email, name: user.name, role: user.role,
        organizationId: user.organizationId, position: user.position ?? '',
        isHrAdmin: user.isHrAdmin,
        isActive: true,
      });
      if (user.id !== cred.user.uid) await deleteUser(user.id);
      setDirectResult({ name: user.name, email: user.email, password: TEMP_PASSWORD });
      await load();
    } catch (e: any) {
      // 이미 Firebase Auth 에 같은 이메일 계정이 있는 경우: 기존 Auth 계정과 placeholder 연결
      if (e?.code === 'auth/email-already-in-use') {
        try {
          const res = await fetch('/api/admin/link-auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ placeholderId: user.id, email: user.email, resetPassword: true }),
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || '연결 실패');
          setDirectResult({ name: user.name, email: user.email, password: json.password ?? TEMP_PASSWORD });
          toast.success('기존 Firebase 계정과 연결했습니다. 임시 비밀번호로 로그인하세요.');
          await load();
        } catch (le: any) {
          toast.error(`기존 계정 연결 실패: ${le?.message}`);
        }
      } else {
        toast.error(`직접 등록 실패: ${e?.code ?? e?.message}`);
      }
    } finally {
      await deleteApp(secondaryApp);
      setSaving(false);
    }
  }

  async function handleResetPassword(user: User) {
    if (!confirm(`${user.name}님의 비밀번호를 초기화하시겠습니까?\n초기 비밀번호: 1q2w3e4r!`)) return;
    setSaving(true);
    try {
      const res = await fetch('/api/admin/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: user.id }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success(`${user.name}님의 비밀번호가 초기화되었습니다. (1q2w3e4r!)`);
    } catch (e: any) {
      toast.error(`비밀번호 초기화 실패: ${e?.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      // Auth + Firestore 동시 삭제 (좀비 계정 방지)
      const res = await fetch('/api/admin/delete-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: deleteTarget.id, email: deleteTarget.email }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || '삭제 실패');
      }
      toast.success(`${deleteTarget.name}님이 삭제되었습니다.`);
      setDeleteTarget(null);
      await load();
    } catch (e: any) {
      toast.error(`삭제에 실패했습니다: ${e?.message ?? ''}`);
    } finally { setDeleting(false); }
  }

  async function toggleActive(user: User) {
    await updateUser(user.id, { isActive: !user.isActive });
    toast.success(user.isActive ? '비활성화했습니다.' : '활성화했습니다.');
    await load();
  }

  const filtered = users.filter(u => u.name.includes(search) || u.email.includes(search));

  return (
    <div className="flex flex-col h-full">
      <Header title="사용자 관리" />
      <div className="flex-1 overflow-y-auto p-6 space-y-4">

        {orgs.length === 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            조직이 없습니다.{' '}
            <a href="/admin/organizations" className="font-semibold underline">조직 관리</a>에서 먼저 조직을 등록하거나,
            조직 없이 사용자를 초대한 뒤 나중에 소속을 지정할 수 있습니다.
          </div>
        )}

        {/* 툴바 */}
        <div className="flex flex-wrap gap-2 items-center">
          <Input placeholder="이름 또는 이메일 검색" value={search} onChange={e => setSearch(e.target.value)} className="max-w-xs" />
          <div className="flex gap-2 ml-auto">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={downloadTemplate}>
              <Download className="h-4 w-4" /> 양식 다운로드
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-4 w-4" />{uploading ? '업로드 중...' : '엑셀 업로드'}
            </Button>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleUpload} />
            <Button size="sm" className="gap-1.5" onClick={openNew}>
              <Plus className="h-4 w-4" /> 사용자 추가
            </Button>
          </div>
        </div>

        {/* 업로드 결과 */}
        {uploadResult && (
          <div className="rounded-xl border bg-white p-4 space-y-2">
            <p className="text-sm font-medium text-gray-900">
              업로드 결과 — 성공 <span className="text-green-600">{uploadResult.success}건</span>
              {uploadResult.failed.length > 0 && <>, 실패 <span className="text-red-500">{uploadResult.failed.length}건</span></>}
            </p>
            {uploadResult.failed.length > 0 && (
              <ul className="space-y-1">
                {uploadResult.failed.map((f, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-red-600">
                    <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />{f.row}행: {f.reason}
                  </li>
                ))}
              </ul>
            )}
            <button onClick={() => setUploadResult(null)} className="text-xs text-gray-400 hover:text-gray-600">닫기</button>
          </div>
        )}

        {/* 사용자 테이블 */}
        <div className="rounded-xl border bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="px-4 py-3 text-left">이름</th>
                <th className="px-4 py-3 text-left">이메일</th>
                <th className="px-4 py-3 text-left">역할</th>
                <th className="px-4 py-3 text-left">소속</th>
                <th className="px-4 py-3 text-left">직책</th>
                <th className="px-4 py-3 text-left">상태</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                [1, 2, 3].map(i => (
                  <tr key={i}><td colSpan={7} className="px-4 py-3">
                    <div className="h-4 animate-pulse rounded bg-gray-100" />
                  </td></tr>
                ))
              ) : filtered.map(user => (
                <tr key={user.id} className={!user.isActive ? 'opacity-60' : ''}>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    <MemberInfoModal userId={user.id} userName={user.name} />
                  </td>
                  <td className="px-4 py-3 text-gray-500">{user.email}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 flex-wrap">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${ROLE_COLOR[user.role] ?? 'bg-gray-100 text-gray-700'}`}>
                        {ROLES.find(r => r.value === user.role)?.label ?? user.role}
                      </span>
                      {user.isHrAdmin && (
                        <span className="rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-medium text-orange-700">
                          HR관리자
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{orgs.find(o => o.id === user.organizationId)?.name ?? '-'}</td>
                  <td className="px-4 py-3 text-gray-500">{user.position ?? '-'}</td>
                  <td className="px-4 py-3">
                    {user.isActive ? (
                      <span className="text-xs text-green-600">활성</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">
                        <Mail className="h-3 w-3" /> 초대 대기
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => openEdit(user)} className="p-1.5 rounded hover:bg-gray-100" title="수정">
                        <Pencil className="h-3.5 w-3.5 text-gray-400" />
                      </button>
                      {!user.isActive ? (
                        <>
                          <button onClick={() => handleInvite(user)} className="p-1.5 rounded hover:bg-gray-100" title="초대 링크 생성">
                            <Mail className="h-3.5 w-3.5 text-blue-400" />
                          </button>
                          <button onClick={() => handleDirectRegister(user)} className="p-1.5 rounded hover:bg-gray-100" title="직접 등록 (임시 비밀번호)">
                            <UserCheck className="h-3.5 w-3.5 text-green-500" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => handleResetPassword(user)} className="p-1.5 rounded hover:bg-gray-100" title="비밀번호 초기화 (1q2w3e4r!)">
                            <KeyRound className="h-3.5 w-3.5 text-purple-400" />
                          </button>
                          <button onClick={() => toggleActive(user)} className="p-1.5 rounded hover:bg-gray-100" title="비활성화">
                            <UserX className="h-3.5 w-3.5 text-orange-400" />
                          </button>
                        </>
                      )}
                      <button onClick={() => setDeleteTarget(user)} className="p-1.5 rounded hover:bg-gray-100" title="삭제">
                        <Trash2 className="h-3.5 w-3.5 text-red-400" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 직접 등록 완료 다이얼로그 */}
        <Dialog open={!!directResult} onOpenChange={open => !open && setDirectResult(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <UserCheck className="h-5 w-5 text-green-500" /> 직접 등록 완료
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <p className="text-sm text-gray-600">
                <span className="font-semibold">{directResult?.name}</span>님의 계정이 생성되었습니다.
                아래 임시 비밀번호를 당사자에게 전달하고 로그인 후 변경하도록 안내하세요.
              </p>
              <div className="rounded-lg border bg-gray-50 p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">이메일</span>
                  <span className="font-mono font-medium">{directResult?.email}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">임시 비밀번호</span>
                  <span className="font-mono font-bold text-blue-600">{directResult?.password}</span>
                </div>
              </div>
              <Button className="w-full" onClick={() => setDirectResult(null)}>확인</Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* 초대 링크 다이얼로그 */}
        <Dialog open={!!inviteLink} onOpenChange={open => !open && setInviteLink(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5 text-blue-500" /> 초대 링크 생성 완료
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <p className="text-sm text-gray-600">
                <span className="font-semibold">{inviteName}</span>님({inviteEmail})에게 아래 링크를 전달하세요.
                링크는 <span className="font-semibold">7일간</span> 유효합니다.
              </p>
              <div className="flex items-center gap-2 rounded-lg border bg-gray-50 px-3 py-2">
                <p className="flex-1 text-xs text-gray-600 break-all font-mono">{inviteLink}</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 gap-1.5" onClick={copyLink}>
                  {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                  {copied ? '복사됨' : '링크 복사'}
                </Button>
                <Button className="flex-1 gap-1.5" onClick={openMailto}>
                  <Mail className="h-4 w-4" /> 이메일 앱으로 발송
                </Button>
              </div>
              <p className="text-xs text-gray-400 text-center">
                '이메일 앱으로 발송' 클릭 시 기본 메일 앱이 열립니다.
              </p>
            </div>
          </DialogContent>
        </Dialog>

        {/* 삭제 확인 다이얼로그 */}
        <Dialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>사용자 삭제</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-2">
              <p className="text-sm text-gray-600">
                <span className="font-semibold text-gray-900">{deleteTarget?.name}</span>님을 삭제하시겠습니까?
              </p>
              <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">
                삭제된 사용자의 데이터(목표, 1on1 등)는 유지되지만 로그인이 불가능해집니다. 이 작업은 되돌릴 수 없습니다.
              </p>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setDeleteTarget(null)}>취소</Button>
                <Button variant="destructive" className="flex-1" disabled={deleting} onClick={handleDelete}>
                  {deleting ? '삭제 중...' : '삭제'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* 추가/수정 다이얼로그 */}
        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing ? '사용자 수정' : '사용자 추가'}</DialogTitle>
            </DialogHeader>
            <div key={editing?.id ?? 'new'} className="space-y-4 pt-2">
              {!editing && (
                <div className="space-y-1.5">
                  <Label>이메일 *</Label>
                  <Input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="user@insung.co.kr" />
                </div>
              )}
              <div className="space-y-1.5">
                <Label>이름 *</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>직책</Label>
                <Input value={form.position} onChange={e => setForm(f => ({ ...f, position: e.target.value }))} placeholder="예) 선임, 팀장" />
              </div>
              <div className="space-y-1.5">
                <Label>역할 *</Label>
                <Select value={form.role} onValueChange={v => setForm(f => ({ ...f, role: v as UserRole }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROLES.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="isHrAdmin"
                  type="checkbox"
                  checked={form.isHrAdmin}
                  onChange={e => setForm(f => ({ ...f, isHrAdmin: e.target.checked }))}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <Label htmlFor="isHrAdmin" className="cursor-pointer">
                  HR 관리자 권한 부여
                  <span className="ml-1.5 text-xs text-gray-400 font-normal">(역할과 별개로 HR 관리 기능 접근 가능)</span>
                </Label>
              </div>
              <div className="space-y-1.5">
                <Label>소속 <span className="text-gray-400 text-xs font-normal">(나중에 지정 가능)</span></Label>
                <Select value={form.organizationId} onValueChange={v => setForm(f => ({ ...f, organizationId: v || '' }))}>
                  <SelectTrigger><SelectValue placeholder="조직 선택 안함" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">지정 안함</SelectItem>
                    {orgs.map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {!editing && (
                <p className="text-xs text-gray-500 bg-blue-50 rounded-lg px-3 py-2">
                  저장 후 목록에서 <strong>초대(✉)</strong> 버튼을 눌러 초대 링크를 발송하세요.
                </p>
              )}
              <Button onClick={handleSave} disabled={saving} className="w-full">
                {saving ? '저장 중...' : editing ? '수정' : '저장'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

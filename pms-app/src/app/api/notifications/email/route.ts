export const dynamic = 'force-dynamic';

/**
 * 알림 이메일 발송 (Gmail SMTP — 앱 비밀번호).
 *
 * 인증: Authorization: Bearer <Firebase ID Token> — 로그인 사용자만 호출 가능.
 * body: { userId, title, message, link? }
 *   userId: 수신자(사내 사용자) — 이메일 주소는 서버에서 users 컬렉션을 조회해 결정한다.
 *           (임의 외부 주소로 발송하는 오픈릴레이 방지)
 *
 * 발송 실패는 호출자에게 치명적이지 않음 — 인앱 알림이 1차 채널이고 이메일은 보조.
 */

import { NextRequest, NextResponse } from 'next/server';
import { initializeApp, getApps, getApp, cert, ServiceAccount } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import nodemailer from 'nodemailer';

function getAdminApp() {
  if (getApps().length > 0) return getApp();
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY 환경변수가 없습니다.');
  return initializeApp({ credential: cert(JSON.parse(raw) as ServiceAccount) });
}

let _transporter: nodemailer.Transporter | null = null;
function transporter() {
  if (!_transporter) {
    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_APP_PASSWORD;
    if (!user || !pass) throw new Error('GMAIL_USER / GMAIL_APP_PASSWORD 환경변수가 없습니다.');
    _transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
  }
  return _transporter;
}

const APP_URL = 'https://insung-pms-730719313936.asia-northeast3.run.app';

export async function POST(req: NextRequest) {
  try {
    // 1) 호출자 인증 (로그인 사용자만)
    const authHeader = req.headers.get('authorization') ?? '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!idToken) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const app = getAdminApp();
    await getAuth(app).verifyIdToken(idToken);

    // 2) 입력 검증
    const { userId, title, message, link } = await req.json();
    if (!userId || typeof userId !== 'string' || !title || !message) {
      return NextResponse.json({ error: 'bad request' }, { status: 400 });
    }

    // 3) 수신자 이메일 — 서버에서 users 컬렉션 조회 (임의 주소 발송 차단)
    const db = getFirestore(app);
    const userSnap = await db.collection('users').doc(userId).get();
    const email = userSnap.exists ? (userSnap.data()?.email as string | undefined) : undefined;
    if (!email || !email.includes('@')) {
      return NextResponse.json({ sent: false, reason: 'no-email' });
    }

    // 4) 발송
    const url = link ? `${APP_URL}${link.startsWith('/') ? link : `/${link}`}` : APP_URL;
    await transporter().sendMail({
      from: `"INSUNG PMS 알림 (발신전용)" <${process.env.GMAIL_USER}>`,
      to: email,
      replyTo: `"발신전용 — 회신 불가" <${process.env.GMAIL_USER}>`,
      subject: `[INSUNG PMS] ${String(title).slice(0, 120)}`,
      html: [
        '<div style="font-family:Apple SD Gothic Neo,Malgun Gothic,sans-serif;max-width:520px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px">',
        `<h2 style="font-size:16px;color:#111827;margin:0 0 12px">${escapeHtml(String(title))}</h2>`,
        `<p style="font-size:14px;color:#374151;line-height:1.6;white-space:pre-wrap;margin:0 0 20px">${escapeHtml(String(message))}</p>`,
        `<a href="${url}" style="display:inline-block;background:#2563eb;color:#fff;font-size:13px;font-weight:600;padding:10px 18px;border-radius:8px;text-decoration:none">INSUNG PMS에서 확인하기</a>`,
        '<p style="font-size:11px;color:#9ca3af;margin:20px 0 0">본 메일은 INSUNG PMS 시스템에서 자동 발송된 <b>발신전용</b> 메일입니다. 회신은 처리되지 않습니다.</p>',
        '</div>',
      ].join(''),
    });

    return NextResponse.json({ sent: true });
  } catch (e) {
    console.error('[알림메일] 발송 실패:', e);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

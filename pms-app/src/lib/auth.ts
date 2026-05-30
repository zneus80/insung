import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  type User as FirebaseUser,
} from 'firebase/auth';
import { auth } from './firebase';

/** 이메일·비밀번호 로그인 */
export async function signInWithEmail(email: string, password: string) {
  const result = await signInWithEmailAndPassword(auth, email, password);
  return result.user;
}

/** 비밀번호 재설정 메일 발송 (사용자 본인이 분실 시) */
export async function sendPasswordReset(email: string) {
  await sendPasswordResetEmail(auth, email);
}

/** @deprecated 기존 호환용 — signInWithEmail 사용 권장 */
export const signInWithTestAccount = signInWithEmail;

export async function signOut() {
  await firebaseSignOut(auth);
}

export function onAuthChange(callback: (user: FirebaseUser | null) => void) {
  return onAuthStateChanged(auth, callback);
}

export const isEmulator = process.env.NEXT_PUBLIC_USE_EMULATOR === 'true';

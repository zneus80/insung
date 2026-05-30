import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, initializeFirestore } from 'firebase/firestore';
import { getStorage, connectStorageEmulator } from 'firebase/storage';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';

export const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? 'demo-api-key',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? 'demo-pms.firebaseapp.com',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? 'demo-pms',
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? 'demo-pms.appspot.com',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '123456789',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? '1:123456789:web:abcdef',
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// App Check (reCAPTCHA v3) — 브라우저 환경 + site key 가 있을 때만 활성화
// 콘솔: Firebase Console → App Check → Web app → reCAPTCHA v3 site key 등록 후
// 환경변수 NEXT_PUBLIC_RECAPTCHA_SITE_KEY 에 site key 입력
if (
  typeof window !== 'undefined' &&
  process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY &&
  process.env.NEXT_PUBLIC_USE_EMULATOR !== 'true'
) {
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (e) {
    // 이미 초기화된 경우 무시
    if (process.env.NODE_ENV !== 'production') console.warn('AppCheck init skipped:', e);
  }
}

export const auth = getAuth(app);
export const db = initializeFirestore(app, { ignoreUndefinedProperties: true });
export const storage = getStorage(app);

// 에뮬레이터 연결 (NEXT_PUBLIC_USE_EMULATOR=true 일 때)
if (
  typeof window !== 'undefined' &&
  process.env.NEXT_PUBLIC_USE_EMULATOR === 'true' &&
  !(auth as any)._isEmulatorConnected
) {
  const host = process.env.NEXT_PUBLIC_EMULATOR_HOST ?? 'localhost';
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, 8080);
  connectStorageEmulator(storage, host, 9199);
  // 중복 연결 방지 플래그
  (auth as any)._isEmulatorConnected = true;
}

export default app;

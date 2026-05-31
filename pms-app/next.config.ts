import type { NextConfig } from "next";

/**
 * 보안 헤더.
 * - HSTS: HTTPS 강제 (1년)
 * - X-Frame-Options: 클릭재킹 방지 (iframe 임베드 차단)
 * - X-Content-Type-Options: MIME 스니핑 차단
 * - Referrer-Policy: 외부 referrer 누출 최소화
 * - Permissions-Policy: 카메라·마이크·지오위치 등 불필요 권한 차단
 * - CSP: 외부 스크립트/이미지 출처 제한. Firebase·reCAPTCHA(App Check) 허용
 */
const securityHeaders = [
  { key: 'Strict-Transport-Security',  value: 'max-age=31536000; includeSubDomains; preload' },
  { key: 'X-Frame-Options',            value: 'DENY' },
  { key: 'X-Content-Type-Options',     value: 'nosniff' },
  { key: 'Referrer-Policy',            value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy',         value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://apis.google.com https://www.gstatic.com https://www.googletagmanager.com https://www.google.com https://www.recaptcha.net",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https: https://www.gstatic.com https://lh3.googleusercontent.com",
      // App Check (reCAPTCHA Enterprise) 토큰 발급에 필요한 도메인 포함:
      //   - https://www.google.com — reCAPTCHA verification API
      //   - https://www.recaptcha.net — reCAPTCHA 클라이언트
      //   - https://content-firebaseappcheck.googleapis.com — App Check exchange (*.googleapis.com 에 포함되지만 명시)
      "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firebasestorage.googleapis.com https://firebaseinstallations.googleapis.com https://firestore.googleapis.com https://content-firebaseappcheck.googleapis.com wss://*.firebaseio.com https://www.googleapis.com https://www.google.com https://www.recaptcha.net",
      "frame-src 'self' https://insung-pms.firebaseapp.com https://www.google.com https://www.recaptcha.net",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  },
];

const nextConfig: NextConfig = {
  output: 'standalone',
  images: { unoptimized: true },
  async headers() {
    return [
      { source: '/(.*)', headers: securityHeaders },
    ];
  },
};

export default nextConfig;

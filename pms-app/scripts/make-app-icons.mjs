/**
 * 앱 아이콘 · 파비콘 만들기 — 설치형 웹앱(PWA · 2026-11-06).
 *
 *   node scripts/make-app-icons.mjs                    → 전부 다시 만든다(아래 파일 다섯)
 *   node scripts/make-app-icons.mjs --preview <폴더>   → 저장소 밖 폴더에 크기별 PNG 만 찍어 본다(실제 파일 안 건드림)
 *   node scripts/make-app-icons.mjs --svg              → 그림 원본(SVG)만 찍어 본다
 *
 * 만드는 것(그림은 전부 이 파일 하나가 원본):
 *   src/app/favicon.ico           브라우저 탭 · 즐겨찾기(16 · 32 · 48)
 *   src/app/apple-icon.png        아이폰 홈 화면(180 · 꽉 찬 네모 — 모서리는 iOS 가 깎는다)
 *   public/icons/icon-192.png     설치한 앱 아이콘(작업표시줄 · 시작 메뉴 · 바탕화면)
 *   public/icons/icon-512.png     〃 큰 것(설치 창 · 앱 목록)
 *   public/icons/maskable-512.png 안드로이드(꽉 찬 바탕 · 표식은 가운데 안전 원 안)
 * manifest(src/app/manifest.ts)가 public/icons 셋을 가리킨다.
 *
 * 표식 = PMS 로고의 「P」(사이드바 bg-blue-600 + 흰 P 와 동일 컨셉). 글꼴을 쓰지 않고 다각형(+counter 구멍)으로 그린다
 * (PC 마다 글꼴이 달라도 같은 그림). 색 = 로고와 같은 파랑 계열 그라디언트(#1e40af → #2563eb → #3b82f6).
 */
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// 「P」 — 16칸 눈금. 바깥 윤곽(블록형 P) + 가운데 사각 구멍(counter). fill-rule evenodd 로 구멍이 뚫린다.
const P_OUTER = [[3, 4], [11, 4], [11, 8], [5, 8], [5, 12], [3, 12]];
const P_HOLE = [[6, 5.3], [9, 5.3], [9, 6.7], [6, 6.7]];

const GRAD = [
  ["0%", "#1e40af"],
  ["50%", "#2563eb"],
  ["100%", "#3b82f6"],
];

/**
 * 한 장의 SVG.
 * @param size  내보낼 픽셀
 * @param tile  바탕 판이 차지하는 비율(1 = 꽉 참 · 0.875 = 둘레 여백)
 * @param radius 판 모서리(판 한 변에 대한 비율 · 0 = 네모)
 * @param markScale 표식 크기(1 = 16칸 눈금 그대로 판에 맞춤 · 작을수록 여백)
 */
export function svgOf({ size, tile = 1, radius = 0.22, markScale = 1 }) {
  const side = size * tile;
  const off = (size - side) / 2;
  const unit = (side / 16) * markScale; // 눈금 한 칸
  const markOff = off + (side - unit * 16) / 2; // 표식 눈금을 판 가운데로
  const pt = ([x, y]) => `${+(markOff + x * unit).toFixed(3)},${+(markOff + y * unit).toFixed(3)}`;
  const ring = (pts) => `M${pts.map(pt).join(" L")} Z`;
  const stops = GRAD.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join("");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">${stops}</linearGradient></defs>`,
    `<rect x="${off}" y="${off}" width="${side}" height="${side}" rx="${side * radius}" fill="url(#g)"/>`,
    `<path d="${ring(P_OUTER)} ${ring(P_HOLE)}" fill="#ffffff" fill-rule="evenodd"/>`,
    `</svg>`,
  ].join("");
}

const png = (svg) => sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();

/** PNG 여러 장을 ICO 한 파일로. */
function ico(images) {
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(({ size, data }, i) => {
    const at = 6 + 16 * i;
    head.writeUInt8(size >= 256 ? 0 : size, at);
    head.writeUInt8(size >= 256 ? 0 : size, at + 1);
    head.writeUInt8(0, at + 2);
    head.writeUInt8(0, at + 3);
    head.writeUInt16LE(1, at + 4);
    head.writeUInt16LE(32, at + 6);
    head.writeUInt32LE(data.length, at + 8);
    head.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...images.map((x) => x.data)]);
}

const FAV = { tile: 1, radius: 0.19, markScale: 1 };
const APP = { tile: 0.875, radius: 0.23, markScale: 0.92 };
const FULL = { tile: 1, radius: 0, markScale: 0.86 };
const MASK = { tile: 1, radius: 0, markScale: 0.8 };

const FILES = [
  ["src/app/apple-icon.png", { size: 180, ...FULL }],
  ["public/icons/icon-192.png", { size: 192, ...APP }],
  ["public/icons/icon-512.png", { size: 512, ...APP }],
  ["public/icons/maskable-512.png", { size: 512, ...MASK }],
];
const FAV_SIZES = [16, 32, 48];

const args = process.argv.slice(2);
const previewAt = args.indexOf("--preview");

if (args.includes("--svg")) {
  console.log(svgOf({ size: 512, ...APP }));
} else if (previewAt >= 0) {
  const dir = args[previewAt + 1];
  if (!dir) throw new Error("--preview <폴더>");
  mkdirSync(dir, { recursive: true });
  for (const size of FAV_SIZES) writeFileSync(join(dir, `fav-${size}.png`), await png(svgOf({ size, ...FAV })));
  for (const [rel, opt] of FILES) writeFileSync(join(dir, rel.split("/").pop()), await png(svgOf(opt)));
  console.log(`미리 보기 → ${dir}`);
} else {
  const save = (rel, buf) => {
    const abs = join(ROOT, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, buf);
    console.log(`  ${rel}  ${buf.length.toLocaleString()} B`);
  };
  const fav = await Promise.all(FAV_SIZES.map(async (size) => ({ size, data: await png(svgOf({ size, ...FAV })) })));
  save("src/app/favicon.ico", ico(fav));
  for (const [rel, opt] of FILES) save(rel, await png(svgOf(opt)));
}

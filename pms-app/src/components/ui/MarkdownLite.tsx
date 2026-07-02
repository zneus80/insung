'use client';

import React from 'react';

/**
 * 의존성 없는 경량 Markdown 렌더러.
 * AI 챗봇 답변(Gemini)이 내보내는 표 · 굵게 · 목록 · 제목을 보기 좋게 렌더링한다.
 * 지원: GFM 표 / # 제목 / - · * 목록 / 1. 번호목록 / **굵게** / `코드` / 단락.
 */

// 인라인: **굵게**, `코드` 처리
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // **bold** · `code` · <br> 를 토큰화 (AI가 HTML 줄바꿈을 섞어 내보내는 경우 대응)
  const regex = /(\*\*[^*]+\*\*|`[^`]+`|<br\s*\/?>)/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) {
      nodes.push(<strong key={`${keyPrefix}-b${i}`} className="font-semibold text-gray-900">{tok.slice(2, -2)}</strong>);
    } else if (/^<br/i.test(tok)) {
      nodes.push(<br key={`${keyPrefix}-br${i}`} />);
    } else {
      nodes.push(<code key={`${keyPrefix}-c${i}`} className="rounded bg-gray-100 px-1 py-0.5 text-[0.85em] text-violet-700">{tok.slice(1, -1)}</code>);
    }
    last = m.index + tok.length;
    i++;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function isTableRow(line: string): boolean {
  return line.trim().startsWith('|') && line.includes('|');
}
function isTableSeparator(line: string): boolean {
  return /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes('-');
}
function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map(c => c.trim());
}

// 불릿 마커: - * • (AI가 가운뎃점 불릿을 자주 사용)
const BULLET_RE = /^\s*[-*•]\s+/;

export default function MarkdownLite({ content }: { content: string }) {
  // 전처리: 한 줄에 "•" 항목이 여러 개 이어붙은 경우 개별 불릿 줄로 분리(가독성).
  const rawLines = content.replace(/\r\n/g, '\n').split('\n');
  const lines: string[] = [];
  for (const ln of rawLines) {
    const t = ln.trim();
    const bulletCount = (t.match(/•/g) ?? []).length;
    if (bulletCount >= 2 && !/^[-*]/.test(t)) {
      const segs = t.split('•').map(s => s.trim()).filter(Boolean);
      // 첫 조각이 "라벨:" 형태면 문단으로, 나머지는 불릿
      if (segs.length && /[:：]$/.test(segs[0])) {
        lines.push(segs[0]);
        segs.slice(1).forEach(s => lines.push('- ' + s));
      } else {
        segs.forEach(s => lines.push('- ' + s));
      }
    } else {
      lines.push(ln);
    }
  }
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 빈 줄
    if (line.trim() === '') { i++; continue; }

    // 표
    if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const header = splitRow(line);
      const rows: string[][] = [];
      i += 2; // header + separator
      while (i < lines.length && isTableRow(lines[i])) { rows.push(splitRow(lines[i])); i++; }
      blocks.push(
        <div key={`tbl${key++}`} className="my-2 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-gray-50">
                {header.map((h, hi) => (
                  <th key={hi} className="border border-gray-200 px-3 py-1.5 text-left font-semibold text-gray-700 whitespace-nowrap">
                    {renderInline(h, `th${key}-${hi}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="even:bg-gray-50/50">
                  {header.map((_, ci) => (
                    <td key={ci} className="border border-gray-200 px-3 py-1.5 align-top text-gray-700">
                      {renderInline(r[ci] ?? '', `td${key}-${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // 제목 (#, ##, ###)
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const cls = level <= 1 ? 'text-base font-bold text-gray-900 mt-3 mb-1'
        : level === 2 ? 'text-sm font-bold text-gray-900 mt-3 mb-1'
        : 'text-sm font-semibold text-gray-800 mt-2 mb-0.5';
      blocks.push(<p key={`h${key++}`} className={cls}>{renderInline(h[2], `h${key}`)}</p>);
      i++;
      continue;
    }

    // 번호 목록
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, '')); i++;
      }
      blocks.push(
        <ol key={`ol${key++}`} className="my-2 ml-5 list-decimal space-y-1">
          {items.map((it, ii) => <li key={ii} className="text-gray-700 leading-relaxed pl-0.5">{renderInline(it, `ol${key}-${ii}`)}</li>)}
        </ol>
      );
      continue;
    }

    // 불릿 목록 (- * •) — 들여쓴 항목(공백 2칸 이상)은 직전 최상위 항목의 하위 목록으로 중첩 렌더링
    if (BULLET_RE.test(line)) {
      const items: { text: string; subs: string[] }[] = [];
      while (i < lines.length && BULLET_RE.test(lines[i])) {
        const raw = lines[i];
        const indent = (raw.match(/^\s*/)?.[0].length) ?? 0;
        const text = raw.replace(BULLET_RE, '');
        if (indent >= 2 && items.length > 0) items[items.length - 1].subs.push(text);
        else items.push({ text, subs: [] });
        i++;
      }
      blocks.push(
        <ul key={`ul${key++}`} className="my-2 ml-5 list-disc space-y-1">
          {items.map((it, ii) => (
            <li key={ii} className="text-gray-700 leading-relaxed pl-0.5">
              {renderInline(it.text, `ul${key}-${ii}`)}
              {it.subs.length > 0 && (
                <ul className="mt-1 ml-4 list-[circle] space-y-1">
                  {it.subs.map((s, si) => (
                    <li key={si} className="text-gray-600 leading-relaxed pl-0.5">{renderInline(s, `ul${key}-${ii}-${si}`)}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // 일반 단락 — 연속된 일반 줄을 묶되 줄바꿈 유지
    const para: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== ''
      && !isTableRow(lines[i]) && !/^(#{1,6})\s+/.test(lines[i])
      && !/^\s*\d+\.\s+/.test(lines[i]) && !BULLET_RE.test(lines[i])) {
      para.push(lines[i]); i++;
    }
    blocks.push(
      <p key={`p${key++}`} className="leading-relaxed text-gray-800">
        {para.map((pl, pi) => (
          <React.Fragment key={pi}>
            {pi > 0 && <br />}
            {renderInline(pl, `p${key}-${pi}`)}
          </React.Fragment>
        ))}
      </p>
    );
  }

  return <div className="space-y-2.5">{blocks}</div>;
}

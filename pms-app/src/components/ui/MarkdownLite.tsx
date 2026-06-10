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
  // **bold** 와 `code` 를 토큰화
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) {
      nodes.push(<strong key={`${keyPrefix}-b${i}`} className="font-semibold text-gray-900">{tok.slice(2, -2)}</strong>);
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

export default function MarkdownLite({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
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
        <ol key={`ol${key++}`} className="my-1 ml-5 list-decimal space-y-0.5">
          {items.map((it, ii) => <li key={ii} className="text-gray-700">{renderInline(it, `ol${key}-${ii}`)}</li>)}
        </ol>
      );
      continue;
    }

    // 불릿 목록
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, '')); i++;
      }
      blocks.push(
        <ul key={`ul${key++}`} className="my-1 ml-5 list-disc space-y-0.5">
          {items.map((it, ii) => <li key={ii} className="text-gray-700">{renderInline(it, `ul${key}-${ii}`)}</li>)}
        </ul>
      );
      continue;
    }

    // 일반 단락 — 연속된 일반 줄을 묶되 줄바꿈 유지
    const para: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== ''
      && !isTableRow(lines[i]) && !/^(#{1,6})\s+/.test(lines[i])
      && !/^\s*\d+\.\s+/.test(lines[i]) && !/^\s*[-*]\s+/.test(lines[i])) {
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

  return <div className="space-y-1.5">{blocks}</div>;
}

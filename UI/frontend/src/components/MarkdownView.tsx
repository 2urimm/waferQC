import type { ReactNode } from 'react';

/**
 * 점검 보고서 마크다운 뷰어.
 *
 * 범용 마크다운 파서가 아니라 services/report.ts 가 실제로 내는 것만 그린다 —
 * 제목(#~####), 표(정렬 포함), 글머리 목록, `- [ ]` 체크 항목, 인용(>), 구분선(---),
 * 그리고 인라인 **굵게** · *기울임* · `코드`. 링크·이미지·코드블록·중첩목록은 쓰지 않는다.
 *
 * 문자열을 HTML로 밀어 넣지 않고 React 엘리먼트로 짓는다. 보고서 본문에는 대응 Log에서
 * 온 텍스트가 그대로 실리므로, 거기 든 꺾쇠가 마크업으로 해석되면 안 된다.
 */

const INLINE = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`)/g;

function inline(text: string, keyBase: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    const key = `${keyBase}-${i}`;
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={key}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) return <code className="mono" key={key}>{part.slice(1, -1)}</code>;
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2)
      return <em key={key}>{part.slice(1, -1)}</em>;
    return part;
  });
}

const isSeparator = (line: string) => /^\|(\s*:?-{3,}:?\s*\|)+\s*$/.test(line);
const cells = (line: string) =>
  line
    .replace(/^\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((c) => c.trim());

function blocks(lines: string[], keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const key = `${keyBase}-${i}`;

    if (!line.trim()) {
      i += 1;
      continue;
    }

    /* 구분선 */
    if (/^---+$/.test(line.trim())) {
      out.push(<hr className="md-hr" key={key} />);
      i += 1;
      continue;
    }

    /* 제목 */
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const Tag = (['h2', 'h3', 'h4', 'h5'] as const)[level - 1];
      out.push(
        <Tag className={`md-h md-h${level}`} key={key}>
          {inline(h[2], key)}
        </Tag>,
      );
      i += 1;
      continue;
    }

    /* 인용 — 안쪽을 다시 같은 규칙으로 그린다 */
    if (line.startsWith('>')) {
      const inner: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) {
        inner.push(lines[i].replace(/^>\s?/, ''));
        i += 1;
      }
      out.push(
        <blockquote className="md-quote" key={key}>
          {blocks(inner, key)}
        </blockquote>,
      );
      continue;
    }

    /* 표 */
    if (line.startsWith('|') && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      const head = cells(line);
      const align = cells(lines[i + 1]).map((c) => (c.endsWith(':') ? ('right' as const) : ('left' as const)));
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        rows.push(cells(lines[i]));
        i += 1;
      }
      out.push(
        <div className="table-wrap" key={key}>
          <table className="data md-table">
            <thead>
              <tr>
                {head.map((c, c_i) => (
                  <th key={c_i} style={{ textAlign: align[c_i] ?? 'left' }}>
                    {inline(c, `${key}-h${c_i}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, r_i) => (
                <tr key={r_i}>
                  {r.map((c, c_i) => (
                    <td key={c_i} style={{ textAlign: align[c_i] ?? 'left' }}>
                      {inline(c, `${key}-${r_i}-${c_i}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    /* 목록 — `- [ ]` 는 체크 항목으로 그린다 (보고서는 읽기 전용이라 잠가 둔다) */
    if (/^-\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^-\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^-\s+/, ''));
        i += 1;
      }
      const checkList = items.every((t) => t.startsWith('[ ]') || t.startsWith('[x]'));
      out.push(
        <ul className={`md-list${checkList ? ' md-checks' : ''}`} key={key}>
          {items.map((t, t_i) => {
            const done = t.startsWith('[x]');
            const body = checkList ? t.slice(3).trim() : t;
            return (
              <li key={t_i}>
                {checkList && <input type="checkbox" checked={done} disabled readOnly />}
                <span>{inline(body, `${key}-${t_i}`)}</span>
              </li>
            );
          })}
        </ul>,
      );
      continue;
    }

    /* 본문 */
    out.push(
      <p className="md-p" key={key}>
        {inline(line, key)}
      </p>,
    );
    i += 1;
  }

  return out;
}

export function MarkdownView({ markdown }: { markdown: string }) {
  return <div className="md-view">{blocks(markdown.split('\n'), 'md')}</div>;
}

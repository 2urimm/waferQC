import { useEffect, useMemo, useState } from 'react';
import type { DiagnosisPlan } from '../domain/plan';
import type { Inspection } from '../domain/types';
import { generateReport } from '../services/report';
import { ReportPngButton } from './ReportPngButton';
import { FAMILIES } from '../config/taxonomy';
import { Badge, Card } from './ui';

/**
 * 점검 보고서.
 *
 * 판정·근거·한계와 엑셀 개선안에서 온 공정별 점검 순서를 한 장으로 묶는다.
 * 마크다운(복사·.md)과 PNG 두 형태로 낼 수 있다.
 */
export function ReportPanel({ inspection, plan }: { inspection: Inspection; plan: DiagnosisPlan }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pngUrl, setPngUrl] = useState<string | null>(null);

  const report = useMemo(() => generateReport({ inspection, plan }), [inspection, plan]);

  // 판정이 바뀌면 이전 미리보기는 더 이상 맞지 않는다
  useEffect(() => {
    setPngUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, [inspection.id]);

  useEffect(() => () => { if (pngUrl) URL.revokeObjectURL(pngUrl); }, [pngUrl]);

  const download = () => {
    const blob = new Blob([report.markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${report.title}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copy = () => {
    navigator.clipboard?.writeText(report.markdown).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  return (
    <Card
      title="점검 보고서"
      sub={`${inspection.lotId} · 웨이퍼 ${inspection.waferNo} · ${new Date(inspection.capturedAt).toLocaleString(
        'ko-KR',
        { dateStyle: 'medium', timeStyle: 'short' },
      )}`}
      actions={
        <>
          <button className="btn btn-sm" onClick={() => setOpen((v) => !v)}>
            {open ? '접기' : '미리보기'}
          </button>
          <button className="btn btn-sm" onClick={copy}>
            {copied ? '복사됨' : '복사'}
          </button>
          <button className="btn btn-sm" onClick={download}>
            .md 저장
          </button>
          <ReportPngButton
            inspection={inspection}
            plan={plan}
            onRendered={(url) =>
              setPngUrl((prev) => {
                if (prev) URL.revokeObjectURL(prev);
                return url;
              })
            }
          />
        </>
      }
    >
      <div className="row" style={{ gap: 8, marginBottom: 10 }}>
        <Badge color={inspection.verdict.family === 'NORMAL' ? '--good' : '--serious'} strong>
          {FAMILIES[inspection.verdict.family].short}
        </Badge>
        {inspection.caseId && <Badge>대응 Log {inspection.caseId}</Badge>}
        <Badge>{report.markdown.split('\n').length}줄</Badge>
        <Badge>공정 {plan.tabs.length}개</Badge>
      </div>

      {pngUrl && (
        <div style={{ marginTop: 12 }}>
          <div className="card-sub" style={{ marginBottom: 6 }}>
            저장한 PNG — 한 장으로 읽히게 만든 버전이라 마크다운보다 항목이 간추려져 있다 (공정 상위 3개).
          </div>
          <img
            src={pngUrl}
            alt="점검 보고서 이미지"
            style={{
              width: '100%',
              maxWidth: 620,
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              display: 'block',
            }}
          />
        </div>
      )}

      {open && (
        <pre className="protocol" style={{ marginTop: 12, maxHeight: 460, overflowY: 'auto', whiteSpace: 'pre-wrap' }}>
          {report.markdown}
        </pre>
      )}
    </Card>
  );
}

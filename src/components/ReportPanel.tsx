import { useMemo, useState } from 'react';
import type { DiagnosisPlan } from '../domain/plan';
import type { Inspection } from '../domain/types';
import { generateReport } from '../services/report';
import { CLASSIFICATION_META, type User } from '../services/security';
import { Badge, Card } from './ui';

/**
 * 점검 보고서.
 *
 * 화면과 같은 마스킹 규칙을 그대로 태운다 — 화면에서 가려진 게 보고서에서 풀리면
 * 마스킹이 의미가 없다. 반출(복사·다운로드)은 감사 로그에 남긴다.
 */
export function ReportPanel({
  inspection,
  plan,
  user,
  onAudit,
}: {
  inspection: Inspection;
  plan: DiagnosisPlan;
  user: User;
  onAudit: (action: 'copy-report' | 'export-report', target: string, classification: 'internal' | 'confidential' | 'restricted') => void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const report = useMemo(
    () => generateReport({ inspection, plan, user }),
    [inspection, plan, user],
  );

  const cls = CLASSIFICATION_META[report.classification];

  const download = () => {
    const blob = new Blob([report.markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${report.title}.md`;
    a.click();
    URL.revokeObjectURL(url);
    onAudit('export-report', report.title, report.classification);
  };

  const copy = () => {
    navigator.clipboard?.writeText(report.markdown).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      onAudit('copy-report', report.title, report.classification);
    });
  };

  return (
    <Card
      title="점검 보고서"
      sub="판정 · 근거 · 한계 · 공정별 점검 순서를 그대로 실행 가능한 형태로"
      actions={
        <>
          <button className="btn btn-sm" onClick={() => setOpen((v) => !v)}>
            {open ? '접기' : '미리보기'}
          </button>
          <button className="btn btn-sm" onClick={copy}>
            {copied ? '복사됨' : '복사'}
          </button>
          <button className="btn btn-sm btn-primary" onClick={download}>
            .md 저장
          </button>
        </>
      }
    >
      <div className="row" style={{ gap: 8, marginBottom: 10 }}>
        <Badge
          color={report.classification === 'restricted' ? '--critical' : report.classification === 'confidential' ? '--warning' : undefined}
          strong
        >
          {cls.label}
        </Badge>
        <Badge>{report.markdown.split('\n').length}줄</Badge>
        {report.maskedCount > 0 && <Badge color="--serious">권한 제한 {report.maskedCount}건 제외</Badge>}
      </div>

      <div className={`banner ${report.classification === 'internal' ? 'info' : 'warn'}`}>
        <span className="caveat-icon" aria-hidden>{report.classification === 'internal' ? 'i' : '!'}</span>
        <div>
          {cls.note} 사외 반출 금지이며, 복사·저장은 감사 로그에 기록됩니다.
          {report.maskedCount > 0 && (
            <div style={{ marginTop: 3, color: 'var(--text-muted)' }}>
              현재 권한에서 열람할 수 없는 {report.maskedCount}개 항목은 보고서에서도 제외되었습니다. 해당 공정 담당자가 다시
              생성해야 전체 내용이 실립니다.
            </div>
          )}
        </div>
      </div>

      {open && (
        <pre className="protocol" style={{ marginTop: 12, maxHeight: 460, overflowY: 'auto', whiteSpace: 'pre-wrap' }}>
          {report.markdown}
        </pre>
      )}
    </Card>
  );
}

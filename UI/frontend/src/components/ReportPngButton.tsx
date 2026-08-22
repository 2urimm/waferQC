import { useState } from 'react';
import type { DiagnosisPlan } from '../domain/plan';
import type { Inspection } from '../domain/types';
import { renderReportPng } from '../services/reportImage';

/**
 * 점검 보고서를 PNG 한 장으로 뽑는 버튼.
 *
 * 검사 탭(판정 직후 바로 뽑기)과 보고서 탭(제대로 보고 뽑기) 양쪽에서 쓴다.
 * 같은 산출물을 두 곳에서 만드니 렌더링 경로도 한 곳에 둔다.
 */
export function ReportPngButton({
  inspection,
  plan,
  onRendered,
  label = 'PNG 저장',
}: {
  inspection: Inspection;
  plan: DiagnosisPlan;
  /** 만든 이미지를 미리보기로 걸어 두고 싶을 때 */
  onRendered?: (url: string) => void;
  label?: string;
}) {
  const [rendering, setRendering] = useState(false);

  const save = async () => {
    setRendering(true);
    try {
      const img = await renderReportPng({ inspection, plan });
      const url = URL.createObjectURL(img.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${img.title}.png`;
      a.click();
      if (onRendered) onRendered(url);
      else URL.revokeObjectURL(url);
    } finally {
      setRendering(false);
    }
  };

  return (
    <button className="btn btn-sm btn-primary" onClick={save} disabled={rendering}>
      {rendering ? '만드는 중…' : label}
    </button>
  );
}

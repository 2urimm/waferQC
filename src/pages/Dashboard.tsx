import { useMemo } from 'react';
import { FAMILIES, FAMILY_ORDER } from '../config/taxonomy';
import { CAUSE_MATRIX, PATTERN_LABEL, PATTERN_ORDER, entriesNeedingReview, patternsWithoutCauses } from '../domain/causes';
import { ColumnChart, LineChart } from '../components/charts';
import { WaferGrid } from '../components/WaferGrid';
import { Badge, Card, Empty, Stat } from '../components/ui';
import { useApp } from '../state/AppStore';

const DAY = 86_400_000;

export function Dashboard() {
  const { state, setTab, patch } = useApp();
  const { history } = state;

  const stats = useMemo(() => {
    const now = Date.now();
    const days: Array<{ label: string; total: number; normal: number }> = [];
    for (let d = 13; d >= 0; d--) {
      const start = new Date(now - d * DAY);
      start.setHours(0, 0, 0, 0);
      const end = start.getTime() + DAY;
      const inDay = history.filter((h) => h.capturedAt >= start.getTime() && h.capturedAt < end);
      days.push({
        label: `${start.getMonth() + 1}/${start.getDate()}`,
        total: inDay.length,
        normal: inDay.filter((h) => h.verdict.family === 'NORMAL').length,
      });
    }

    const familyCount = Object.fromEntries(FAMILY_ORDER.map((f) => [f, 0])) as Record<string, number>;
    for (const h of history) familyCount[h.verdict.family] = (familyCount[h.verdict.family] ?? 0) + 1;

    const abnormal = history.filter((h) => h.verdict.family !== 'NORMAL');
    const passRate = history.length ? (history.length - abnormal.length) / history.length : 0;

    return { days: days.filter((d) => d.total > 0), familyCount, abnormal, passRate };
  }, [history]);

  const trend = stats.days.map((d, i) => ({
    label: d.label,
    x: i,
    y: d.total ? (d.normal / d.total) * 100 : 0,
    detail: `정상 ${d.normal} / 전체 ${d.total}건`,
  }));

  const unmapped = patternsWithoutCauses();
  const needsReview = entriesNeedingReview();

  if (!history.length) {
    return (
      <Card title="대시보드">
        <Empty>검사 이력이 없습니다.</Empty>
      </Card>
    );
  }

  return (
    <div className="stack">
      <div className="grid-3">
        <Card title="스크리닝 통과율" sub="최근 14일 · 정상 판정 비율">
          <Stat
            label="정상 판정"
            value={`${(stats.passRate * 100).toFixed(1)}%`}
            note={`전체 ${history.length}건 중 이상 ${stats.abnormal.length}건`}
            hero
          />
          <p className="section-note" style={{ marginTop: 10, color: 'var(--text-muted)' }}>
            실제 수율이 아니라 이 저해상도 검사의 통과율이다. 여기서 정상이어도 수율이 떨어질 수 있고, 그 경우는
            해상도 사각지대나 파라메트릭 손실 쪽을 봐야 한다.
          </p>
        </Card>

        <Card title="계통 분포" sub="최근 14일 판정">
          <ColumnChart
            bars={FAMILY_ORDER.map((f) => ({
              label: FAMILIES[f].short,
              value: stats.familyCount[f] ?? 0,
              emphasis: f !== 'NORMAL',
            }))}
            height={150}
            format={(v) => `${Math.round(v)}`}
            ariaLabel="계통별 판정 건수"
            tableHead={['계통', '건수']}
          />
        </Card>

        <Card title="지식베이스 상태" sub="원인 매트릭스 채움 정도">
          <dl className="kv">
            <dt>등재된 원인</dt>
            <dd>{CAUSE_MATRIX.length}건</dd>
            <dt>커버된 패턴</dt>
            <dd>
              {PATTERN_ORDER.length - 1 - unmapped.length} / {PATTERN_ORDER.length - 1}
            </dd>
            <dt>개선안 초안</dt>
            <dd>{CAUSE_MATRIX.filter((c) => c.actionable.draft).length}건</dd>
            <dt>확인 필요</dt>
            <dd>{needsReview.length}건</dd>
          </dl>

          {unmapped.length > 0 && (
            <>
              <div className="divider" style={{ margin: '10px 0' }} />
              <div className="card-sub" style={{ marginBottom: 5 }}>원인 매핑이 비어 있는 패턴</div>
              <div className="row" style={{ gap: 5 }}>
                {unmapped.map((p) => (
                  <Badge key={p} color="--serious">
                    {PATTERN_LABEL[p]} ({p})
                  </Badge>
                ))}
              </div>
              <p className="section-note" style={{ marginTop: 7, color: 'var(--text-muted)' }}>
                이 패턴으로 판정되면 UI가 어느 공정도 제시하지 못한다. 원인 표를 채워야 하는 지점이다.
              </p>
            </>
          )}
        </Card>
      </div>

      <Card title="일별 스크리닝 통과율" sub="정상 판정 비율 (%) — 실제 수율이 아니다">
        {trend.length > 1 ? (
          <LineChart
            points={trend}
            height={200}
            yFormat={(v) => `${v.toFixed(0)}%`}
            ariaLabel="일별 정상 판정 비율"
            tableHead={['날짜', '통과율']}
          />
        ) : (
          <Empty>추이를 그리려면 최소 2일 이상의 이력이 필요합니다.</Empty>
        )}
      </Card>

      <Card
        title="최근 이상 판정"
        sub="클릭하면 이력 탭에서 상세를 볼 수 있다"
        actions={
          <button className="btn btn-sm" onClick={() => setTab('history')}>
            전체 이력
          </button>
        }
      >
        {stats.abnormal.length === 0 ? (
          <Empty>최근 14일 이상 판정이 없습니다.</Empty>
        ) : (
          <div className="grid-3">
            {stats.abnormal.slice(0, 6).map((h) => {
              const top = h.verdict.patterns[0];
              const open = () => {
                patch({ selectedInspectionId: h.id });
                setTab('history');
              };
              return (
                // 카드 안에 웨이퍼 그리드(버튼 64개)가 들어가므로 카드 자체를 button으로 쓸 수 없다.
                // 버튼 중첩은 유효하지 않은 HTML이라, role/tabIndex/키 핸들러로 같은 동작을 만든다.
                <div
                  key={h.id}
                  className="card"
                  role="button"
                  tabIndex={0}
                  aria-label={`${h.lotId} 웨이퍼 ${h.waferNo} 상세 보기`}
                  style={{ textAlign: 'left', cursor: 'pointer', background: 'var(--surface-raised)' }}
                  onClick={open}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      open();
                    }
                  }}
                >
                  <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
                    <div style={{ width: 88, flex: '0 0 auto' }}>
                      <WaferGrid map={h.map} size={88} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13.5 }}>{FAMILIES[h.verdict.family].label}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                        {h.lotId} · #{h.waferNo}
                      </div>
                      {top && (
                        <div style={{ fontSize: 12, marginTop: 4 }}>
                          {PATTERN_LABEL[top.id]} {(top.probability * 100).toFixed(0)}%
                        </div>
                      )}
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                        {new Date(h.capturedAt).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

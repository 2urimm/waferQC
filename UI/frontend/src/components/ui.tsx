import type { ReactNode } from 'react';

export function Card({
  title,
  sub,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card${className ? ` ${className}` : ''}`}>
      {(title || actions) && (
        <header className="card-head">
          <div>
            {title && <h2 className="card-title">{title}</h2>}
            {sub && <div className="card-sub">{sub}</div>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Badge({
  children,
  color,
  strong,
  title,
}: {
  children: ReactNode;
  /** CSS 변수명. 상태색은 항상 라벨과 같이 쓴다 — 색 단독으로 의미를 나르지 않는다. */
  color?: string;
  strong?: boolean;
  title?: string;
}) {
  return (
    <span className={`badge${strong ? ' badge-strong' : ''}`} title={title}>
      {color && <span className="badge-dot" style={{ background: `var(${color})` }} aria-hidden />}
      {children}
    </span>
  );
}

export function Stat({
  label,
  value,
  note,
  hero,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  hero?: boolean;
}) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className={hero ? 'stat-hero' : 'stat-value'}>{value}</span>
      {note && <span className="stat-note">{note}</span>}
    </div>
  );
}

export function Banner({
  kind = 'info',
  icon,
  children,
}: {
  kind?: 'info' | 'warn' | 'critical';
  icon?: string;
  children: ReactNode;
}) {
  const defaultIcon = kind === 'critical' ? '!' : kind === 'warn' ? '!' : 'i';
  return (
    <div className={`banner ${kind}`} role={kind === 'info' ? undefined : 'alert'}>
      <span className="caveat-icon" aria-hidden>
        {icon ?? defaultIcon}
      </span>
      <div>{children}</div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

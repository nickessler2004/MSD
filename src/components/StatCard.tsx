import type { LucideIcon } from "lucide-react";

export function Stat({
  icon: Icon,
  label,
  value,
  suffix,
  detail,
  badge,
  tone = "",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  suffix?: string;
  detail: string;
  badge?: string;
  tone?: string;
}) {
  return (
    <article className="stat-card">
      <div className="stat-top">
        <span>{label}</span>
        <Icon size={17} />
      </div>
      <div className={`stat-value ${tone}`}>
        {value}
        <span>{suffix}</span>
        {badge && <span className="stat-badge">{badge}</span>}
      </div>
      <div className="stat-detail">{detail}</div>
    </article>
  );
}

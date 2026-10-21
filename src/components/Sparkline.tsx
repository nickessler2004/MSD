export function Sparkline({
  values,
  axis,
}: {
  values: number[];
  axis: string;
}) {
  const padded = [...Array(Math.max(0, 48 - values.length)).fill(0), ...values];
  const points = padded
    .map(
      (n, i) =>
        `${(i / 47) * 280},${35 - (Math.max(-2.8, Math.min(2.8, n)) / 2.8) * 30}`,
    )
    .join(" ");
  return (
    <svg
      className={`sparkline sparkline-${axis}`}
      viewBox="0 0 280 70"
      preserveAspectRatio="none"
      role="img"
      aria-label={`${axis} axis acceleration over the last 24 seconds`}
    >
      <path
        d="M0 35H280"
        stroke="currentColor"
        opacity=".13"
        strokeDasharray="3 4"
      />
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

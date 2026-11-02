export function ViewButtons<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
}) {
  return (
    <nav className="ws-views" aria-label={label}>
      {options.map(([id, text]) => (
        <button
          key={id}
          aria-current={id === value ? "page" : undefined}
          onClick={() => onChange(id)}
        >
          {text}
        </button>
      ))}
    </nav>
  );
}

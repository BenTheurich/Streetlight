'use client';

export const packetToolViews = [
  { value: 'generate', label: 'Generate' },
  { value: 'reconcile', label: 'Reconcile' },
];

export const setupToolViews = [
  { value: 'territory', label: 'Territory' },
  { value: 'printouts', label: 'Printouts' },
];

export function ToolViewSwitcher({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ label: string; value: string }>;
  value: string;
}) {
  return (
    <nav aria-label={label} className="tool-view-switcher">
      {options.map((option) => (
        <button
          aria-pressed={option.value === value}
          className={option.value === value ? 'active' : ''}
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </nav>
  );
}

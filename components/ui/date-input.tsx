'use client'

/**
 * DateInput — always type="date" so iOS shows the native date wheel, not keyboard.
 * Starts with an empty value (no auto-fill). autoComplete="off" prevents
 * the browser from remembering and re-filling previously entered dates.
 */
export function DateInput({
  name,
  value,
  onChange,
  className,
  label,
}: {
  name: string
  value: string
  onChange: (val: string) => void
  className: string
  label?: string
}) {
  return (
    <input
      type="date"
      name={name}
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      className={className}
      autoComplete="off"
      style={{ cursor: 'pointer' }}
    />
  )
}

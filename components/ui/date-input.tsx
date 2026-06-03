'use client'

import { useState } from 'react'

/**
 * DateInput — starts as a plain text field showing "Tap to select date".
 * On tap/click/focus it switches to type="date" so the native date picker opens.
 * If cleared or blurred with no value it reverts to text — guaranteeing
 * the browser never auto-inserts today's date.
 *
 * iOS Safari fixes applied:
 * - Removed readOnly (blocks touch/tap events on iPhone)
 * - Removed showPicker() (not supported on iOS Safari)
 * - Added onClick alongside onFocus so tapping works on mobile
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
  const [isDate, setIsDate] = useState(!!value)

  function handleActivate() {
    setIsDate(true)
  }

  function handleBlur() {
    if (!value) setIsDate(false)
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    onChange(e.target.value)
    if (!e.target.value) setIsDate(false)
  }

  return (
    <input
      type={isDate ? 'date' : 'text'}
      name={name}
      value={isDate ? value : value || ''}
      placeholder="Tap to select date"
      className={className}
      onFocus={handleActivate}
      onClick={handleActivate}
      onBlur={handleBlur}
      onChange={handleChange}
      autoComplete="off"
      style={{ cursor: 'pointer' }}
    />
  )
}

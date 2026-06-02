'use client'

import { useState, useRef } from 'react'

/**
 * DateInput — starts as a plain text field showing "Click to select date".
 * On focus it switches to type="date" so the browser calendar opens.
 * If cleared or blurred with no value it reverts to text — guaranteeing
 * the browser never auto-inserts today's date.
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
  const ref = useRef<HTMLInputElement>(null)

  function handleFocus() {
    setIsDate(true)
    // Small delay so the browser registers the type change before focusing
    setTimeout(() => ref.current?.showPicker?.(), 50)
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
      ref={ref}
      type={isDate ? 'date' : 'text'}
      name={name}
      value={isDate ? value : value || ''}
      placeholder="Click to select date"
      className={className}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onChange={handleChange}
      autoComplete="off"
      readOnly={!isDate}
      style={{ cursor: isDate ? 'auto' : 'pointer' }}
    />
  )
}

// Where a user can be sent right after login. Shared between the Settings
// picker and the server-side validation on save.
export const LANDING_PAGE_OPTIONS = [
  { value: '/dashboard',    label: 'Dashboard (default)' },
  { value: '/maintenance',  label: 'Maintenance & Fleet' },
  { value: '/service',      label: 'Service Dispatch' },
  { value: '/construction', label: 'Construction' },
] as const

export const VALID_LANDING_PAGES = LANDING_PAGE_OPTIONS.map(o => o.value)

export const DEFAULT_LANDING_PAGE = '/dashboard'

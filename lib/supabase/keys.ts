/**
 * Sanitized Supabase environment variable accessors.
 *
 * JWT keys must contain no whitespace. If the value was pasted into the Vercel
 * dashboard with line-wrapping, the resulting newline causes every HTTP request
 * to fail with "Headers.append: Bearer ... is an invalid header value."
 * Stripping all whitespace here fixes that without requiring a manual Vercel
 * env-var edit (though the Vercel value should be fixed too).
 */

export const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim()

export const SUPABASE_ANON_KEY = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').replace(
  /\s+/g,
  ''
)

export const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').replace(
  /\s+/g,
  ''
)

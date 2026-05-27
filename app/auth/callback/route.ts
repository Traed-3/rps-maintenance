import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createAdminClient } from '@/lib/supabase/admin'
import { cookies } from 'next/headers'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`)
  }

  // In Next.js 16, cookies() must be awaited
  const cookieStore = await cookies()

  // Build the redirect response first so we can set cookies ON the response,
  // not on the incoming cookieStore (which is read-only in Route Handlers).
  const redirectTo = NextResponse.redirect(`${origin}${next}`)
  const errorRedirect = (msg: string) =>
    NextResponse.redirect(`${origin}/login?error=${msg}`)

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        // Set cookies on the response, not the incoming request store.
        // This fixes "TypeError: Headers.append" in Next.js 16 Route Handlers.
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            redirectTo.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data, error } = await supabase.auth.exchangeCodeForSession(code)

  if (error || !data.user) {
    console.error('Auth callback error:', error?.message)
    return errorRedirect('auth_failed')
  }

  const user = data.user
  const admin = createAdminClient()

  // Check if a profile already exists
  const { data: existingProfile } = await admin
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .single()

  if (!existingProfile) {
    const { data: company } = await admin
      .from('companies')
      .select('id')
      .eq('slug', 'rps')
      .single()

    const fullName =
      user.user_metadata?.full_name ??
      user.user_metadata?.name ??
      user.email?.split('@')[0] ??
      'Unknown'

    // First user in the company gets owner role automatically
    let role = 'viewer'
    if (company?.id) {
      const { count } = await admin
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', company.id)
        .eq('role', 'owner')
      if ((count ?? 0) === 0) role = 'owner'
    }

    await admin.from('profiles').insert({
      id: user.id,
      company_id: company?.id ?? null,
      full_name: fullName,
      email: user.email!,
      role,
    })
  }

  return redirectTo
}

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`)
  }

  // We need a mutable response to attach session cookies to.
  // Using a redirect response so the browser is sent to the dashboard
  // with the auth cookies already set.
  const response = NextResponse.redirect(`${origin}${next}`)

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          // Read the PKCE code verifier from the incoming request cookies
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          // Write the session cookies onto the outgoing redirect response
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  const { data, error } = await supabase.auth.exchangeCodeForSession(code)

  if (error || !data.user) {
    console.error('Auth callback error:', error?.message ?? 'No user returned')
    return NextResponse.redirect(`${origin}/login?error=auth_failed`)
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

  return response
}

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

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        },
      },
    }
  )

  const { data, error } = await supabase.auth.exchangeCodeForSession(code)

  if (error || !data.user) {
    console.error('Auth callback error:', error)
    return NextResponse.redirect(`${origin}/login?error=auth_failed`)
  }

  const user = data.user

  // Use the admin client to bypass RLS for profile creation
  const admin = createAdminClient()

  // Check if a profile already exists for this user
  const { data: existingProfile } = await admin
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .single()

  if (!existingProfile) {
    // Look up the RPS company row
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

    // If no owner exists yet in this company, the first person in gets owner.
    // This handles the initial setup — Trae's father logs in first.
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

  return NextResponse.redirect(`${origin}${next}`)
}

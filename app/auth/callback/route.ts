import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createAdminClient } from '@/lib/supabase/admin'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase/keys'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const oauthError = searchParams.get('error')

  // Determine the base URL for redirects
  const host = request.headers.get('host') ?? ''
  const origin =
    process.env.NEXT_PUBLIC_APP_URL ??
    (host.includes('localhost') ? `http://${host}` : `https://${host}`)

  if (oauthError) {
    console.error('[callback] OAuth provider error:', oauthError)
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(oauthError)}`
    )
  }

  if (!code) {
    console.error('[callback] No code in request')
    return NextResponse.redirect(`${origin}/login?error=missing_code`)
  }

  // The redirect response where session cookies will be written
  const redirectToDashboard = NextResponse.redirect(`${origin}/dashboard`)

  const supabase = createServerClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          // Reads all cookies from the incoming request — this is where the
          // code_verifier set by /api/auth/google lives.
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          // Write the session tokens into the redirect response so the browser
          // receives them as it lands on /dashboard.
          cookiesToSet.forEach(({ name, value, options }) => {
            redirectToDashboard.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  console.log(
    '[callback] exchanging code, cookies present:',
    request.cookies.getAll().map(c => c.name).join(',') || 'NONE'
  )

  const { data, error } = await supabase.auth.exchangeCodeForSession(code)

  if (error || !data.session) {
    console.error('[callback] exchangeCodeForSession error:', error?.message)
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error?.message ?? 'auth_failed')}`
    )
  }

  console.log('[callback] session established for user:', data.user.id)

  // Ensure a profile row exists for this user (first-login setup)
  try {
    const admin = createAdminClient()

    const { data: existingProfile } = await admin
      .from('profiles')
      .select('id')
      .eq('id', data.user.id)
      .maybeSingle()

    if (!existingProfile) {
      // Check if there's a pre-created profile for this email (added via "Add Employee" flow)
      // Supabase email-links the Google identity automatically, so data.user.id will be the
      // same as the pre-created auth user ID. But if the profile was created with a different
      // auth user ID, we fall back to an email lookup.
      const userEmail = data.user.email?.toLowerCase()
      const { data: emailProfile } = userEmail
        ? await admin.from('profiles').select('id').eq('email', userEmail).maybeSingle()
        : { data: null }

      if (emailProfile && emailProfile.id !== data.user.id) {
        // A pre-created profile exists with this email but a different UUID —
        // update it to the actual auth user ID so it matches going forward.
        // (This is rare; normally Supabase links identities and keeps the same UUID.)
        await admin.from('profiles').update({ id: data.user.id }).eq('id', emailProfile.id)
        console.log('[callback] linked pre-created profile to auth user')
      } else if (!emailProfile) {
        // Genuinely new user — create their profile
        const { data: company } = await admin
          .from('companies')
          .select('id')
          .eq('slug', 'rps')
          .single()

        const meta = data.user.user_metadata ?? {}
        const fullName =
          (meta.full_name as string | undefined) ??
          (meta.name as string | undefined) ??
          data.user.email?.split('@')[0] ??
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
          id: data.user.id,
          company_id: company?.id ?? null,
          full_name: fullName,
          email: data.user.email!,
          role,
        })

        console.log('[callback] profile created, role:', role)
      }
    }
  } catch (profileErr) {
    // Non-fatal — the app layout has a belt-and-suspenders fallback
    console.error('[callback] profile creation error:', profileErr)
  }

  return redirectToDashboard
}

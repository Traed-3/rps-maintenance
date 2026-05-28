import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function GET(request: NextRequest) {
  const tempResponse = NextResponse.next()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            tempResponse.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  const siteUrl = process.env.NEXT_PUBLIC_APP_URL ?? `https://${request.headers.get('host')}`

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${siteUrl}/auth/callback`,
    },
  })

  const verifierCookies = tempResponse.cookies.getAll()
  console.log('[google-auth] oauth url present:', !!data?.url, '| error:', error?.message ?? 'none', '| cookies set:', verifierCookies.map(c => c.name).join(',') || 'NONE')

  if (error || !data.url) {
    return NextResponse.redirect(new URL('/login?error=oauth_init_failed', request.url))
  }

  const redirectToGoogle = NextResponse.redirect(data.url)

  verifierCookies.forEach((cookie) => {
    redirectToGoogle.cookies.set(cookie.name, cookie.value, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
    })
  })

  return redirectToGoogle
}

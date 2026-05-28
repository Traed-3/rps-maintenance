import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function GET(request: NextRequest) {
  // We build the redirect response up front so the PKCE code_verifier
  // cookie can be set ON the response that the browser actually receives.
  // Using a temporary placeholder — we'll swap the URL below.
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
          // Write PKCE code_verifier onto the response so the browser stores it
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
      skipBrowserRedirect: true, // prevent Supabase from auto-redirecting; we do it manually
    },
  })

  if (error || !data.url) {
    console.error('signInWithOAuth error:', error?.message)
    return NextResponse.redirect(new URL('/login?error=oauth_init_failed', request.url))
  }

  // Build the real redirect to Google, carrying the code_verifier cookies
  const redirectToGoogle = NextResponse.redirect(data.url)

  // Copy all cookies from tempResponse onto the final redirect response
  tempResponse.cookies.getAll().forEach((cookie) => {
    redirectToGoogle.cookies.set(cookie.name, cookie.value, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
    })
  })

  return redirectToGoogle
}

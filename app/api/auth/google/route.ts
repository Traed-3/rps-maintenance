import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase/keys'

export async function GET(request: NextRequest) {
  // Collect cookies that the server client wants to set (the PKCE code_verifier)
  const pendingCookies: Array<{ name: string; value: string; options: Record<string, unknown> }> = []

  const supabase = createServerClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            pendingCookies.push({ name, value, options: options ?? {} })
          })
        },
      },
    }
  )

  const host = request.headers.get('host') ?? ''
  const siteUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    (host.includes('localhost') ? `http://${host}` : `https://${host}`)

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${siteUrl}/auth/callback`,
      // skipBrowserRedirect is irrelevant in a server Route Handler (no window),
      // but set it to true to be explicit and prevent any accidental redirect attempts
      skipBrowserRedirect: true,
    },
  })

  console.log(
    '[google-auth] url:', !!data?.url,
    '| error:', error?.message ?? 'none',
    '| cookies to set:', pendingCookies.map(c => c.name).join(',') || 'NONE'
  )

  if (error || !data?.url) {
    return NextResponse.redirect(new URL('/login?error=oauth_init_failed', request.url))
  }

  // CRITICAL: Return a 200 HTML response — NOT a 307 redirect.
  //
  // If we use NextResponse.redirect() here, Vercel's CDN / some browsers may strip
  // the Set-Cookie headers before the redirect is followed, losing the code_verifier.
  //
  // By returning a 200 response with inline JavaScript that navigates to Google,
  // the browser processes the Set-Cookie headers first (storing the code_verifier),
  // then executes the script. The code_verifier is safely in the cookie jar before
  // the OAuth round-trip begins.
  const oauthUrl = data.url
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Signing in…</title>
  <script>window.location.replace(${JSON.stringify(oauthUrl)})</script>
</head>
<body>
  <p style="font-family:sans-serif;text-align:center;margin-top:3rem">Redirecting to Google…</p>
  <noscript>
    <p style="font-family:sans-serif;text-align:center">
      JavaScript is required. <a href="${oauthUrl}">Click here to continue</a>.
    </p>
  </noscript>
</body>
</html>`

  const response = new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })

  // Apply the code_verifier (and any other auth cookies) to this 200 response
  pendingCookies.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, options as Parameters<typeof response.cookies.set>[2])
  })

  return response
}

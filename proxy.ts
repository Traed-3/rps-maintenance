import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase/keys'
import { VALID_LANDING_PAGES, DEFAULT_LANDING_PAGE } from '@/lib/landing-pages'

// In Next.js 16, middleware is renamed to "proxy" and uses the nodejs runtime.
export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // /api/gmail/*, /api/svc/*, /api/billing/* and /api/daily-summary routes
  // enforce their own auth (CRON_SECRET for the cron paths, session check for
  // in-app dry_run), so they bypass the global login redirect. /api/billing/
  // was missing here, which meant every unauthenticated cron hit to
  // /api/billing/inbox-sync (the econstruction/constructionreceipts/
  // rpinvoicing/maintenance billing-inbox sync, every 15 min) got redirected
  // to /login instead of running — "succeeding" in CI with an HTTP 307 body
  // while doing nothing. Only in-app "Sync now" clicks (already logged in)
  // ever actually ran.
  // PWA manifest + service worker must be reachable without a session so the
  // app icon / theme apply on install.
  const publicPaths = ['/login', '/auth/', '/api/auth/', '/api/gmail/', '/api/svc/', '/api/billing/', '/api/daily-summary', '/manifest.webmanifest', '/sw.js']
  const isPublic = publicPaths.some((p) => pathname.startsWith(p))

  if (!user && !isPublic) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (user && pathname === '/login') {
    // Rare path (already-signed-in user manually hits /login, e.g. an old
    // bookmark) — still honor their configured landing page for consistency
    // with the actual login flows in auth/callback and the password form.
    const { data: profile } = await supabase
      .from('profiles')
      .select('default_landing_page')
      .eq('id', user.id)
      .maybeSingle()
    const page = profile?.default_landing_page
    const landingPage = page && (VALID_LANDING_PAGES as readonly string[]).includes(page) ? page : DEFAULT_LANDING_PAGE
    return NextResponse.redirect(new URL(landingPage, request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    // Exclude Next.js internals, static files, AND the auth callback so the
    // OAuth code exchange is not interfered with by the proxy session check.
    '/((?!_next/static|_next/image|favicon.ico|auth/callback|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}

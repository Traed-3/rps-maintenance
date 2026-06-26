import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase/keys'

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

  // /api/gmail/* and /api/daily-summary routes enforce their own auth
  // (CRON_SECRET for the cron path, session check for in-app dry_run), so
  // they bypass the global login redirect.
  // PWA manifest + service worker must be reachable without a session so the
  // app icon / theme apply on install.
  // /media-art-productions/* is a standalone public marketing landing page
  // (served from public/) and must be reachable without an RPS login.
  const publicPaths = ['/login', '/auth/', '/api/auth/', '/api/gmail/', '/api/daily-summary', '/manifest.webmanifest', '/sw.js', '/media-art-productions']
  const isPublic = publicPaths.some((p) => pathname.startsWith(p))

  if (!user && !isPublic) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (user && pathname === '/login') {
    return NextResponse.redirect(new URL('/dashboard', request.url))
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

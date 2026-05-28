'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import { ensureProfile } from './actions'

export default function AuthCallbackPage() {
  const router = useRouter()

  useEffect(() => {
    async function finishSignIn() {
      const code = new URLSearchParams(window.location.search).get('code')
      if (!code) {
        router.replace('/login?error=missing_code')
        return
      }

      // Create a fresh browser client with detectSessionInUrl:false so nothing
      // auto-exchanges the code — we call exchangeCodeForSession ourselves.
      //
      // The critical reason this works when the server-side route didn't:
      // createBrowserClient stores the PKCE code_verifier in document.cookie
      // during signInWithOAuth. Here — still in the same browser — it reads
      // document.cookie directly to find that verifier. No cross-environment
      // cookie transport issues, no serverless cold-start timing issues.
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { detectSessionInUrl: false } }
      )

      const { data, error } = await supabase.auth.exchangeCodeForSession(code)

      if (error || !data.session) {
        console.error('[callback] exchange failed:', error?.message)
        router.replace(
          `/login?error=${encodeURIComponent(error?.message ?? 'auth_failed')}`
        )
        return
      }

      // Create the profile row if this is the user's first login.
      // Failure here is non-fatal — user still lands on the dashboard.
      try {
        await ensureProfile(
          data.user.id,
          data.user.email!,
          data.user.user_metadata ?? {}
        )
      } catch (e) {
        console.error('[callback] profile creation error:', e)
      }

      router.replace('/dashboard')
    }

    finishSignIn()
  }, [router])

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 mb-4">
          <svg
            className="w-9 h-9 text-white animate-pulse"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"
            />
          </svg>
        </div>
        <p className="text-gray-500 text-sm">Signing you in…</p>
      </div>
    </main>
  )
}

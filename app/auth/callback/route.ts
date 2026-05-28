import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  const allCookies = request.cookies.getAll().map(c => c.name).join(',')
  console.log(`[callback] code:${!!code} cookies:${allCookies || 'NONE'}`)

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`)
  }

  const response = NextResponse.redirect(`${origin}${next}`)

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
            response.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  try {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    console.log(`[callback] exchange error:${error?.message ?? 'none'} hasUser:${!!data?.user}`)

    if (error || !data.user) {
      return NextResponse.redirect(`${origin}/login?error=auth_failed`)
    }

    const admin = createAdminClient()
    const { data: existingProfile } = await admin
      .from('profiles').select('id').eq('id', data.user.id).single()

    if (!existingProfile) {
      const { data: company } = await admin
        .from('companies').select('id').eq('slug', 'rps').single()
      const fullName = data.user.user_metadata?.full_name ?? data.user.user_metadata?.name ?? data.user.email?.split('@')[0] ?? 'Unknown'
      let role = 'viewer'
      if (company?.id) {
        const { count } = await admin.from('profiles').select('*', { count: 'exact', head: true }).eq('company_id', company.id).eq('role', 'owner')
        if ((count ?? 0) === 0) role = 'owner'
      }
      await admin.from('profiles').insert({ id: data.user.id, company_id: company?.id ?? null, full_name: fullName, email: data.user.email!, role })
    }

    return response
  } catch (e: any) {
    console.log(`[callback] exception:${e?.message ?? String(e)}`)
    return NextResponse.redirect(`${origin}/login?error=auth_failed`)
  }
}

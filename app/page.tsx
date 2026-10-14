import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { DEFAULT_LANDING_PAGE, VALID_LANDING_PAGES } from '@/lib/landing-pages'

// Opening the app while already signed in should land on the same page as signing in:
// the user's chosen landing page (e.g. My Plate), not always the dashboard.
export default async function RootPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('default_landing_page')
    .eq('id', user.id)
    .maybeSingle()
  const page = profile?.default_landing_page
  redirect(page && (VALID_LANDING_PAGES as readonly string[]).includes(page) ? page : DEFAULT_LANDING_PAGE)
}

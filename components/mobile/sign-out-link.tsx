'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { LogOut } from 'lucide-react'

export function SignOutLink() {
  const router = useRouter()

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      className="inline-flex items-center gap-2 text-sm font-semibold text-gray-500 hover:text-gray-700 active:text-gray-900"
    >
      <LogOut className="w-4 h-4" />
      <span>Sign out</span>
    </button>
  )
}

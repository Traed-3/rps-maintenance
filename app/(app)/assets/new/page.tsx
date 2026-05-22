import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { AssetForm } from '@/components/assets/asset-form'
import { createAsset } from '../actions'
import { redirect } from 'next/navigation'

export default async function NewAssetPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('company_id, role')
    .eq('id', user!.id)
    .single()

  // Only managers and above can add assets
  if (!profile || !['owner', 'manager', 'shop_manager'].includes(profile.role)) {
    redirect('/assets')
  }

  const { data: assetTypes } = await admin
    .from('asset_types')
    .select('id, name')
    .eq('company_id', profile.company_id)
    .order('name')

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <Link href="/assets" className="text-sm text-gray-500 hover:text-gray-700">
          ← Back to Assets
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-2">Add New Asset</h1>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <AssetForm action={createAsset} assetTypes={assetTypes ?? []} />
      </div>
    </div>
  )
}

import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'RPS Maintenance',
    short_name: 'RPS',
    description: 'RPS Fleet & Shop Operations Platform',
    start_url: '/mobile',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#16243d',
    orientation: 'portrait',
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
    ],
    shortcuts: [
      {
        name: 'Clock In / Out',
        short_name: 'Clock',
        url: '/shop/clock',
        description: 'Clock in or out of your shift',
      },
      {
        name: 'My Tasks',
        short_name: 'Tasks',
        url: '/shop/my-tasks',
        description: 'View your assigned repair tickets',
      },
    ],
  }
}

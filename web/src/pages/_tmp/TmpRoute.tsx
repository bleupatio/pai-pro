import { lazy, Suspense } from 'react'
import { Navigate, useParams } from 'react-router-dom'

// Vite's import.meta.glob discovers all variation pages at build time.
// Lazy-import so each variation page only loads when its slug is hit.
const PAGES = import.meta.glob<{ default: React.ComponentType }>('./*/page.tsx')

/**
 * Dev-only route at /tmp/<slug> that lazy-loads the variation page at
 * web/src/pages/_tmp/<slug>/page.tsx. Returns 404 in production builds.
 * See .claude/skills/pick-variation/SKILL.md.
 */
export default function TmpRoute() {
  const { slug } = useParams<{ slug: string }>()

  if (!import.meta.env.DEV) {
    return <Navigate to="/" replace />
  }

  const path = `./${slug ?? ''}/page.tsx`
  const loader = PAGES[path]
  if (!loader) {
    return (
      <div style={{ padding: 32, fontFamily: 'monospace', color: '#999' }}>
        tmp page <code>{slug}</code> not found at {path}
      </div>
    )
  }

  const Page = lazy(loader)
  return (
    <Suspense fallback={null}>
      <Page />
    </Suspense>
  )
}

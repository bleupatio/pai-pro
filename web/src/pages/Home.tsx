/**
 * Home — projects grid landing page.
 *
 * Features:
 *   - "Your projects." headline (italic serif on the noun)
 *   - Search bar with `/` keyboard shortcut
 *   - Square dashed-border "New project" tile that POSTs /projects
 *     and navigates straight into the new canvas
 *   - Square cards with title, time-since, draft|saved badge, and a
 *     subtle grid-pattern background hinting at the empty canvas
 *   - Pencil button on hover to rename the project inline.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
} from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { VIEWER_URL } from '@/lib/socket'
import type { ProjectRow } from '@/types/canvas'

function timeSince(iso: string | undefined): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  const diff = Date.now() - then
  if (Number.isNaN(then)) return ''
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`
  return new Date(iso).toLocaleDateString()
}

export function Home() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<ProjectRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`${VIEWER_URL}/projects`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`viewer ${res.status}`)
        return res.json() as Promise<ProjectRow[]>
      })
      .then((r) => {
        if (!cancelled) setRows(r)
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  // `/` focuses the search bar (skipped if already in an input).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/') return
      const active = document.activeElement
      const tag = active?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      e.preventDefault()
      searchRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const filtered = useMemo(() => {
    if (rows === null) return null
    const q = query.trim().toLowerCase()
    if (q === '') return rows
    return rows.filter(
      (r) =>
        r.id.toLowerCase().includes(q) || r.title.toLowerCase().includes(q),
    )
  }, [rows, query])

  const createProject = async () => {
    if (creating) return
    setCreating(true)
    try {
      const res = await fetch(`${VIEWER_URL}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) throw new Error(`viewer ${res.status}`)
      const created = (await res.json()) as ProjectRow
      navigate(`/p/${encodeURIComponent(created.id)}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
      setCreating(false)
    }
  }

  const deleteProject = async (id: string, title: string) => {
    const ok = window.confirm(
      `Delete "${title || 'Untitled project'}"?\n\nThe project is removed from the grid; the files stay on disk under projects/.archive/ in case you need to restore them.`,
    )
    if (!ok) return
    const prev = rows
    setRows((r) => (r === null ? r : r.filter((row) => row.id !== id)))
    try {
      const res = await fetch(
        `${VIEWER_URL}/projects/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      )
      if (!res.ok) throw new Error(`viewer ${res.status}`)
    } catch (err: unknown) {
      setRows(prev)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const saveTitle = async (id: string, title: string) => {
    const trimmed = title.trim()
    setEditingId(null)
    const prev = rows
    setRows((r) =>
      r === null
        ? r
        : r.map((row) =>
            row.id === id
              ? { ...row, title: trimmed || 'Untitled project' }
              : row,
          ),
    )
    try {
      const res = await fetch(
        `${VIEWER_URL}/projects/${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: trimmed }),
        },
      )
      if (!res.ok) throw new Error(`viewer ${res.status}`)
    } catch (err: unknown) {
      // Roll back on failure.
      setRows(prev)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="min-h-screen px-8 py-16 sm:px-16">
      <header className="mb-12 flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="text-5xl font-light text-foreground">
            Your <span className="font-serif italic">projects</span>.
          </h1>
          <p className="mt-3 max-w-xl text-sm text-muted-foreground">
            Each project is a conversation with a filmmaking collaborator. Pick
            up where you left off any time.
          </p>
        </div>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
            ⌕
          </span>
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects"
            className="w-72 rounded-lg border border-border bg-card pl-9 pr-10 py-2 text-sm placeholder:text-muted-foreground focus:border-foreground/30 focus:outline-none"
          />
          <kbd className="absolute right-3 top-1/2 -translate-y-1/2 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
            /
          </kbd>
        </div>
      </header>

      {error !== null ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          Couldn't reach the viewer at <code>{VIEWER_URL}</code>: {error}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <button
            type="button"
            onClick={createProject}
            disabled={creating}
            className="group flex aspect-square flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/30 px-6 text-center transition-colors hover:border-foreground/40 hover:bg-card/50 disabled:opacity-50"
          >
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-border text-2xl text-muted-foreground transition-colors group-hover:border-foreground/40 group-hover:text-foreground">
              +
            </div>
            <div className="text-base font-medium text-foreground">
              New project
            </div>
            <div className="mt-2 max-w-[200px] text-xs text-muted-foreground">
              Start a blank conversation. First message becomes the title.
            </div>
          </button>

          {filtered === null
            ? Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="aspect-square rounded-2xl border border-border bg-card/30 animate-pulse"
                />
              ))
            : filtered.map((p) => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  editing={editingId === p.id}
                  onStartEdit={() => setEditingId(p.id)}
                  onCancelEdit={() => setEditingId(null)}
                  onSave={(title) => saveTitle(p.id, title)}
                  onDelete={() => deleteProject(p.id, p.title)}
                />
              ))}
        </div>
      )}
    </div>
  )
}

function ProjectCard({
  project,
  editing,
  onStartEdit,
  onCancelEdit,
  onSave,
  onDelete,
}: {
  project: ProjectRow
  editing: boolean
  onStartEdit: () => void
  onCancelEdit: () => void
  onSave: (title: string) => void
  onDelete: () => void
}): JSX.Element {
  const [draft, setDraft] = useState(project.title)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (editing) {
      setDraft(project.title)
      // Focus + select-all on next paint so the user can just start typing.
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
  }, [editing, project.title])

  const commit = () => {
    onSave(draft)
  }

  const onKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onCancelEdit()
    }
  }

  const stopNav = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  return (
    <Link
      to={`/p/${encodeURIComponent(project.id)}`}
      onClick={(e) => {
        if (editing) e.preventDefault()
      }}
      className="group relative flex aspect-square flex-col overflow-hidden rounded-2xl border border-border bg-card transition-colors hover:border-foreground/30"
    >
      <button
        type="button"
        aria-label="Delete project"
        title="Delete project"
        onClick={(e) => {
          stopNav(e)
          onDelete()
        }}
        className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-muted-foreground opacity-0 transition-all hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus:opacity-100"
      >
        <TrashIcon />
      </button>
      {project.cover_url ? (
        <video
          src={project.cover_url}
          muted
          loop
          autoPlay
          className="min-h-0 w-full flex-1 object-cover"
        />
      ) : (
        <div className="grid-pattern flex-1 opacity-40" />
      )}
      <div className="border-t border-border bg-card/80 p-4">
        {editing ? (
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={onKey}
            onClick={stopNav}
            maxLength={120}
            className="w-full rounded-md border border-foreground/20 bg-background px-2 py-1 text-base font-medium text-foreground focus:border-foreground/50 focus:outline-none"
          />
        ) : (
          <div className="flex items-start justify-between gap-2">
            <div className="line-clamp-2 text-base font-medium text-foreground">
              {project.title || 'Untitled project'}
            </div>
            <button
              type="button"
              aria-label="Rename project"
              onClick={(e) => {
                stopNav(e)
                onStartEdit()
              }}
              className="shrink-0 rounded-md border border-transparent p-1 text-muted-foreground opacity-0 transition-all hover:border-border hover:bg-background hover:text-foreground group-hover:opacity-100 focus:opacity-100"
            >
              <PencilIcon />
            </button>
          </div>
        )}
        <div className="mt-2 flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            {timeSince(project.last_active_at)}
          </span>
          <span
            className={
              'rounded-full border px-2 py-0.5 ' +
              (project.saved
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                : 'border-border text-muted-foreground')
            }
          >
            • {project.saved ? 'saved' : 'draft'}
          </span>
        </div>
      </div>
    </Link>
  )
}

function TrashIcon(): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  )
}

function PencilIcon(): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </svg>
  )
}

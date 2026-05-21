/**
 * ProjectContext — exposes the active projectId to descendants of the
 * CanvasPage route. The CanvasPage route component pulls `:projectId`
 * from `react-router-dom`'s URL params and provides it here so deeper
 * components (GroupFrameNode etc.) don't have to thread it themselves.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react'

interface ProjectContextValue {
  projectId: string | null
}

const ProjectContext = createContext<ProjectContextValue>({ projectId: null })

export function ProjectProvider({
  projectId,
  children,
}: {
  projectId: string | null
  children: ReactNode
}): JSX.Element {
  const value = useMemo<ProjectContextValue>(() => ({ projectId }), [projectId])
  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
}

export function useProject(): ProjectContextValue {
  return useContext(ProjectContext)
}

import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { useAppStore } from '../store/store'

/** Deterministic pleasant hue per project name. */
function hueOf(name: string): number {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360
  return h
}

export function ProjectRail(): React.JSX.Element {
  const { t } = useTranslation()
  const projects = useAppStore((s) => s.projects)
  const current = useAppStore((s) => s.currentProjectId)
  const openProject = useAppStore((s) => s.openProject)
  const addProject = useAppStore((s) => s.addProject)

  return (
    <nav className="project-rail">
      {projects.map((p) => (
        <button
          key={p.id}
          className={`project-chip${p.id === current ? ' active' : ''}`}
          style={{ background: `hsl(${hueOf(p.name)} 55% 46%)` }}
          title={p.path}
          onClick={() => void openProject(p.id)}
        >
          {p.name.slice(0, 2).toUpperCase()}
        </button>
      ))}
      <button className="project-chip add" title={t('projects.add')} onClick={() => void addProject()}>
        <Plus size={16} strokeWidth={1.8} />
      </button>
    </nav>
  )
}

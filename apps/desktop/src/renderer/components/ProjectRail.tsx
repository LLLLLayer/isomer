import { useTranslation } from 'react-i18next'
import { LayoutGrid, Plus } from 'lucide-react'
import { useAppStore } from '../store/store'

export function ProjectRail(): React.JSX.Element {
  const { t } = useTranslation()
  const projects = useAppStore((s) => s.projects)
  const current = useAppStore((s) => s.currentProjectId)
  const openProject = useAppStore((s) => s.openProject)
  const addProject = useAppStore((s) => s.addProject)
  const openManager = useAppStore((s) => s.openManager)

  return (
    <nav className="project-rail">
      {projects.map((p) => (
        <button
          key={p.id}
          className={`project-chip${p.id === current ? ' active' : ''}`}
          title={p.path}
          onClick={() => void openProject(p.id)}
        >
          {p.name.slice(0, 2).toUpperCase()}
        </button>
      ))}
      <button className="project-chip add" title={t('projects.add')} onClick={() => void addProject()}>
        <Plus size={16} strokeWidth={1.8} />
      </button>
      <button
        className="project-chip add"
        title={t('manager.title')}
        onClick={() => openManager()}
      >
        <LayoutGrid size={15} strokeWidth={1.8} />
      </button>
    </nav>
  )
}

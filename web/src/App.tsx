import { Navigate, Route, Routes } from 'react-router-dom'
import { Home } from './pages/Home'
import CanvasView from './pages/CanvasView'
import TmpRoute from './pages/_tmp/TmpRoute'

export default function App() {
  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/p/:projectId" element={<CanvasView />} />
        <Route path="/tmp/:slug" element={<TmpRoute />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}

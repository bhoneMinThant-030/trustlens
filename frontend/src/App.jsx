import OfficerWorkspace from './pages/officer/OfficerWorkspace'
import BackOffice from './pages/backoffice/BackOffice'

// Simple routing without a router package:
//   /            -> Officer screen
//   /backoffice  -> Back office (review queue, dashboard, ...)
function App() {
  if (window.location.pathname.startsWith('/backoffice')) {
    return <BackOffice />
  }

  return <OfficerWorkspace />
}

export default App

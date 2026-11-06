import { useState } from 'react'
import { USE_MOCK } from '../../api/client'
import { DEMO_USERS } from '../../constants/labels'
import ReviewQueue from './ReviewQueue'
import Dashboard from './Dashboard'
import Recommendations from './Recommendations'
import ApprovedAnswers from './ApprovedAnswers'
import { DashboardIcon, FixIcon, ReviewIcon, ShieldIcon } from './Icons'
import './BackOffice.css'
import './AdminTabs.css'

/*
  Back office screen (Frontend 2).
  Reviewers approve or correct flagged answers.
  Admins track quality and approve system changes.
  "Reviewers fix answers; only admins change the system."
*/

// Which tabs each role can open.
const TABS = [
  { id: 'reviews', label: 'Review queue', Icon: ReviewIcon, roles: ['reviewer', 'admin'] },
  { id: 'dashboard', label: 'Dashboard', Icon: DashboardIcon, roles: ['admin'] },
  { id: 'recommendations', label: 'Recommendations', Icon: FixIcon, roles: ['admin'] },
  { id: 'approved', label: 'Approved answers', Icon: ShieldIcon, roles: ['admin'] },
]

// The line under each page title. The review queue reads differently for each role.
const PAGE_TEXT = {
  reviews: {
    reviewer: 'Flagged answers wait here for a human check before they go back to the officer.',
    admin: 'You can read every review. Only reviewers can approve or correct.',
  },
  dashboard: 'Answers checked this week, and where they needed help.',
  recommendations: 'Suggested from recurring failures. Nothing changes until an admin approves it.',
  approved: 'Standard questions get this wording word for word, without the AI.',
}

function BackOffice() {
  // No login in the prototype: the demo switches role here.
  const [role, setRole] = useState('reviewer')
  const [tab, setTab] = useState('reviews')
  const user = DEMO_USERS[role]

  // Each role lands on its main tab.
  function changeRole(nextRole) {
    setRole(nextRole)
    setTab(nextRole === 'admin' ? 'dashboard' : 'reviews')
  }

  const visibleTabs = TABS.filter((item) => item.roles.includes(role))
  const activeTab = visibleTabs.some((item) => item.id === tab) ? tab : visibleTabs[0].id
  const title = TABS.find((item) => item.id === activeTab).label
  const pageText = PAGE_TEXT[activeTab]
  const text = typeof pageText === 'string' ? pageText : pageText[role]

  return (
    <div className="backoffice">
      <title>TrustLens Back Office</title>

      <header className="bo-topbar">
        <p className="bo-wordmark">
          <strong>OCBC</strong>
          <span className="bo-wordmark-rule" />
          TrustLens
          <span className="bo-wordmark-sub">Back office</span>
        </p>
        {USE_MOCK && <span className="bo-env">Sample data</span>}
        <div className="bo-topbar-end">
          <label className="bo-role-switch">
            <span>Signed in as</span>
            <select value={role} onChange={(event) => changeRole(event.target.value)}>
              <option value="reviewer">Reviewer 1</option>
              <option value="admin">Admin 1</option>
            </select>
          </label>
          <a className="bo-link" href="/">
            Officer screen
          </a>
        </div>
      </header>

      <nav className="bo-rail" role="tablist" aria-label="Back office sections">
        {visibleTabs.map(({ id, label, Icon }) => (
          <button
            key={id}
            role="tab"
            aria-selected={activeTab === id}
            className={activeTab === id ? 'active' : ''}
            onClick={() => setTab(id)}
          >
            <Icon size={20} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <main className="bo-main">
        <div className="bo-page-head">
          <h1>{title}</h1>
          <p>{text}</p>
        </div>
        {activeTab === 'reviews' && <ReviewQueue user={user} />}
        {activeTab === 'dashboard' && <Dashboard user={user} />}
        {activeTab === 'recommendations' && <Recommendations user={user} />}
        {activeTab === 'approved' && <ApprovedAnswers user={user} />}
      </main>
    </div>
  )
}

export default BackOffice

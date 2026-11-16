import { useState } from 'react'
import { USE_MOCK } from '../../api/client'
import { DEMO_USERS } from '../../constants/labels'
import ReviewQueue from './ReviewQueue'
import Dashboard from './Dashboard'
import FlaggedDocuments from './FlaggedDocuments'
import { DashboardIcon, FixIcon, ReviewIcon } from './Icons'
import './BackOffice.css'
import './AdminTabs.css'

/*
  Back office screen.
  Reviewers approve or correct flagged answers.
  Admins track quality and see which documents caused corrections.
  "Reviewers fix answers; admins fix the source."
*/

// Which tabs each role can open.
const TABS = [
  { id: 'reviews', label: 'Review queue', Icon: ReviewIcon, roles: ['reviewer', 'admin'] },
  { id: 'dashboard', label: 'Dashboard', Icon: DashboardIcon, roles: ['admin'] },
  { id: 'flagged', label: 'Flagged documents', Icon: FixIcon, roles: ['admin'] },
]

// The line under each page title. The review queue reads differently for each role.
const PAGE_TEXT = {
  reviews: {
    reviewer: 'Flagged answers wait here for a human check before they go back to the officer.',
    admin: 'You can read every review. Only reviewers can approve or correct.',
  },
  dashboard: 'Answers checked so far, and where they needed help.',
  flagged:
    'Unofficial or outdated documents found in answers a reviewer had to correct. Fix the source, and the next customer gets the right answer.',
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
        {activeTab === 'flagged' && <FlaggedDocuments user={user} />}
      </main>
    </div>
  )
}

export default BackOffice

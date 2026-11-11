import { useState } from 'react'
import { USE_MOCK } from '../../api/client'
import { DEMO_USERS } from '../../constants/labels'
import ReviewQueue from './ReviewQueue'
import './BackOffice.css'

/*
  Back office screen (Frontend 2).
  Reviewers approve or correct flagged answers.
  Admins track quality and approve system changes.
  "Reviewers fix answers; only admins change the system."
*/

// Which tabs each role can open.
const TABS = [{ id: 'reviews', label: 'Review queue', roles: ['reviewer', 'admin'] }]

function BackOffice() {
  // No login in the prototype: the demo switches role here.
  const [role, setRole] = useState('reviewer')
  const [tab, setTab] = useState('reviews')
  const user = DEMO_USERS[role]

  const visibleTabs = TABS.filter((item) => item.roles.includes(role))
  const activeTab = visibleTabs.some((item) => item.id === tab) ? tab : visibleTabs[0].id

  return (
    <div className="backoffice">
      <header className="bo-header">
        <div>
          <h1>TrustLens</h1>
          <span>Back Office{USE_MOCK && ' · sample data'}</span>
        </div>

        <div className="bo-header-right">
          <label className="bo-role-switch">
            Signed in as
            <select value={role} onChange={(event) => setRole(event.target.value)}>
              <option value="reviewer">Reviewer 1</option>
              <option value="admin">Admin 1</option>
            </select>
          </label>
          <a className="bo-link" href="/">
            Officer screen
          </a>
        </div>
      </header>

      <nav className="bo-tabs" role="tablist">
        {visibleTabs.map((item) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={activeTab === item.id}
            className={activeTab === item.id ? 'active' : ''}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {activeTab === 'reviews' && <ReviewQueue user={user} />}
    </div>
  )
}

export default BackOffice

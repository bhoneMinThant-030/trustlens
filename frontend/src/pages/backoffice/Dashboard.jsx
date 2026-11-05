import { useEffect, useState } from 'react'
import { getStats } from '../../api/backoffice'
import { categoryLabel, formatPercent } from '../../constants/labels'

/*
  Dashboard tab (admin).
  Pending reviews, review rate and failure types for each credit card category.
  Pending counts come live from the review queue, so they drop as reviewers decide.
*/

const FAILURE_COLUMNS = [
  { key: 'contradicted', label: 'Contradicted' },
  { key: 'insufficientEvidence', label: 'Insufficient evidence' },
  { key: 'outdated', label: 'Outdated source' },
  { key: 'safety', label: 'Safety wording' },
  { key: 'manual', label: 'Sent by officer' },
]

function StatTile({ label, value, detail }) {
  return (
    <div className="bo-card bo-stat">
      <span className="bo-stat-label">{label}</span>
      <strong className="bo-stat-value">{value}</strong>
      {detail && <span className="bo-stat-detail">{detail}</span>}
    </div>
  )
}

// Horizontal bars: one per category, longest = most pending.
function PendingBars({ rows }) {
  const max = Math.max(1, ...rows.map((row) => row.pending))
  return (
    <div className="bo-bars" role="list">
      {rows.map((row) => (
        <div
          className="bo-bar-row"
          role="listitem"
          key={row.category}
          title={`${categoryLabel(row.category)}: ${row.pending} pending`}
        >
          <span className="bo-bar-label">{categoryLabel(row.category)}</span>
          <div className="bo-bar-track">
            {row.pending > 0 && (
              <div className="bo-bar-fill" style={{ width: `${(row.pending / max) * 100}%` }} />
            )}
          </div>
          <span className="bo-bar-value">{row.pending}</span>
        </div>
      ))}
    </div>
  )
}

function Dashboard({ user }) {
  const [stats, setStats] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let ignore = false
    getStats({ user })
      .then((data) => !ignore && setStats(data))
      .catch((err) => !ignore && setError(err.message))
    return () => {
      ignore = true
    }
  }, [user])

  if (error) return <p className="bo-error">{error}</p>
  if (!stats) return <p className="bo-muted">Loading dashboard...</p>

  const rows = stats.byCategory ?? []
  const reviewRate = stats.answeredTotal ? stats.reviewedTotal / stats.answeredTotal : null

  // The highest value in each failure column is highlighted.
  const columnMax = Object.fromEntries(
    FAILURE_COLUMNS.map((column) => [
      column.key,
      Math.max(...rows.map((row) => row.failures[column.key])),
    ]),
  )

  return (
    <div className="bo-dashboard">
      <div className="bo-stat-row">
        <StatTile
          label="Pending reviews"
          value={stats.pendingTotal}
          detail="Waiting for a reviewer"
        />
        <StatTile
          label="Review rate"
          value={formatPercent(reviewRate)}
          detail={`${stats.reviewedTotal} of ${stats.answeredTotal} answers sent to review`}
        />
        <StatTile
          label="Answers checked"
          value={stats.answeredTotal}
          detail="Generated answers this week"
        />
        <StatTile
          label="Resolved reviews"
          value={stats.resolvedTotal}
          detail="Approved or corrected"
        />
      </div>

      <section className="bo-card">
        <h2 className="bo-section-title">Pending reviews by category</h2>
        <PendingBars rows={rows} />
      </section>

      <section className="bo-card">
        <h2 className="bo-section-title">Review rate and failure types by category</h2>
        <p className="bo-muted">
          A flagged answer can have more than one failure type, so the failure columns can add up to
          more than "Sent to review".
        </p>
        <div className="bo-table-wrap">
          <table className="bo-table">
            <thead>
              <tr>
                <th>Category</th>
                <th className="num">Answers</th>
                <th className="num">Sent to review</th>
                <th>Review rate</th>
                {FAILURE_COLUMNS.map((column) => (
                  <th className="num" key={column.key}>
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const rate = row.answered ? row.sentToReview / row.answered : 0
                return (
                  <tr key={row.category}>
                    <td>{categoryLabel(row.category)}</td>
                    <td className="num">{row.answered}</td>
                    <td className="num">{row.sentToReview}</td>
                    <td>
                      <div className="bo-rate">
                        <div className="bo-rate-track">
                          <div className="bo-rate-fill" style={{ width: `${rate * 100}%` }} />
                        </div>
                        <span>{formatPercent(rate)}</span>
                      </div>
                    </td>
                    {FAILURE_COLUMNS.map((column) => {
                      const value = row.failures[column.key]
                      const isMax = value > 0 && value === columnMax[column.key]
                      return (
                        <td className={`num ${isMax ? 'bo-max' : ''}`} key={column.key}>
                          {value}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

export default Dashboard

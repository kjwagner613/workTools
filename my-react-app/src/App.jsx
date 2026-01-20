import { useEffect, useMemo, useState } from 'react'
import './App.css'

const initialWorkTypes = [
  { id: 'setup-sharepoint', name: 'Setup SharePoint', rate: 65 },
  { id: 'reporting', name: 'Reporting & Dashboards', rate: 85 },
  { id: 'admin', name: 'Admin & Planning', rate: 55 },
]

const todayISO = new Date().toISOString().slice(0, 10)

const formatCurrency = (value) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(value)

const formatDate = (value) =>
  new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(`${value}T00:00:00`))

const getWeekStart = (value) => {
  const date = new Date(`${value}T00:00:00`)
  const offset = (date.getDay() + 6) % 7
  date.setDate(date.getDate() - offset)
  return date.toISOString().slice(0, 10)
}

const createEntryId = () =>
  `entry-${Date.now()}-${Math.random().toString(16).slice(2)}`

const STORAGE_KEY = 'work-tools-timesheet-v1'

const loadStoredData = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return { workTypes: initialWorkTypes, entries: [] }
    }
    const parsed = JSON.parse(raw)
    return {
      workTypes: Array.isArray(parsed.workTypes)
        ? parsed.workTypes
        : initialWorkTypes,
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    }
  } catch (error) {
    return { workTypes: initialWorkTypes, entries: [] }
  }
}

function App() {
  const [workTypes, setWorkTypes] = useState(() => loadStoredData().workTypes)
  const [entries, setEntries] = useState(() => loadStoredData().entries)
  const [newWorkName, setNewWorkName] = useState('')
  const [newWorkRate, setNewWorkRate] = useState('65')
  const [entryDate, setEntryDate] = useState(todayISO)
  const [entryWorkTypeId, setEntryWorkTypeId] = useState(
    initialWorkTypes[0]?.id ?? ''
  )
  const [entryHours, setEntryHours] = useState('1')
  const [entryClient, setEntryClient] = useState('')
  const [entryProject, setEntryProject] = useState('')
  const [editingWorkTypeId, setEditingWorkTypeId] = useState(null)
  const [editingWorkName, setEditingWorkName] = useState('')
  const [editingWorkRate, setEditingWorkRate] = useState('')

  const selectedWorkType = useMemo(
    () => workTypes.find((type) => type.id === entryWorkTypeId),
    [entryWorkTypeId, workTypes]
  )

  const entryTotal =
    selectedWorkType && Number(entryHours)
      ? selectedWorkType.rate * Number(entryHours)
      : 0

  const entriesByDate = useMemo(() => {
    return entries.reduce((acc, entry) => {
      acc[entry.date] = acc[entry.date] ?? []
      acc[entry.date].push(entry)
      return acc
    }, {})
  }, [entries])

  const sortedDates = useMemo(() => {
    return Object.keys(entriesByDate).sort((a, b) =>
      a < b ? 1 : a > b ? -1 : 0
    )
  }, [entriesByDate])

  const weeklyTotals = useMemo(() => {
    return entries.reduce((acc, entry) => {
      const weekStart = getWeekStart(entry.date)
      acc[weekStart] = acc[weekStart] ?? { total: 0, hours: 0 }
      acc[weekStart].total += entry.rate * entry.hours
      acc[weekStart].hours += entry.hours
      return acc
    }, {})
  }, [entries])

  const weeklyUnbilledTotals = useMemo(() => {
    return entries.reduce((acc, entry) => {
      if (entry.billed) {
        return acc
      }
      const weekStart = getWeekStart(entry.date)
      acc[weekStart] = acc[weekStart] ?? { total: 0, hours: 0 }
      acc[weekStart].total += entry.rate * entry.hours
      acc[weekStart].hours += entry.hours
      return acc
    }, {})
  }, [entries])

  const weeklyKeys = useMemo(() => {
    return Object.keys(weeklyTotals).sort((a, b) =>
      a < b ? 1 : a > b ? -1 : 0
    )
  }, [weeklyTotals])

  const overallTotal = useMemo(() => {
    return entries.reduce((sum, entry) => sum + entry.rate * entry.hours, 0)
  }, [entries])

  const unbilledEntries = useMemo(
    () => entries.filter((entry) => !entry.billed),
    [entries]
  )

  const unbilledTotal = useMemo(() => {
    return unbilledEntries.reduce(
      (sum, entry) => sum + entry.rate * entry.hours,
      0
    )
  }, [unbilledEntries])

  useEffect(() => {
    const payload = JSON.stringify({ workTypes, entries })
    localStorage.setItem(STORAGE_KEY, payload)
  }, [workTypes, entries])

  const handleAddWorkType = (event) => {
    event.preventDefault()
    const trimmedName = newWorkName.trim()
    const rateValue = Number(newWorkRate)
    if (!trimmedName || !rateValue) {
      return
    }

    const newType = {
      id: `${trimmedName.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`,
      name: trimmedName,
      rate: rateValue,
    }

    setWorkTypes((prev) => [...prev, newType])
    setNewWorkName('')
    setNewWorkRate('65')
    setEntryWorkTypeId((current) => current || newType.id)
  }

  const startEditWorkType = (type) => {
    setEditingWorkTypeId(type.id)
    setEditingWorkName(type.name)
    setEditingWorkRate(String(type.rate))
  }

  const cancelEditWorkType = () => {
    setEditingWorkTypeId(null)
    setEditingWorkName('')
    setEditingWorkRate('')
  }

  const saveEditWorkType = (event) => {
    event.preventDefault()
    const trimmedName = editingWorkName.trim()
    const rateValue = Number(editingWorkRate)
    if (!trimmedName || !rateValue) {
      return
    }
    setWorkTypes((prev) =>
      prev.map((type) =>
        type.id === editingWorkTypeId
          ? { ...type, name: trimmedName, rate: rateValue }
          : type
      )
    )
    cancelEditWorkType()
  }

  const deleteWorkType = (typeId) => {
    const isUsed = entries.some((entry) => entry.workTypeId === typeId)
    if (isUsed) {
      window.alert(
        'This work type has entries logged. Edit the name/rate instead of deleting it.'
      )
      return
    }
    setWorkTypes((prev) => prev.filter((type) => type.id !== typeId))
    setEntryWorkTypeId((current) => {
      if (current !== typeId) {
        return current
      }
      const remaining = workTypes.filter((type) => type.id !== typeId)
      return remaining[0]?.id ?? ''
    })
    if (editingWorkTypeId === typeId) {
      cancelEditWorkType()
    }
  }

  const handleAddEntry = (event) => {
    event.preventDefault()
    if (!selectedWorkType || !entryDate) {
      return
    }

    const hoursValue = Number(entryHours)
    if (!hoursValue) {
      return
    }

    const newEntry = {
      id: createEntryId(),
      date: entryDate,
      workTypeId: selectedWorkType.id,
      workTypeName: selectedWorkType.name,
      rate: selectedWorkType.rate,
      hours: hoursValue,
      client: entryClient.trim(),
      project: entryProject.trim(),
      billed: false,
    }

    setEntries((prev) => [newEntry, ...prev])
    setEntryHours('1')
    setEntryClient('')
    setEntryProject('')
  }

  const handleExportCsv = () => {
    if (unbilledEntries.length === 0) {
      return
    }
    const rows = [
      ['Date', 'Client', 'Project', 'Work Type', 'Hours', 'Rate', 'Total'],
      ...unbilledEntries.map((entry) => [
        entry.date,
        entry.client || '',
        entry.project || '',
        entry.workTypeName,
        entry.hours,
        entry.rate,
        (entry.rate * entry.hours).toFixed(2),
      ]),
    ]
    const csv = rows
      .map((row) =>
        row
          .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
          .join(',')
      )
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `timesheet-${todayISO}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const toggleBilled = (entryId) => {
    setEntries((prev) =>
      prev.map((entry) =>
        entry.id === entryId ? { ...entry, billed: !entry.billed } : entry
      )
    )
  }

  const markWeekBilled = (weekStart) => {
    const endDate = new Date(`${weekStart}T00:00:00`)
    endDate.setDate(endDate.getDate() + 6)
    const weekEnd = endDate.toISOString().slice(0, 10)
    setEntries((prev) =>
      prev.map((entry) => {
        if (entry.date >= weekStart && entry.date <= weekEnd) {
          return { ...entry, billed: true }
        }
        return entry
      })
    )
  }

  return (
    <div className="app">
      <header className="hero">
        <div>
          <p className="eyebrow">Work Tools</p>
          <h1>Timesheet dashboard</h1>
          <p className="hero-subtitle">
            Capture billable work, keep weekly totals for invoicing, and stay
            ready for follow-ups.
          </p>
        </div>
        <div className="hero-card">
          <h2>Invoice runway</h2>
          <div className="hero-metric">
            <span>Total logged</span>
            <strong>{formatCurrency(overallTotal)}</strong>
          </div>
          <div className="hero-metric">
            <span>Unbilled total</span>
            <strong>{formatCurrency(unbilledTotal)}</strong>
          </div>
          <div className="hero-metric">
            <span>Active work types</span>
            <strong>{workTypes.length}</strong>
          </div>
          <div className="hero-metric">
            <span>Entries</span>
            <strong>{entries.length}</strong>
          </div>
        </div>
      </header>

      <section className="grid">
        <div className="panel" style={{ '--delay': '60ms' }}>
          <div className="panel-header">
            <h2>Work types</h2>
            <p>Keep your rates handy.</p>
          </div>
          <ul className="worktype-list">
            {workTypes.map((type) => (
              <li key={type.id}>
                {editingWorkTypeId === type.id ? (
                  <form className="worktype-edit" onSubmit={saveEditWorkType}>
                    <div className="worktype-inputs">
                      <input
                        type="text"
                        value={editingWorkName}
                        onChange={(event) =>
                          setEditingWorkName(event.target.value)
                        }
                      />
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={editingWorkRate}
                        onChange={(event) =>
                          setEditingWorkRate(event.target.value)
                        }
                      />
                    </div>
                    <div className="worktype-actions">
                      <button type="submit" className="worktype-button">
                        Save
                      </button>
                      <button
                        type="button"
                        className="worktype-button ghost"
                        onClick={cancelEditWorkType}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="worktype-info">
                      <span>{type.name}</span>
                      <span>{formatCurrency(type.rate)}/hr</span>
                    </div>
                    <div className="worktype-actions">
                      <button
                        type="button"
                        className="worktype-button ghost"
                        onClick={() => startEditWorkType(type)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="worktype-button ghost danger"
                        onClick={() => deleteWorkType(type.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
          <form className="form" onSubmit={handleAddWorkType}>
            <label>
              Work name
              <input
                type="text"
                value={newWorkName}
                onChange={(event) => setNewWorkName(event.target.value)}
                placeholder="Implementation sprint"
              />
            </label>
            <label>
              Hourly rate
              <input
                type="number"
                min="0"
                step="1"
                value={newWorkRate}
                onChange={(event) => setNewWorkRate(event.target.value)}
              />
            </label>
            <button type="submit">Add work type</button>
          </form>
        </div>

        <div className="panel" style={{ '--delay': '120ms' }}>
          <div className="panel-header">
            <h2>Timesheet</h2>
            <p>Log today or backfill the last few weeks.</p>
          </div>
          {workTypes.length === 0 ? (
            <div className="empty-state">
              Add a work type to start tracking time.
            </div>
          ) : (
            <form className="form" onSubmit={handleAddEntry}>
              <label>
                Date
                <input
                  type="date"
                  value={entryDate}
                  onChange={(event) => setEntryDate(event.target.value)}
                />
              </label>
              <label>
                Client
                <input
                  type="text"
                  value={entryClient}
                  onChange={(event) => setEntryClient(event.target.value)}
                  placeholder="Acme Co."
                />
              </label>
              <label>
                Project
                <input
                  type="text"
                  value={entryProject}
                  onChange={(event) => setEntryProject(event.target.value)}
                  placeholder="SharePoint rollout"
                />
              </label>
              <label>
                Work type
                <select
                  value={entryWorkTypeId}
                  onChange={(event) => setEntryWorkTypeId(event.target.value)}
                >
                  {workTypes.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name} · {formatCurrency(type.rate)}/hr
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Duration (hours)
                <input
                  type="number"
                  min="0"
                  step="0.25"
                  value={entryHours}
                  onChange={(event) => setEntryHours(event.target.value)}
                />
              </label>
              <div className="total-row">
                <span>Entry total</span>
                <strong>{formatCurrency(entryTotal)}</strong>
              </div>
              <button type="submit">Add to timesheet</button>
            </form>
          )}
        </div>

        <div className="panel panel-wide" style={{ '--delay': '180ms' }}>
          <div className="panel-header">
            <h2>Daily log</h2>
            <p>Grouped by date for quick invoice checks.</p>
          </div>
          {sortedDates.length === 0 ? (
            <div className="empty-state">
              No entries yet. Add your first time block.
            </div>
          ) : (
            <div className="log">
              {sortedDates.map((date) => {
                const dayEntries = entriesByDate[date]
                const dayTotal = dayEntries.reduce(
                  (sum, entry) => sum + entry.rate * entry.hours,
                  0
                )
                return (
                  <div className="log-day" key={date}>
                    <div className="log-day-header">
                      <h3>{formatDate(date)}</h3>
                      <span>{formatCurrency(dayTotal)}</span>
                    </div>
                    <div className="log-rows">
                      {dayEntries.map((entry) => (
                        <div className="log-row" key={entry.id}>
                          <div>
                            <strong>{entry.workTypeName}</strong>
                            {(entry.client || entry.project) && (
                              <span className="tagline">
                                {[entry.client, entry.project]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </span>
                            )}
                            <span>
                              {entry.hours}h · {formatCurrency(entry.rate)}/hr
                            </span>
                          </div>
                          <div className="log-row-actions">
                            <div className="row-total">
                              {formatCurrency(entry.rate * entry.hours)}
                            </div>
                            <label className="billed-toggle">
                              <input
                                type="checkbox"
                                checked={entry.billed}
                                onChange={() => toggleBilled(entry.id)}
                              />
                              <span>{entry.billed ? 'Billed' : 'Unbilled'}</span>
                            </label>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>

      <section className="grid">
        <div className="panel" style={{ '--delay': '240ms' }}>
          <div className="panel-header">
            <h2>Weekly totals</h2>
            <p>Track what is ready to invoice.</p>
          </div>
          {weeklyKeys.length === 0 ? (
            <div className="empty-state">
              Weekly totals appear after your first entry.
            </div>
          ) : (
            <div className="weekly">
              {weeklyKeys.map((weekStart) => {
                const week = weeklyTotals[weekStart]
                const unbilledWeek = weeklyUnbilledTotals[weekStart]
                const weekStartDate = formatDate(weekStart)
                const endDate = new Date(`${weekStart}T00:00:00`)
                endDate.setDate(endDate.getDate() + 6)
                return (
                  <div className="weekly-row" key={weekStart}>
                    <div>
                      <strong>{weekStartDate}</strong>
                      <span>
                        through {formatDate(endDate.toISOString().slice(0, 10))}
                      </span>
                    </div>
                    <div className="row-total">
                      {week.hours.toFixed(2)}h · {formatCurrency(week.total)}
                    </div>
                    <button
                      type="button"
                      className="weekly-bill-button"
                      onClick={() => markWeekBilled(weekStart)}
                      disabled={!unbilledWeek || unbilledWeek.total === 0}
                    >
                      Mark week billed
                    </button>
                  </div>
                )
              })}
            </div>
          )}
          <button
            type="button"
            className="export-button"
            onClick={handleExportCsv}
            disabled={unbilledEntries.length === 0}
          >
            Export CSV for QuickBooks
          </button>
        </div>
      </section>
    </div>
  )
}

export default App

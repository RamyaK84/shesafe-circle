import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

// Use the page's own hostname so the session cookie is same-site whether the app is opened
// via localhost or 127.0.0.1. Override with VITE_API_BASE when the API is hosted elsewhere.
const API_BASE = import.meta.env.VITE_API_BASE || `http://${window.location.hostname}:3001`

// Read a JSON body without crashing on empty or non-JSON error responses (proxy errors, HTML pages).
const readJson = async (response) => {
  try {
    return await response.json()
  } catch {
    return {}
  }
}
const iconPaths = {
  shield: 'M12 3 4.5 6v5.1c0 4.7 3.2 8.8 7.5 9.9 4.3-1.1 7.5-5.2 7.5-9.9V6L12 3Z',
  search: 'm20 20-4.4-4.4M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4',
  chevron: 'm7 10 5 5 5-5',
  pin: 'M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z M12 10a2.5 2.5 0 1 0 0-.01',
  clock: 'M12 8v4l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  message: 'M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z',
  users: 'M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2m16 0v-2a4 4 0 0 0-3-3.9M14 3.1a4 4 0 0 1 0 7.8M14 5a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  route: 'M4 19c2.5-2 5.5-2 8 0s5.5 2 8 0M4 5c2.5 2 5.5 2 8 0s5.5-2 8 0M4 5v14m16-14v14M12 5v14',
  upload: 'M12 16V4m0 0L7 9m5-5 5 5M4 16v4h16v-4',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Zm0 0v6h6M8 14h8m-8 4h8',
  alert: 'M10.3 3.9 2.5 17.4A2 2 0 0 0 4.2 20h15.6a2 2 0 0 0 1.7-2.6L13.7 3.9a2 2 0 0 0-3.4 0ZM12 9v4m0 3h.01',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  filter: 'M4 6h16M7 12h10m-7 6h4',
  close: 'm18 6-12 12M6 6l12 12',
  check: 'm5 12 4 4L19 6',
  menu: 'M4 6h16M4 12h16M4 18h16',
  info: 'M12 16v-4m0-4h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
}

function Icon({ name, size = 18, className = '' }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d={iconPaths[name] || iconPaths.info} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function BrandMark({ small = false }) {
  return (
    <span className={`brand-mark${small ? ' brand-mark-small' : ''}`} aria-hidden="true">
      <Icon name="shield" size={small ? 19 : 23} />
      <span className="brand-mark-check"><Icon name="check" size={small ? 10 : 12} /></span>
    </span>
  )
}

const observationOptions = [
  { value: 'still-present', label: 'Still present' },
  { value: 'appears-resolved', label: 'Appears resolved' },
  { value: 'needs-review', label: 'Needs more review' },
]

const demoDiscussion = [
  {
    id: 'demo-comment-a',
    displayName: 'Member A · Demo',
    text: 'The lights were still not working when I passed this evening.',
    observation: 'still-present',
    createdAt: '2026-10-22T18:20:00.000Z',
  },
  {
    id: 'demo-comment-b',
    displayName: 'Member B · Demo',
    text: 'I noticed the same issue near the entrance.',
    observation: 'still-present',
    createdAt: '2026-10-22T18:42:00.000Z',
  },
  {
    id: 'demo-comment-c',
    displayName: 'Member C · Demo',
    text: 'The lighting appears improved near the main gate, but the far end is still dark.',
    observation: 'needs-review',
    createdAt: '2026-10-22T19:05:00.000Z',
  },
]

const statusSequence = [
  { label: 'Report Submitted', statuses: ['Submitted'] },
  { label: 'Follow-up Submitted', statuses: ['Follow-up Submitted'] },
  { label: 'Community Corroboration', statuses: ['Corroborated'] },
  { label: 'Resolution Claimed', statuses: ['Resolution Reported'] },
  { label: 'Outcome Verified', statuses: ['Outcome Verified'] },
]

const createDemoEvidencePlaceholder = (label) => {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#111827" />
          <stop offset="100%" stop-color="#1f2937" />
        </linearGradient>
      </defs>
      <rect width="1200" height="900" fill="url(#bg)" />
      <rect x="80" y="80" width="1040" height="740" rx="28" fill="rgba(15,23,42,0.70)" stroke="rgba(244,114,182,0.75)" />
      <circle cx="390" cy="315" r="110" fill="rgba(244,114,182,0.18)" stroke="rgba(244,114,182,0.7)" />
      <path d="M280 610 C 355 505, 420 470, 500 612" fill="none" stroke="rgba(244,114,182,0.70)" stroke-width="22" stroke-linecap="round" />
      <path d="M520 550 L 700 420 L 892 550" fill="none" stroke="rgba(59,130,246,0.70)" stroke-width="18" stroke-linecap="round" stroke-linejoin="round" />
      <text x="600" y="735" text-anchor="middle" font-size="52" font-family="Arial, Helvetica, sans-serif" fill="#E2E8F0" letter-spacing="4">DEMO EVIDENCE</text>
      <text x="600" y="790" text-anchor="middle" font-size="28" font-family="Arial, Helvetica, sans-serif" fill="#F9A8D4">${label}</text>
    </svg>
  `

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
}

const demoReports = [
  {
    id: 1,
    title: 'Poor lighting near Riverside Walkway',
    type: 'Safety Concern',
    time: 'Today · 6:40 PM',
    location: 'Riverside Walkway',
    urgency: 'High',
    status: 'Corroborated',
    feedStatus: 'Under Review',
    summary: 'Lighting remains limited along the far stretch of the riverside path after dusk.',
    details:
      'Illustrative report details for the visual demo only. No real incident or official response is represented by this sample.',
    support: 'Demo data only. Community support actions have not been verified.',
    author: 'Demo member',
    duplicateFlag: 'Duplicate check unavailable for demo reports.',
    communityVotes: { stillPresent: 14, appearsResolved: 2, moreReview: 6 },
    userVote: null,
    evidence: {
      original: {
        url: createDemoEvidencePlaceholder('Riverside lighting · Original'),
        label: 'Demo placeholder: Original route condition',
        publicId: 'demo-original-1',
      },
      followUp: {
        url: createDemoEvidencePlaceholder('Riverside lighting · Follow-up'),
        label: 'Demo placeholder: Follow-up route check',
        publicId: 'demo-follow-up-1',
      },
      resolution: {
        claim: 'Demo claim; no authority response is verified.',
        label: 'Resolution claim',
      },
      reviewerNotes: 'Illustrative demo notes only. Not an official authority response.',
      statusHistory: [
        { status: 'Submitted', note: 'Demo sample report entry', time: '18:42' },
        { status: 'Corroborated', note: 'Illustrative community assessment', time: '18:49' },
      ],
    },
    moderatorVerification: {
      verified: false,
      reviewedBy: 'Moderator queue',
      note: 'Demo sample. Not officially verified.',
    },
  },
  {
    id: 2,
    title: 'Suspicious activity at Bus Stop',
    type: 'Suspicious Activity',
    time: 'Today · 8:10 AM',
    location: 'Central Bus Stop',
    urgency: 'Medium',
    status: 'Submitted',
    feedStatus: 'New',
    summary: 'A sample concern about repeated unknown activity near the bus shelter.',
    details:
      'Illustrative report details for the visual demo only. No real incident or official response is represented by this sample.',
    support: 'Demo data only. Community support actions have not been verified.',
    author: 'Demo member',
    duplicateFlag: 'Duplicate check unavailable for demo reports.',
    communityVotes: { stillPresent: 11, appearsResolved: 4, moreReview: 3 },
    userVote: null,
    evidence: {
      original: {
        url: createDemoEvidencePlaceholder('Bus stop activity · Original'),
        label: 'Demo placeholder: Original report image',
        publicId: 'demo-original-2',
      },
      followUp: {
        url: createDemoEvidencePlaceholder('Bus stop activity · Follow-up'),
        label: 'Demo placeholder: Follow-up report image',
        publicId: 'demo-follow-up-2',
      },
      resolution: {
        claim: 'No resolution claim has been submitted for this demo sample.',
        label: 'Resolution claim',
      },
      reviewerNotes: 'Illustrative demo notes only. Not an official authority response.',
      statusHistory: [
        { status: 'Submitted', note: 'Demo sample report entry', time: '08:10' },
      ],
    },
    moderatorVerification: {
      verified: false,
      reviewedBy: 'Moderator queue',
      note: 'Demo sample. Not officially verified.',
    },
  },
  {
    id: 3,
    title: 'Unsafe pathway in City Park',
    type: 'Route Concern',
    time: 'Yesterday · 4:20 PM',
    location: 'City Park Pathway',
    urgency: 'Low',
    status: 'Follow-up Submitted',
    feedStatus: 'In Progress',
    summary: 'An illustrative pathway concern near the park entrance has an update pending review.',
    details:
      'Illustrative report details for the visual demo only. No real incident or official response is represented by this sample.',
    support: 'Demo data only. Community support actions have not been verified.',
    author: 'Demo member',
    duplicateFlag: 'Duplicate check unavailable for demo reports.',
    communityVotes: { stillPresent: 2, appearsResolved: 7, moreReview: 5 },
    userVote: null,
    evidence: {
      original: {
        url: createDemoEvidencePlaceholder('City Park pathway · Original'),
        label: 'Demo placeholder: Original pathway condition',
        publicId: 'demo-original-3',
      },
      followUp: {
        url: createDemoEvidencePlaceholder('City Park pathway · Follow-up'),
        label: 'Demo placeholder: Follow-up pathway check',
        publicId: 'demo-follow-up-3',
      },
      resolution: {
        claim: 'No resolution claim has been submitted for this demo sample.',
        label: 'Resolution claim',
      },
      reviewerNotes: 'Illustrative demo notes only. Not an official authority response.',
      statusHistory: [
        { status: 'Submitted', note: 'Demo sample report entry', time: 'Yesterday 16:21' },
        { status: 'Follow-up Submitted', note: 'Illustrative follow-up status', time: 'Yesterday 18:10' },
      ],
    },
    moderatorVerification: {
      verified: false,
      reviewedBy: 'Moderator queue',
      note: 'Demo sample. Not officially verified.',
    },
  },
]

const statCards = [
  { label: 'Total Reports', value: '126' },
  { label: 'Safe routes shared', value: '42' },
  { label: 'Community check-ins', value: '89' },
]

const reportTypes = ['Safety Concern', 'Suspicious Activity', 'Route Concern', 'Harassment', 'Unsafe route', 'Vehicle concern', 'Medical', 'Other']
const feedCategories = ['All categories', ...reportTypes]

const defaultUploadForm = {
  reportId: 1,
  evidenceType: 'followUp',
  resolutionClaim: '',
  file: null,
  privacyAccepted: false,
}

function App() {
  const [reports, setReports] = useState(demoReports)
  const persistentReports = reports.filter((report) => report.persistent === true)
  const [selectedReportId, setSelectedReportId] = useState(demoReports[0].id)
  const [reportSearch, setReportSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('All categories')
  const [showAllReports, setShowAllReports] = useState(false)
  const [discussionSort, setDiscussionSort] = useState('newest')
  const [account, setAccount] = useState(null)
  const [authMode, setAuthMode] = useState('')
  const [authForm, setAuthForm] = useState({ displayName: '', email: '', password: '' })
  const [profileName, setProfileName] = useState('')
  const [authError, setAuthError] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [notificationOpen, setNotificationOpen] = useState(false)
  const [showMyReports, setShowMyReports] = useState(false)
  const [activeSection, setActiveSection] = useState(() => {
    const section = window.location.hash.slice(1)
    return section === 'upload-evidence' ? 'details' : section || 'home'
  })
  const [discussion, setDiscussion] = useState({ comments: [], loading: true, error: '', message: '' })
  const [commentDraft, setCommentDraft] = useState('')
  const [commentObservation, setCommentObservation] = useState('needs-review')
  const [commentBusy, setCommentBusy] = useState(false)
  const [replyTarget, setReplyTarget] = useState(null)
  const [editingComment, setEditingComment] = useState(null)
  const [reportedCommentIds, setReportedCommentIds] = useState([])
  const [formData, setFormData] = useState({
    type: 'Harassment',
    location: 'Downtown station',
    time: 'Tonight',
    urgency: 'High',
    description: '',
  })
  const [uploadForm, setUploadForm] = useState(defaultUploadForm)
  const [uploadStatus, setUploadStatus] = useState({ message: '', type: '' })
  const [reportStatus, setReportStatus] = useState({ message: '', type: '' })
  const [evidenceDetailsOpen, setEvidenceDetailsOpen] = useState(false)
  const [uploadBusy, setUploadBusy] = useState(false)
  const uploadInFlight = useRef(false)
  const [reportBusy, setReportBusy] = useState(false)
  const reportInFlight = useRef(false)
  const [reportsLoadError, setReportsLoadError] = useState('')
  const [previewUrl, setPreviewUrl] = useState('')
  const [originalFile, setOriginalFile] = useState(null)
  const [originalPreviewUrl, setOriginalPreviewUrl] = useState('')
  const accountMenuRef = useRef(null)
  const notificationRef = useRef(null)

  const uploadReportId = persistentReports.some((report) => String(report.id) === String(uploadForm.reportId))
    ? uploadForm.reportId
    : persistentReports[0]?.id ?? ''
  const selectedReport =
    reports.find((report) => report.id === selectedReportId) ?? reports[0]
  const visibleReports = showMyReports && account
    ? reports.filter((report) => report.authorId === account.id)
    : reports
  const filteredReports = visibleReports.filter((report) => {
    const matchesCategory = categoryFilter === 'All categories' || report.type === categoryFilter
    const haystack = `${report.title || ''} ${report.type} ${report.location} ${report.summary}`.toLowerCase()
    return matchesCategory && haystack.includes(reportSearch.trim().toLowerCase())
  })
  const displayedReports = showAllReports ? filteredReports : filteredReports.slice(0, 6)
  const displayedComments = discussion.comments.length > 0
    ? discussion.comments
    : discussion.error && String(selectedReport.id) === '1'
      ? demoDiscussion
      : []
  const sortedComments = [...displayedComments].sort((first, second) => {
    const direction = discussionSort === 'newest' ? -1 : 1
    return direction * (new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime())
  })
  const reportNotifications = [
    ...(selectedReport.status !== 'Submitted' ? [`${selectedReport.type} has an update: ${selectedReport.status}.`] : []),
    ...(discussion.error ? ['Community discussion is unavailable until the MongoDB service is configured.'] : []),
  ]

  const voteSummary = useMemo(
    () => ({
      stillPresent: selectedReport.communityVotes.stillPresent,
      appearsResolved: selectedReport.communityVotes.appearsResolved,
      moreReview: selectedReport.communityVotes.moreReview,
    }),
    [selectedReport],
  )

  useEffect(() => {
    let active = true
    fetch(`${API_BASE}/api/auth/me`, { credentials: 'include' })
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Account service is unavailable.')
        return data
      })
      .then((data) => { if (active) setAccount(data.account) })
      .catch(() => { if (active) setAccount(null) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    fetch(`${API_BASE}/api/reports`, { credentials: 'include' })
      .then(async (response) => {
        const data = await readJson(response)
        if (!response.ok) throw new Error(data.error || 'Unable to load saved reports.')
        if (!Array.isArray(data.reports)) throw new Error('The server returned an unexpected response while loading saved reports.')
        return data
      })
      .then((data) => {
        if (!active) return
        setReportsLoadError('')
        const savedReports = [...new Map(data.reports.map((report) => [String(report.id), report])).values()]
        setReports((current) => [...savedReports, ...current.filter((report) => !report.persistent)])
        if (savedReports.length) {
          // After a refresh, show the newest saved report (with its evidence) instead of the first demo card.
          setSelectedReportId((current) => (demoReports.some((report) => report.id === current) ? savedReports[0].id : current))
          setUploadForm((current) => savedReports.some((report) => String(report.id) === String(current.reportId))
            ? current
            : { ...current, reportId: savedReports[0].id })
        }
      })
      .catch((error) => { if (active) setReportsLoadError(error.message || 'Saved reports could not be loaded.') })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const syncActiveSection = () => {
      const section = window.location.hash.slice(1)
      setActiveSection(section === 'upload-evidence' ? 'details' : section || 'home')
    }
    window.addEventListener('hashchange', syncActiveSection)
    return () => window.removeEventListener('hashchange', syncActiveSection)
  }, [])

  useEffect(() => {
    const closeMenus = (event) => {
      if (event.type === 'keydown' && event.key === 'Escape') {
        setMobileMenuOpen(false)
        setAccountMenuOpen(false)
        setNotificationOpen(false)
        if (authMode) {
          setAuthMode('')
          setAuthError('')
        }
      }
      if (event.type === 'pointerdown') {
        if (!accountMenuRef.current?.contains(event.target)) setAccountMenuOpen(false)
        if (!notificationRef.current?.contains(event.target)) setNotificationOpen(false)
      }
    }
    document.addEventListener('keydown', closeMenus)
    document.addEventListener('pointerdown', closeMenus)
    return () => {
      document.removeEventListener('keydown', closeMenus)
      document.removeEventListener('pointerdown', closeMenus)
    }
  }, [authMode])

  useEffect(() => {
    let active = true
    const loadDiscussion = async () => {
      setDiscussion((current) => ({ ...current, loading: true, error: '', message: '' }))
      setReplyTarget(null)
      setEditingComment(null)
      setCommentDraft('')
      try {
        if (!['1', '2', '3'].includes(String(selectedReport.id))) {
          if (!account?.id) throw new Error('This report is still browser demo data. Sign in before registering its discussion; it is not persisted.')
          const registerResponse = await fetch(`${API_BASE}/api/discussions/register`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              reportId: String(selectedReport.id),
              category: selectedReport.type,
              location: selectedReport.location,
            }),
          })
          const registerData = await registerResponse.json()
          if (!registerResponse.ok) throw new Error(registerData.error || 'Discussion service is unavailable.')
        }

        const response = await fetch(`${API_BASE}/api/reports/${encodeURIComponent(selectedReport.id)}/comments?limit=50`, {
          credentials: 'include',
        })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Unable to load this discussion.')
        if (active) setDiscussion({ comments: data.comments || [], loading: false, error: '', message: '' })
      } catch (error) {
        if (active) setDiscussion({ comments: [], loading: false, error: error.message, message: '' })
      }
    }
    loadDiscussion()
    return () => { active = false }
  }, [selectedReport.id, selectedReport.type, selectedReport.location, account?.id])

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])

  useEffect(() => {
    if (!originalFile) {
      setOriginalPreviewUrl('')
      return undefined
    }
    const nextPreview = URL.createObjectURL(originalFile)
    setOriginalPreviewUrl(nextPreview)
    return () => URL.revokeObjectURL(nextPreview)
  }, [originalFile])

  const handleAuthSubmit = async (event) => {
    event.preventDefault()
    setAuthBusy(true)
    setAuthError('')
    try {
      const response = await fetch(`${API_BASE}/api/auth/${authMode}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(authForm),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Account request failed.')
      setAccount(data.account)
      setAuthForm({ displayName: '', email: '', password: '' })
      setAuthMode('')
      setAccountMenuOpen(false)
    } catch (error) {
      setAuthError(error.message)
    } finally {
      setAuthBusy(false)
    }
  }

  const handleSignOut = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', credentials: 'include' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to sign out.')
      setAccount(null)
      setAccountMenuOpen(false)
      setShowMyReports(false)
      setDiscussion((current) => ({ ...current, comments: current.comments.map((comment) => ({ ...comment, canEdit: false })) }))
    } catch (error) {
      setDiscussion((current) => ({ ...current, message: error.message }))
    }
  }

  const handleProfileUpdate = async (event) => {
    event.preventDefault()
    const displayName = profileName.trim()
    if (displayName.length < 2 || displayName.length > 40) {
      setAuthError('Display name must be between 2 and 40 characters.')
      return
    }
    setAuthBusy(true)
    setAuthError('')
    try {
      const response = await fetch(`${API_BASE}/api/auth/me`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to update your profile.')
      setAccount(data.account)
      setAuthMode('')
    } catch (error) {
      setAuthError(error.message)
    } finally {
      setAuthBusy(false)
    }
  }

  const handleCommentSubmit = async (event) => {
    event.preventDefault()
    if (!account) {
      setAuthMode('login')
      setAuthError('Sign in to join this discussion.')
      return
    }
    const text = commentDraft.trim()
    if (!text) {
      setDiscussion((current) => ({ ...current, message: 'Write a comment before submitting.' }))
      return
    }
    setCommentBusy(true)
    setDiscussion((current) => ({ ...current, message: '' }))
    try {
      const response = await fetch(`${API_BASE}/api/reports/${encodeURIComponent(selectedReport.id)}/comments`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, observation: commentObservation, replyTo: replyTarget?.id }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to save this comment.')
      setDiscussion((current) => ({
        ...current,
        comments: [...current.comments, data.comment].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)),
        message: 'Comment saved to the community discussion.',
      }))
      setCommentDraft('')
      setReplyTarget(null)
    } catch (error) {
      setDiscussion((current) => ({ ...current, message: error.message }))
    } finally {
      setCommentBusy(false)
    }
  }

  const handleCommentEdit = async (comment) => {
    const text = editingComment?.text?.trim()
    if (!text) return setDiscussion((current) => ({ ...current, message: 'Write a comment before saving.' }))
    try {
      const response = await fetch(`${API_BASE}/api/comments/${encodeURIComponent(comment.id)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.slice(0, 1000), observation: editingComment.observation }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to edit this comment.')
      setDiscussion((current) => ({
        ...current,
        comments: current.comments.map((entry) => entry.id === comment.id ? data.comment : entry),
        message: 'Comment updated.',
      }))
      setEditingComment(null)
    } catch (error) {
      setDiscussion((current) => ({ ...current, message: error.message }))
    }
  }

  const handleCommentDelete = async (comment) => {
    try {
      const response = await fetch(`${API_BASE}/api/comments/${encodeURIComponent(comment.id)}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to delete this comment.')
      setDiscussion((current) => ({
        ...current,
        comments: current.comments.filter((entry) => entry.id !== comment.id && entry.replyTo !== comment.id),
        message: 'Comment deleted.',
      }))
    } catch (error) {
      setDiscussion((current) => ({ ...current, message: error.message }))
    }
  }

  const handleCommentReport = async (comment) => {
    if (!account) {
      setAuthMode('login')
      setAuthError('Sign in to report a comment for moderation.')
      return
    }
    try {
      const response = await fetch(`${API_BASE}/api/comments/${encodeURIComponent(comment.id)}/report`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to report this comment.')
      setReportedCommentIds((current) => [...current, comment.id])
      setDiscussion((current) => ({ ...current, message: data.message || 'Comment reported for moderation.' }))
    } catch (error) {
      setDiscussion((current) => ({ ...current, message: error.message }))
    }
  }

  const handleChange = (event) => {
    const { name, value } = event.target
    setFormData((current) => ({ ...current, [name]: value }))
  }

  const handleReportEvidenceSelection = (event) => {
    const file = event.target.files?.[0] || null
    if (file && (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size === 0 || file.size > 10 * 1024 * 1024)) {
      event.target.value = ''
      setOriginalFile(null)
      setReportStatus({ type: 'error', message: 'Choose a JPEG, PNG, or WebP image up to 10MB.' })
      return
    }
    setOriginalFile(file)
    setReportStatus(file
      ? { type: 'info', message: 'Image selected. It will be attached after your report is saved.' }
      : { type: '', message: '' })
  }

  const handleUploadFieldChange = (event) => {
    const { name, value, type, checked } = event.target
    setUploadForm((current) => ({
      ...current,
      [name]: type === 'checkbox' ? checked : value,
    }))
  }

  const handleFileSelection = (event) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    const isAllowedType = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
    const isAllowedSize = file.size > 0 && file.size <= 10 * 1024 * 1024

    if (!isAllowedType || !isAllowedSize) {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      setPreviewUrl('')
      setUploadForm((current) => ({ ...current, file: null }))
      event.target.value = ''
      setUploadStatus({
        type: 'error',
        message: !isAllowedType ? 'Only JPEG, PNG, and WebP image files are permitted.' : 'That file is empty or larger than 10MB.',
      })
      return
    }

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
    }

    const nextPreview = URL.createObjectURL(file)
    setPreviewUrl(nextPreview)
    setUploadForm((current) => ({ ...current, file }))
    setUploadStatus({ type: 'info', message: 'Ready to submit. Review the privacy notice before uploading.' })
  }

  // Shared pipeline: validate -> server-signed Cloudinary upload -> server-verified save on the report.
  // Throws a user-safe Error on failure so callers can show it next to the form they came from.
  const uploadEvidenceFile = async ({ reportId, evidenceType, file }) => {
    const failUpload = (step, status, message) => {
      console.error(`[evidence upload] ${step} failed (HTTP ${status})`)
      return new Error(`${step} failed (HTTP ${status}): ${message}`)
    }
    const jsonPost = async (step, path, body) => {
      let response
      try {
        response = await fetch(`${API_BASE}${path}`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      } catch {
        throw failUpload(step, 'status unavailable', 'Check your connection and try again.')
      }
      const data = await readJson(response)
      if (!response.ok) throw failUpload(step, response.status, data.error || 'The server rejected this request.')
      return data
    }
    const validation = await jsonPost(
      'validate evidence',
      '/api/cloudinary/validate',
      { mimetype: file.type, size: file.size, reportId, evidenceType },
    )
    if (!validation.valid) throw failUpload('validate evidence', 200, validation.error || 'Image validation failed.')

    const signatureData = await jsonPost(
      'request upload signature',
      '/api/cloudinary/signature',
      { reportId, evidenceType },
    )
    if (!signatureData.signature || !signatureData.uploadUrl || !signatureData.publicId || !signatureData.allowedFormats || !signatureData.apiKey) {
      throw failUpload('request upload signature', 200, signatureData.error || 'The upload signature response was incomplete.')
    }

    // Field names/values must match exactly what the server signed.
    const body = new FormData()
    body.append('file', file)
    body.append('api_key', signatureData.apiKey)
    body.append('timestamp', String(signatureData.timestamp))
    body.append('signature', signatureData.signature)
    body.append('public_id', signatureData.publicId)
    body.append('allowed_formats', signatureData.allowedFormats)

    let uploadResponse
    try {
      uploadResponse = await fetch(signatureData.uploadUrl, { method: 'POST', body })
    } catch {
      throw failUpload('upload image to Cloudinary', 'status unavailable', 'Check your connection and try again.')
    }
    const cloudinaryResult = await readJson(uploadResponse)
    if (!uploadResponse.ok) {
      throw failUpload('upload image to Cloudinary', uploadResponse.status, cloudinaryResult.error?.message || 'Cloudinary rejected this image.')
    }
    if (cloudinaryResult.public_id !== signatureData.publicId) {
      throw failUpload('upload image to Cloudinary', uploadResponse.status, 'The uploaded image identifier did not match the signed identifier.')
    }

    const persistData = await jsonPost('save evidence to report', `/api/reports/${encodeURIComponent(reportId)}/evidence`, {
      publicId: cloudinaryResult.public_id,
      evidenceType,
    })
    if (!persistData.report) throw failUpload('save evidence to report', 201, "Your file reached storage but couldn't be saved to the report.")
    const savedEvidence = persistData.report.evidence?.[evidenceType]
    if (!savedEvidence?.url || savedEvidence.publicId !== cloudinaryResult.public_id) {
      throw failUpload('save evidence to report', 201, 'The server response did not include the saved image for this report.')
    }
    const savedReport = persistData.report
    setReports((currentReports) => [savedReport, ...currentReports.filter((report) => String(report.id) !== String(savedReport.id))])
    setSelectedReportId(savedReport.id)
    return savedReport
  }

  const clearPreview = () => {
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current)
      return ''
    })
  }

  const handleCloudinaryUpload = async (event) => {
    event.preventDefault()
    if (uploadInFlight.current) return
    const formElement = event.currentTarget
    const file = uploadForm.file
    if (!file) return setUploadStatus({ type: 'error', message: 'Choose an image before uploading evidence.' })
    if (!uploadForm.privacyAccepted) return setUploadStatus({ type: 'error', message: 'Please confirm the privacy reminder before uploading.' })
    if (!account?.id) return setUploadStatus({ type: 'error', message: 'Sign in before uploading evidence.' })
    if (!uploadReportId) return setUploadStatus({ type: 'error', message: 'Choose one of your saved reports. Demo examples cannot store evidence.' })

    uploadInFlight.current = true
    setUploadBusy(true)
    setUploadStatus({ type: 'info', message: 'Uploading your image securely…' })
    try {
      const savedReport = await uploadEvidenceFile({ reportId: uploadReportId, evidenceType: uploadForm.evidenceType, file })
      setUploadStatus({ type: 'success', message: `Your evidence has been uploaded and saved to the report near ${savedReport.location}.` })
      setUploadForm((current) => ({ ...current, file: null, privacyAccepted: false }))
      clearPreview()
      formElement.reset()
    } catch (error) {
      setUploadStatus({ type: 'error', message: error.message || "We couldn't upload your file. Please try again." })
    } finally {
      uploadInFlight.current = false
      setUploadBusy(false)
    }
  }

  const handleResolutionSubmit = (event) => {
    event.preventDefault()
    const claim = uploadForm.resolutionClaim.trim()

    if (!claim) {
      setUploadStatus({ type: 'error', message: 'Add a resolution note before submitting a claim.' })
      return
    }

    setReports((currentReports) =>
      currentReports.map((report) => {
        if (report.id !== selectedReport.id) {
          return report
        }

        return {
          ...report,
          status: 'Resolution Reported',
          evidence: {
            ...report.evidence,
            resolution: {
              claim,
              label: 'Resolution claim',
            },
            statusHistory: [
              ...(report.evidence?.statusHistory ?? []),
              {
                status: 'Resolution Reported',
                note: 'Community member filed a resolution note without automatic verification.',
                time: 'Now',
              },
            ],
          },
        }
      }),
    )

    setUploadForm((current) => ({ ...current, resolutionClaim: '' }))
    setUploadStatus({
      type: 'success',
      message: 'Resolution claim saved. This status reflects reported progress, not an official safety guarantee.',
    })
  }

  const handleVote = (voteType) => {
    const storageKey = 'shesafe-circle-votes'
    const savedVotes = JSON.parse(localStorage.getItem(storageKey) || '{}')

    if (savedVotes[selectedReport.id]) {
      setUploadStatus({
        type: 'error',
        message: 'A vote from this account has already been recorded for this report.',
      })
      return
    }

    savedVotes[selectedReport.id] = voteType
    localStorage.setItem(storageKey, JSON.stringify(savedVotes))

    setReports((currentReports) =>
      currentReports.map((report) => {
        if (report.id !== selectedReport.id) {
          return report
        }

        const nextVotes = { ...report.communityVotes }
        nextVotes[voteType] += 1

        return {
          ...report,
          userVote: voteType,
          communityVotes: nextVotes,
          status:
            voteType === 'stillPresent'
              ? 'Corroborated'
              : voteType === 'moreReview'
                ? 'Submitted'
                : report.status,
        }
      }),
    )

    setUploadStatus({
      type: 'success',
      message: 'Community corroboration recorded. This is not moderator verification.',
    })
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!formData.location.trim() || !formData.description.trim()) return
    if (!account?.id) {
      setAuthError('Sign in or create an account before submitting a report. Reports are saved securely to your account.')
      setAuthMode('login')
      return
    }
    if (reportInFlight.current) return
    reportInFlight.current = true
    setReportBusy(true)
    setReportStatus({ type: 'info', message: 'Saving your report…' })
    try {
      const response = await fetch(`${API_BASE}/api/reports`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: formData.type,
          location: formData.location.trim(),
          when: formData.time,
          urgency: formData.urgency,
          description: formData.description.trim(),
        }),
      })
      const data = await readJson(response)
      if (!response.ok || !data.report) throw new Error(data.error || 'Unable to save this report.')
      const nextReport = data.report
      setReports((current) => [nextReport, ...current.filter((report) => String(report.id) !== String(nextReport.id))])
      setSelectedReportId(nextReport.id)
      setUploadForm((current) => ({ ...current, reportId: nextReport.id }))
      setFormData({ type: 'Harassment', location: '', time: 'Tonight', urgency: 'High', description: '' })
      const fileToUpload = originalFile
      setOriginalFile(null)
      event.target.reset?.()
      if (fileToUpload) {
        try {
          await uploadEvidenceFile({ reportId: nextReport.id, evidenceType: 'original', file: fileToUpload })
          setReportStatus({ type: 'success', message: 'Your report and original evidence have been saved.' })
          setUploadStatus({ type: 'success', message: 'Your report and original evidence have been saved.' })
        } catch (uploadError) {
          clearPreview()
          setPreviewUrl(URL.createObjectURL(fileToUpload))
          setUploadForm((current) => ({
            ...current,
            reportId: nextReport.id,
            evidenceType: 'original',
            file: fileToUpload,
            privacyAccepted: false,
          }))
          setEvidenceDetailsOpen(true)
          const retryMessage = `Your report is saved, but its photo was not. Do not submit the report again. The image is ready to retry below: ${uploadError.message}`
          setReportStatus({ type: 'error', message: retryMessage })
          setUploadStatus({ type: 'error', message: retryMessage })
        }
      } else {
        setReportStatus({ type: 'success', message: 'Your report was saved. You can now attach original or follow-up evidence.' })
        setUploadStatus({ type: 'success', message: 'Your report was saved. You can now attach original or follow-up evidence.' })
      }
    } catch (error) {
      setReportStatus({ type: 'error', message: error.message || 'Unable to save this report. Check your connection and try again.' })
    } finally {
      reportInFlight.current = false
      setReportBusy(false)
    }
  }

  const selectReport = (report) => {
    setSelectedReportId(report.id)
    setActiveSection('details')
    document.querySelector('#details')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const openMyReports = () => {
    setShowMyReports(true)
    setShowAllReports(false)
    setActiveSection('community')
    setMobileMenuOpen(false)
    if (!account) {
      setAuthMode('login')
      setAuthError('Sign in to view your reports.')
      return
    }
    document.querySelector('#community')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="app-root min-h-screen bg-slate-950 text-slate-50">
      <header className="site-header">
        <div className="app-shell header-inner">
          <a href="#home" className="brand-link" aria-label="SheSafe Circle home">
            <BrandMark />
            <span className="brand-wordmark"><strong>SheSafe</strong><span>Circle</span></span>
          </a>

          <nav className="desktop-nav" aria-label="Main navigation">
            <a href="#home" className={`nav-link${activeSection === 'home' ? ' active' : ''}`} aria-current={activeSection === 'home' ? 'page' : undefined} onClick={() => { setActiveSection('home'); setShowMyReports(false) }}><Icon name="shield" size={15} />Home</a>
            <a href="#report" className={`nav-link${activeSection === 'report' ? ' active' : ''}`} aria-current={activeSection === 'report' ? 'page' : undefined} onClick={() => { setActiveSection('report'); setShowMyReports(false) }}><Icon name="file" size={15} />Report a concern</a>
            <a href="#community" className={`nav-link${activeSection === 'community' && !showMyReports ? ' active' : ''}`} aria-current={activeSection === 'community' && !showMyReports ? 'page' : undefined} onClick={() => { setActiveSection('community'); setShowMyReports(false); setShowAllReports(false) }}><Icon name="users" size={15} />Community</a>
            <a href="#community" className={`nav-link${showMyReports ? ' active' : ''}`} aria-current={showMyReports ? 'page' : undefined} onClick={openMyReports}>My Reports</a>
            <a href="#details" className={`nav-link${activeSection === 'details' ? ' active' : ''}`} aria-current={activeSection === 'details' ? 'page' : undefined} onClick={() => { setActiveSection('details'); setShowMyReports(false) }}>Evidence & Follow-ups</a>
          </nav>

          <div className="header-search">
            <Icon name="search" size={16} />
            <input
              aria-label="Search reports and locations"
              placeholder="Search reports, locations..."
              value={reportSearch}
              onChange={(event) => { setReportSearch(event.target.value); setShowMyReports(false); setShowAllReports(false) }}
              onKeyDown={(event) => { if (event.key === 'Enter') document.querySelector('#community')?.scrollIntoView({ behavior: 'smooth' }) }}
            />
            {reportSearch && <button type="button" aria-label="Clear search" onClick={() => setReportSearch('')}><Icon name="close" size={14} /></button>}
          </div>

          <div className="header-actions">
            <div className="notification-wrap" ref={notificationRef}>
              <button type="button" className="icon-button notification-button" aria-label="Notifications" aria-haspopup="dialog" aria-expanded={notificationOpen} onClick={() => setNotificationOpen((open) => !open)}>
                <Icon name="bell" size={18} />
                {reportNotifications.length > 0 && <span className="notification-dot" />}
              </button>
              {notificationOpen && (
                <div className="notification-popover" role="status">
                  <div className="popover-heading"><strong>Updates</strong><span>{reportNotifications.length}</span></div>
                  {reportNotifications.length ? reportNotifications.map((item) => (
                    <button key={item} type="button" onClick={() => { setNotificationOpen(false); document.querySelector('#details')?.scrollIntoView({ behavior: 'smooth' }) }}>{item}</button>
                  )) : <p>No new report updates.</p>}
                  <small>Based on the selected report. Demo data is labeled.</small>
                </div>
              )}
            </div>
            {account ? (
              <div className="account-menu-wrap" ref={accountMenuRef}>
                <button
                  type="button"
                  className="account-trigger"
                  aria-haspopup="menu"
                  aria-expanded={accountMenuOpen}
                  onClick={() => setAccountMenuOpen((open) => !open)}
                >
                  <span className="account-avatar" aria-hidden="true">{account.displayName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()}</span>
                  <span className="account-name">{account.displayName}</span>
                  <span aria-hidden="true">⌄</span>
                </button>
                {accountMenuOpen && (
                  <div className="account-dropdown" role="menu">
                    <button type="button" role="menuitem" onClick={() => { setAuthMode('profile'); setAccountMenuOpen(false) }}>My Profile</button>
                    <button type="button" role="menuitem" onClick={() => { setAccountMenuOpen(false); openMyReports() }}>My Reports</button>
                    <button type="button" role="menuitem" onClick={() => { setProfileName(account.displayName); setAuthError(''); setAuthMode('settings'); setAccountMenuOpen(false) }}>Account Settings</button>
                    <button type="button" role="menuitem" onClick={handleSignOut}>Sign Out</button>
                  </div>
                )}
              </div>
            ) : (
              <div className="signed-out-actions">
                <button type="button" className="sign-in-button" onClick={() => { setAuthError(''); setAuthMode('login') }}>Sign In</button>
                <button type="button" className="create-account-button" onClick={() => { setAuthError(''); setAuthMode('register') }}>Create Account</button>
              </div>
            )}
            <button type="button" className="mobile-menu-toggle icon-button" aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'} aria-expanded={mobileMenuOpen} onClick={() => setMobileMenuOpen((open) => !open)}>
              <Icon name={mobileMenuOpen ? 'close' : 'menu'} size={19} />
            </button>
          </div>
        </div>
        {mobileMenuOpen && (
          <nav className="mobile-nav app-shell" aria-label="Mobile navigation">
            <a href="#home" className={activeSection === 'home' ? 'active' : ''} aria-current={activeSection === 'home' ? 'page' : undefined} onClick={() => { setActiveSection('home'); setShowMyReports(false); setMobileMenuOpen(false) }}>Home</a>
            <a href="#report" className={activeSection === 'report' ? 'active' : ''} aria-current={activeSection === 'report' ? 'page' : undefined} onClick={() => { setActiveSection('report'); setShowMyReports(false); setMobileMenuOpen(false) }}>Report a concern</a>
            <a href="#community" className={activeSection === 'community' && !showMyReports ? 'active' : ''} aria-current={activeSection === 'community' && !showMyReports ? 'page' : undefined} onClick={() => { setActiveSection('community'); setShowMyReports(false); setShowAllReports(false); setMobileMenuOpen(false) }}>Community</a>
            <a href="#community" className={showMyReports ? 'active' : ''} aria-current={showMyReports ? 'page' : undefined} onClick={openMyReports}>My Reports</a>
            <a href="#details" className={activeSection === 'details' ? 'active' : ''} aria-current={activeSection === 'details' ? 'page' : undefined} onClick={() => { setActiveSection('details'); setShowMyReports(false); setMobileMenuOpen(false) }}>Evidence & Follow-ups</a>
          </nav>
        )}
      </header>

      {authMode && (
        <div className="auth-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setAuthMode(''); setAuthError('') } }}>
          <section className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-dialog-title">
            <button type="button" className="auth-close" aria-label="Close" onClick={() => { setAuthMode(''); setAuthError('') }}>×</button>
            {authMode === 'profile' || authMode === 'settings' ? (
              <>
                <p className="text-xs uppercase tracking-[0.16em] text-pink-300">Account</p>
                <h2 id="auth-dialog-title" className="mt-2 text-xl font-semibold text-white">{authMode === 'profile' ? 'My Profile' : 'Account Settings'}</h2>
                {authMode === 'profile' ? (
                  <dl className="account-details"><div><dt>Public display name</dt><dd>{account?.displayName}</dd></div></dl>
                ) : (
                  <form className="auth-form" onSubmit={handleProfileUpdate}>
                    <label>Public display name<input required minLength="2" maxLength="40" value={profileName} onChange={(event) => setProfileName(event.target.value)} /></label>
                    {authError && <p className="form-feedback error" role="alert">{authError}</p>}
                    <button type="submit" className="create-account-button" disabled={authBusy}>{authBusy ? 'Saving…' : 'Save display name'}</button>
                  </form>
                )}
                <p className="mt-3 text-xs text-slate-400">Only your public display name is shown. Passwords and session credentials are never displayed.</p>
              </>
            ) : (
              <>
                <p className="text-xs uppercase tracking-[0.16em] text-pink-300">SheSafe Circle account</p>
                <h2 id="auth-dialog-title" className="mt-2 text-xl font-semibold text-white">{authMode === 'register' ? 'Create account' : 'Sign in'}</h2>
                <p className="mt-2 text-sm text-slate-400">Accounts and sessions require the configured MongoDB service.</p>
                <form className="auth-form" onSubmit={handleAuthSubmit}>
                  {authMode === 'register' && (
                    <label>Display name<input autoComplete="name" required minLength="2" maxLength="40" value={authForm.displayName} onChange={(event) => setAuthForm((form) => ({ ...form, displayName: event.target.value }))} /></label>
                  )}
                  <label>Email<input type="email" autoComplete="email" required maxLength="254" value={authForm.email} onChange={(event) => setAuthForm((form) => ({ ...form, email: event.target.value }))} /></label>
                  <label>Password<input type="password" autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} required minLength={authMode === 'register' ? 10 : undefined} maxLength="128" value={authForm.password} onChange={(event) => setAuthForm((form) => ({ ...form, password: event.target.value }))} /></label>
                  {authError && <p className="form-feedback error" role="alert">{authError}</p>}
                  <button type="submit" className="create-account-button" disabled={authBusy}>{authBusy ? 'Please wait…' : authMode === 'register' ? 'Create Account' : 'Sign In'}</button>
                </form>
                <p className="auth-switch">
                  {authMode === 'register' ? 'Already have an account?' : 'New to SheSafe Circle?'}{' '}
                  <button type="button" onClick={() => { setAuthError(''); setAuthMode(authMode === 'register' ? 'login' : 'register') }}>{authMode === 'register' ? 'Sign in' : 'Create account'}</button>
                </p>
              </>
            )}
          </section>
        </div>
      )}

      <main id="home" className="app-shell main-shell">
        <section className="hero-grid hero-panel rounded-3xl border border-slate-800 bg-slate-900/70 shadow-soft">
          <div className="hero-copy">
            <div className="hero-emblem"><BrandMark /></div>
            <div className="hero-copy-content">
              <p className="eyebrow"><span className="status-dot" /> COMMUNITY SAFETY NETWORK</p>
              <h2 className="hero-title">Safer communities.<br /><span>Stronger together.</span></h2>
              <p className="hero-description">Report concerns, share evidence, and follow progress for safer spaces, for everyone.</p>
              <div className="hero-actions">
              <a
                href="#report"
                className="primary-action"
              >
                <Icon name="shield" size={16} /> Submit a Report
              </a>
              <a
                href="#community"
                className="secondary-action"
              >
                <Icon name="users" size={16} /> View Community Feed
              </a>
              </div>
            </div>
          </div>

          <div className="stats-panel">
            <div className="stats-heading">
              <div><p className="stats-kicker">COMMUNITY OVERVIEW</p><h3>Safety Statistics <span>(Demo Data)</span></h3></div>
            </div>

            <div className="stat-grid">
              {statCards.map((stat, index) => (
                <div key={stat.label} className={`stat-card stat-card-${index}`}>
                  <span className="stat-icon"><Icon name={index === 0 ? 'file' : index === 1 ? 'route' : 'users'} size={19} /></span>
                  <p className="stat-value">{stat.value}</p>
                  <p className="stat-label">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="content-grid" aria-label="Safety dashboard">
          <div className="dashboard-workspace">
          <div id="report" className="glass-panel report-panel rounded-3xl p-5 sm:p-6">
            <div className="panel-heading">
              <div>
                <p className="panel-eyebrow"><Icon name="shield" size={14} /> SAFETY REPORT</p>
                <h3 className="panel-title">Submit a Safety Report</h3>
              </div>
              <span className="form-access-chip">{account ? 'SAVED TO YOUR ACCOUNT' : 'SIGN IN TO SUBMIT'}</span>
            </div>
            <p className="report-demo-note">Share a nearby landmark or general area. Avoid home addresses and identifying details.</p>

            <div className="report-fields">
              <form className="report-submission-form" onSubmit={handleSubmit}>
              <div>
                <label className="field-label" htmlFor="report-category">Category <span>*</span></label>
                <select
                  id="report-category"
                  name="type"
                  value={formData.type}
                  onChange={handleChange}
                  required
                  className="w-full rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none ring-0 transition focus:border-pink-400 min-h-[48px]"
                >
                  {reportTypes.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="field-label" htmlFor="report-location">Location <span>*</span></label>
                <input
                  id="report-location"
                  type="text"
                  name="location"
                  value={formData.location}
                  onChange={handleChange}
                  placeholder="Enter location (e.g., area, landmark)"
                  required
                  maxLength="160"
                  className="w-full rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none transition focus:border-pink-400 min-h-[48px]"
                />
              </div>

              <div className="report-inline-fields">
                <div>
                  <label className="field-label" htmlFor="report-time">When</label>
                  <input
                    id="report-time"
                    type="text"
                    name="time"
                    value={formData.time}
                    onChange={handleChange}
                    placeholder="e.g., Today at 6pm"
                    maxLength="80"
                    className="w-full rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none transition focus:border-pink-400 min-h-[48px]"
                  />
                </div>
                <div>
                  <label className="field-label" htmlFor="report-urgency">Urgency Level <span>*</span></label>
                  <select
                    id="report-urgency"
                    name="urgency"
                    value={formData.urgency}
                    onChange={handleChange}
                    required
                    className="w-full rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none transition focus:border-pink-400 min-h-[48px]"
                  >
                    <option value="High">High</option>
                    <option value="Medium">Medium</option>
                    <option value="Low">Low</option>
                  </select>
                </div>
              </div>

              <div>
                <div className="field-label-row"><label className="field-label" htmlFor="report-description">Description <span>*</span></label><span className="field-counter">{formData.description.length}/1000</span></div>
                <textarea
                  id="report-description"
                  name="description"
                  value={formData.description}
                  onChange={handleChange}
                  rows="4"
                  maxLength="1000"
                  required
                  placeholder="Describe what happened, when it occurred, and any immediate concerns..."
                  className="w-full rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-pink-400 min-h-[112px]"
                />
              </div>

              <div>
                <label className="field-label" htmlFor="report-original-evidence">Original evidence <span className="optional-hint">(optional)</span></label>
                <input
                  id="report-original-evidence"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleReportEvidenceSelection}
                  className="w-full rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-slate-100"
                />
                <p className="upload-helper">JPEG, PNG or WebP · up to 10MB. Sharing evidence is optional; check for faces, plates, or other identifying details first.</p>
                {originalPreviewUrl && <img src={originalPreviewUrl} alt="Preview of selected original evidence" className="original-evidence-preview" />}
                {reportStatus.message && <p className={`upload-inline-status status-${reportStatus.type}`} role={reportStatus.type === 'error' ? 'alert' : 'status'}>{reportStatus.message}</p>}
              </div>

              <button
                type="submit"
                className="primary-action report-submit"
                disabled={reportBusy}
              >
                <Icon name="shield" size={16} /> {reportBusy ? (originalFile ? 'Saving report and photo…' : 'Saving report…') : 'Submit Report'}
              </button>
              </form>

              <details id="upload-evidence" className="report-upload-details" open={evidenceDetailsOpen} onToggle={(event) => setEvidenceDetailsOpen(event.currentTarget.open)}>
                <summary><span><Icon name="upload" size={16} /> Upload Evidence <small>(Optional)</small></span><Icon name="chevron" size={16} /></summary>
                <p className="upload-helper">Add a photo or image to a saved report you own. Maximum 10MB per image. Demo reports cannot accept uploads.</p>
                {!account?.id && <p className="report-demo-note">Sign in to upload evidence to your saved reports.</p>}
                {account?.id && persistentReports.length === 0 && <p className="report-demo-note">Create and save a report first. Demo examples cannot store evidence.</p>}
                <form onSubmit={handleCloudinaryUpload} className="report-evidence-form">
                  <div className="report-inline-fields">
                    <label className="upload-select-label">Link to report
                      <select name="reportId" value={String(uploadReportId)} onChange={handleUploadFieldChange} className="field-control" disabled={!account?.id || persistentReports.length === 0}>
                        {persistentReports.map((report) => <option key={report.id} value={report.id}>{report.location} · {report.title}</option>)}
                      </select>
                    </label>
                    <label className="upload-select-label">Evidence type
                      <select name="evidenceType" value={uploadForm.evidenceType} onChange={handleUploadFieldChange} className="field-control">
                        <option value="original">Original evidence</option><option value="followUp">Follow-up evidence</option>
                      </select>
                    </label>
                  </div>
                  <label className="dropzone-compact">
                    <Icon name="upload" size={20} />
                    <span>{uploadForm.file?.name || 'Choose an image or drag it here'}</span>
                    <small>JPEG, PNG or WebP · up to 10MB</small>
                    <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFileSelection} />
                  </label>
                  {previewUrl && <img src={previewUrl} alt="Selected evidence preview" className="upload-preview-small" />}
                  <label className="privacy-confirm"><input type="checkbox" name="privacyAccepted" checked={uploadForm.privacyAccepted} onChange={handleUploadFieldChange} /> Review identifying information before sharing.</label>
                  <button type="submit" className="secondary-action upload-submit" disabled={uploadBusy || !account?.id || persistentReports.length === 0}><Icon name="upload" size={15} />{uploadBusy ? 'Uploading…' : 'Upload Evidence'}</button>
                  {uploadStatus.message && <p className={`upload-inline-status status-${uploadStatus.type}`} role={uploadStatus.type === 'error' ? 'alert' : 'status'}>{uploadStatus.message}</p>}
                </form>
              </details>

            </div>
          </div>

          <div id="community" className="glass-panel feed-panel">
            <div className="feed-heading">
              <div className="feed-title-wrap"><span className="heading-icon teal"><Icon name="users" size={18} /></span><div><p className="panel-eyebrow">COMMUNITY</p><h3 className="panel-title">{showMyReports ? 'My Reports' : 'Community Reports'}</h3></div></div>
              <span className="report-count">Showing {displayedReports.length} of {filteredReports.length} reports</span>
            </div>
            <p className="feed-demo-note">{persistentReports.length ? 'Saved reports appear before illustrative examples. Demo reports are clearly labeled and are not verified incidents.' : 'Illustrative examples are for preview only; they are not verified active incidents.'}</p>
            {reportsLoadError && <p className="report-demo-note" role="alert">Saved reports could not be loaded: {reportsLoadError}</p>}
            <div className="feed-controls">
              <label className="category-filter"><Icon name="filter" size={15} /><select aria-label="Filter reports by category" value={categoryFilter} onChange={(event) => { setCategoryFilter(event.target.value); setShowAllReports(false) }}>{feedCategories.map((category) => <option key={category}>{category}</option>)}</select><Icon name="chevron" size={14} /></label>
              <button type="button" className="feed-search-button" aria-label="Focus report search" onClick={() => document.querySelector('.header-search input')?.focus()}><Icon name="search" size={16} /><span>Search</span></button>
            </div>

            <div className="feed-list">
              {filteredReports.length === 0 && <p className="empty-state feed-empty">{showMyReports ? 'You do not have any saved reports yet.' : 'No reports match these filters. Clear the search or choose all categories.'}</p>}
              {displayedReports.map((report) => {
                const uploadedThumbnail = [report.evidence?.original, report.evidence?.followUp].find((item) => item?.url && !item.publicId?.startsWith('demo-'))
                const thumbnail = uploadedThumbnail?.url || (report.persistent ? '' : createDemoEvidencePlaceholder(`${report.type} · demo thumbnail`))
                const evidenceCount = [report.evidence?.original, report.evidence?.followUp].filter((item) => item?.url).length
                const commentCount = report.id === selectedReport.id ? displayedComments.length : null
                return (
                  <button key={report.id} data-report-id={String(report.id)} type="button" onClick={() => selectReport(report)} className={`report-card${selectedReport.id === report.id ? ' selected' : ''}`} aria-label={`View details for ${report.title}`}>
                    {thumbnail
                      ? <img className="report-thumbnail" src={thumbnail} alt={`${report.type} report thumbnail`} loading="lazy" onError={(event) => { event.currentTarget.style.visibility = 'hidden' }} />
                      : <span className="report-thumbnail report-thumbnail-empty" aria-label="No photo added"><Icon name="file" size={22} /><small>No photo</small></span>}
                    <span className="report-card-content">
                      <span className="report-card-top"><strong>{report.title}</strong><span className={`urgency-chip urgency-${report.urgency.toLowerCase()}`}>{report.urgency}</span></span>
                      <span className="report-badges"><span className="category-chip">{report.type}</span><span className={`status-chip status-${(report.feedStatus || report.status).toLowerCase().replaceAll(' ', '-')}`}>{report.feedStatus || report.status}</span>{!report.persistent && <span className="demo-label">Demo example</span>}</span>
                      <span className="report-card-location"><Icon name="pin" size={13} />{report.location}<span className="report-time"><Icon name="clock" size={12} />{report.time}</span></span>
                      <span className="report-card-summary">{report.summary}</span>
                      <span className="report-card-bottom"><span><Icon name="file" size={13} />{evidenceCount ? `${evidenceCount} evidence item${evidenceCount === 1 ? '' : 's'}` : 'No evidence attached'}{commentCount !== null && ` · ${commentCount} ${commentCount === 1 ? 'comment' : 'comments'}`}</span><span className="open-report">View details <Icon name="arrow" size={13} /></span></span>
                    </span>
                  </button>
                )
              })}
            </div>
            {filteredReports.length > 6 && (
              <button type="button" className="show-more-reports" onClick={() => setShowAllReports((showing) => !showing)}>
                {showAllReports ? 'Show fewer reports' : `Show ${filteredReports.length - displayedReports.length} more reports`}
              </button>
            )}
            {showMyReports && <p className="track-demo-note">My Reports shows reports saved by your account when signed in.</p>}
          </div>

          <section className="glass-panel discussion-section" aria-labelledby="discussion-heading">
            <div className="discussion-heading-row">
              <div>
                <p className="panel-eyebrow"><Icon name="message" size={14} /> COMMUNITY OBSERVATIONS</p>
                <h4 id="discussion-heading" className="discussion-title">Community Discussion <span className="comment-count">{displayedComments.length} {discussion.error && displayedComments.some((comment) => comment.id.startsWith('demo-')) ? 'demo' : 'comments'}</span></h4>
              </div>
              <label className="sort-control"><span>Sort</span><select aria-label="Sort discussion comments" value={discussionSort} onChange={(event) => setDiscussionSort(event.target.value)}><option value="newest">Newest First</option><option value="oldest">Oldest First</option></select><Icon name="chevron" size={13} /></label>
            </div>
            <p className="discussion-safety-note">Community observations are not official verification or a safety guarantee.</p>
            {discussion.loading ? (
              <p className="empty-state" role="status">Loading discussion…</p>
            ) : (
              <>
                {discussion.error && (
                  <p className="discussion-service-notice" role="status">
                    {discussion.error} Comments are not saved without MongoDB. Any sample comments below are illustrative demo text, not real reports.
                  </p>
                )}
                {displayedComments.length === 0 ? (
                  <p className="empty-state">No comments yet. Share a respectful observation about this location.</p>
                ) : (
                  <ol className="comment-list" aria-label="Comments in chronological order">
                    {sortedComments.map((comment) => (
                      <li key={comment.id} className="comment-entry">
                        <div className="comment-meta">
                          <span className="comment-author">{comment.displayName}</span>
                          <time dateTime={comment.createdAt}>{new Date(comment.createdAt).toLocaleString()}</time>
                        </div>
                        {editingComment?.id === comment.id ? (
                          <div className="comment-edit-form">
                            <textarea aria-label="Edit comment" maxLength="1000" value={editingComment.text} onChange={(event) => setEditingComment((current) => ({ ...current, text: event.target.value }))} />
                            <select aria-label="Community observation" value={editingComment.observation} onChange={(event) => setEditingComment((current) => ({ ...current, observation: event.target.value }))}>
                              {observationOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                            </select>
                            <button type="button" onClick={() => handleCommentEdit(comment)}>Save edit</button>
                            <button type="button" className="quiet-button" onClick={() => setEditingComment(null)}>Cancel</button>
                          </div>
                        ) : (
                          <>
                            <span className={`observation-badge observation-${comment.observation}`}>{observationOptions.find((option) => option.value === comment.observation)?.label || 'Observation'}</span>
                            {comment.moderationStatus === 'needs-review' && <span className="moderation-badge">Flagged for review</span>}
                            {comment.replyTo && <span className="reply-context">Reply to {discussion.comments.find((entry) => entry.id === comment.replyTo)?.displayName || 'community member'}</span>}
                            <p className="comment-text">{comment.text}</p>
                            {!comment.id.startsWith('demo-') && (
                              <div className="comment-actions">
                                <button type="button" onClick={() => {
                                  if (!account) {
                                    setAuthMode('login')
                                    setAuthError('Sign in to reply to a community comment.')
                                    return
                                  }
                                  setReplyTarget(comment)
                                  setCommentDraft('')
                                  document.querySelector('#community-comment')?.focus()
                                }}>Reply</button>
                                {comment.canEdit && <button type="button" onClick={() => setEditingComment({ id: comment.id, text: comment.text, observation: comment.observation })}>Edit</button>}
                                {comment.canEdit && <button type="button" onClick={() => handleCommentDelete(comment)}>Delete</button>}
                                {!comment.canEdit && <button type="button" disabled={reportedCommentIds.includes(comment.id)} onClick={() => handleCommentReport(comment)}>{reportedCommentIds.includes(comment.id) ? 'Reported' : 'Report comment'}</button>}
                              </div>
                            )}
                          </>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </>
            )}

            <form className="comment-form" onSubmit={handleCommentSubmit}>
              <div className="composer-avatar" aria-hidden="true">{account ? account.displayName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() : <Icon name="users" size={16} />}</div>
              <div className="comment-composer-fields">
                <label htmlFor="community-comment">Share a location observation</label>
                {replyTarget && <p className="replying-to">Replying to {replyTarget.displayName} <button type="button" onClick={() => setReplyTarget(null)}>Cancel reply</button></p>}
                <select id="comment-observation" aria-label="Choose your observation" value={commentObservation} onChange={(event) => setCommentObservation(event.target.value)}>
                  {observationOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                <textarea id="community-comment" maxLength="1000" value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} placeholder={account ? 'Share a respectful, location-specific observation…' : 'Sign in to add an observation…'} disabled={!account} />
                <div className="comment-form-footer">
                  <span>{commentDraft.length}/1000 · {account ? `Posting as ${account.displayName}` : <button type="button" className="discussion-link" onClick={() => { setAuthMode('login'); setAuthError('Sign in to join this discussion.') }}>Sign in to comment</button>}</span>
                  <button type="submit" className="primary-action comment-submit" disabled={!account || commentBusy}><Icon name="arrow" size={14} />{commentBusy ? 'Submitting…' : 'Post Comment'}</button>
                </div>
              </div>
            </form>
            {discussion.message && <p className="discussion-message" role="status">{discussion.message}</p>}
          </section>
          </div>

          <aside id="details" className="glass-panel details-panel rounded-3xl p-4 sm:p-5">
            <div className="proofloop-header">
              <div className="proofloop-title-row">
                <div className="feed-title-wrap"><span className="heading-icon purple"><Icon name="shield" size={18} /></span><div><p className="panel-eyebrow">REPORT TRACKING</p><h3 className="panel-title">ProofLoop</h3></div></div>
              <span className={`proofloop-status${selectedReport.moderatorVerification?.verified ? ' verified' : ''}`}>{selectedReport.moderatorVerification?.verified ? 'Moderator verified' : 'Not independently verified'}</span>
              </div>
            </div>

              <div className="proofloop-grid">
            <div className="proofloop-section-card summary-card">
              <div className="proof-summary-title">
                <div>
                  <p className="proof-section-label"><Icon name="file" size={14} /> REPORT SUMMARY {!selectedReport.persistent && <span className="demo-chip mini">DEMO</span>}</p>
                  <h4 className="selected-report-title">{selectedReport.title || `${selectedReport.type} concern`}</h4>
                  <p className="selected-report-category">{selectedReport.type}</p>
                  <p className="proof-location"><Icon name="pin" size={13} />General area: {selectedReport.location}</p>
                </div>
                <span className={`urgency-chip urgency-${selectedReport.urgency.toLowerCase()}`}>
                  {selectedReport.urgency}
                </span>
              </div>

              <div className="summary-meta text-xs text-slate-300">
                <div><span className="summary-label">Status</span>{selectedReport.status}</div>
                <div><span className="summary-label">Reported by</span>{selectedReport.author} · {selectedReport.time}</div>
                <div><span className="summary-label">Description</span>{selectedReport.summary}</div>
              </div>
              <details className="report-context">
                <summary>Additional report information</summary>
                <p>{selectedReport.details}</p>
                <p>{selectedReport.support}</p>
              </details>
            </div>

            <div className="proofloop-section-card timeline-section">
              <div className="proofloop-section-header">
                <p className="proof-section-label"><Icon name="route" size={14} /> EVIDENCE TIMELINE</p>
                <button type="button" className="tiny-link" onClick={() => document.querySelector('#details')?.scrollIntoView({ behavior: 'smooth' })}>View All <Icon name="arrow" size={12} /></button>
              </div>

              <div className="timeline-list">
                {statusSequence.map((statusItem) => {
                  const hasStep =
                    (selectedReport.evidence?.statusHistory ?? []).some(
                      (entry) => statusItem.statuses.includes(entry.status),
                    ) || statusItem.statuses.includes(selectedReport.status)
                  const currentIndex = statusSequence.findIndex((step) => step.statuses.includes(selectedReport.status))
                  const isCurrent = statusItem.statuses.includes(selectedReport.status)
                  const isPending = !hasStep && statusSequence.indexOf(statusItem) > currentIndex

                  return (
                    <div
                      key={statusItem.label}
                      className={`timeline-item ${hasStep ? 'is-complete' : 'is-pending'} ${isCurrent ? 'is-current' : ''}`}
                    >
                      <span className="timeline-point">{hasStep ? <Icon name="check" size={10} /> : <span>{statusSequence.indexOf(statusItem) + 1}</span>}</span>
                      <div className="timeline-content">
                        <p className="timeline-status">{statusItem.label}</p>
                        {isCurrent && <span className="timeline-current">Current</span>}
                        {isPending && <span className="timeline-pending-label">Pending</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
              {(selectedReport.evidence?.statusHistory ?? []).length > 0 && (
                <ol className="timeline-history" aria-label="Report activity">
                  {[...(selectedReport.evidence.statusHistory ?? [])].reverse().map((entry, index) => (
                    <li key={`${entry.status}-${index}`}>
                      <strong>{entry.status}</strong>
                      <span>{entry.note}</span>
                      <time>{typeof entry.time === 'string' ? entry.time : entry.time ? new Date(entry.time).toLocaleString() : 'Time unavailable'}</time>
                    </li>
                  ))}
                </ol>
              )}

              <div className="compact-disclaimer">
                Evidence stage only—not verified safety or authority action.
              </div>
            </div>

            <div className="proofloop-section-card corroboration-section">
              <div className="proofloop-section-header"><p className="proof-section-label"><Icon name="users" size={14} /> CORROBORATION <span className="demo-chip mini">DEMO</span></p><button type="button" className="tiny-link" onClick={() => document.querySelector('.discussion-section')?.scrollIntoView({ behavior: 'smooth' })}>View Details <Icon name="arrow" size={12} /></button></div>
              <div className="vote-grid mt-2">
                {[
                  { key: 'stillPresent', label: 'Still present' },
                  { key: 'appearsResolved', label: 'Appears resolved' },
                  { key: 'moreReview', label: 'More review' },
                ].map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    className="vote-button rounded-xl border border-slate-600 bg-slate-800 px-2 py-2.5 text-left text-[11px] text-slate-200 hover:border-pink-400"
                    onClick={() => handleVote(option.key)}
                  >
                    <span className="block font-medium text-white">{voteSummary[option.key]}</span>
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="corroboration-disclaimer">Feedback is not moderator verification.</p>
            </div>

            <div className="duplicate-notice proofloop-section-card">
              <p className="proof-section-label"><Icon name="alert" size={14} /> DUPLICATE HANDLING <span className="demo-chip mini">DEMO</span></p>
              <p className="proof-compact-copy">Duplicate matching unavailable for demo reports.</p>
            </div>

            <div className="proofloop-section-card resolution-section">
              <p className="proof-section-label"><Icon name="file" size={14} /> RESOLUTION CLAIM</p>
              <p className="proof-compact-copy">{selectedReport.evidence?.resolution?.claim || 'No resolution claim submitted.'}</p>
              <p className="proof-disclaimer">A reported claim is not official verification.</p>
            </div>

            <div className="proofloop-section-card evidence-comparison">
              <div className="proofloop-section-header"><p className="proof-section-label"><Icon name="file" size={14} /> ORIGINAL & FOLLOW-UP EVIDENCE</p><a className="tiny-link" href="#upload-evidence">Add evidence <Icon name="arrow" size={12} /></a></div>
              <div className="evidence-grid mt-3">
                {[
                  { key: 'original', title: 'Original Evidence' },
                  { key: 'followUp', title: 'Follow-up Evidence' },
                ].map(({ key, title }) => {
                  const evidence = selectedReport.evidence?.[key]
                  return <div className="evidence-card" key={key}>
                    {evidence?.url ? <a href={evidence.url} target="_blank" rel="noreferrer"><img src={evidence.url} alt={`${title} for ${selectedReport.location}`} className="evidence-thumb" loading="lazy" onError={(event) => { event.currentTarget.replaceWith(Object.assign(document.createElement('span'), { className: 'evidence-empty', textContent: 'This image could not be loaded. Try again later.' })) }} /></a> : <div className="evidence-empty"><Icon name="file" size={18} /><span>No {key === 'original' ? 'original' : 'follow-up'} evidence</span></div>}
                    <p className="evidence-label">{title}{evidence?.publicId?.startsWith('demo-') ? ' · Demo image' : evidence?.url ? ' · Uploaded' : ' · Not provided'}</p>
                    {evidence?.uploadedAt && <time className="evidence-time">{new Date(evidence.uploadedAt).toLocaleString()}</time>}
                  </div>
                })}
              </div>
            </div>

            <section className="proofloop-section-card action-resolution-card">
              <div className="action-card-heading"><span className="heading-icon teal"><Icon name="shield" size={16} /></span><div><p className="proof-section-label">EVIDENCE & RESOLUTION ACTIONS</p><p className="upload-summary-note">Review identifying details before sharing.</p></div></div>
              <a className="upload-jump-link" href="#upload-evidence"><Icon name="upload" size={14} /> Upload or review evidence <Icon name="arrow" size={13} /></a>
              <details className="resolution-action-disclosure">
                <summary><Icon name="file" size={13} /> Submit a resolution claim <Icon name="chevron" size={13} /></summary>
                <form onSubmit={handleResolutionSubmit} className="upload-form resolution-form">
                  <label className="field-label" htmlFor="resolution-claim">Community-reported outcome <span className="demo-chip mini">UNVERIFIED</span></label>
                  <textarea
                    id="resolution-claim"
                    name="resolutionClaim"
                    value={uploadForm.resolutionClaim}
                    onChange={handleUploadFieldChange}
                    rows="2"
                    maxLength="500"
                    placeholder="Add a resolution note. This is not official verification."
                    className="w-full rounded-2xl border border-slate-700 bg-slate-900/80 px-3 py-2 text-slate-100"
                  />
                  <button type="submit" className="secondary-action resolution-submit"><Icon name="file" size={15} /> Record Resolution Claim</button>
                </form>
              </details>
              {uploadStatus.message && <p className={`upload-inline-status status-${uploadStatus.type}`} role="status">{uploadStatus.message}</p>}
            </section>

            </div>
          </aside>

        </section>
      </main>

      <footer className="site-footer">
        <div className="app-shell footer-inner">
          <div className="footer-groups">
            <section className="footer-brand-group">
              <a href="#home" className="footer-brand-lockup"><BrandMark small /><span><strong>SheSafe</strong> Circle</span></a>
              <p>A community-powered platform for sharing safety concerns, supporting one another, and tracking reported issues.</p>
            </section>
            <nav className="footer-link-group" aria-label="Quick navigation">
              <h3>Quick Navigation</h3>
              <a href="#home">Home</a>
              <a href="#report">Report an Incident</a>
              <a href="#community">Community</a>
              <a href="#community" onClick={() => { if (account) setShowMyReports(true); else { setAuthMode('login'); setAuthError('Sign in to view your reports.') } }}>Track Reports</a>
              <button type="button" onClick={() => { if (account) setAuthMode('profile'); else { setAuthMode('login'); setAuthError('Sign in to view your profile.') } }}>My Profile</button>
            </nav>
            <section className="footer-safety-group">
              <h3>Safety & Information</h3>
              <div className="footer-disclaimer"><Icon name="info" size={16} /><p>Community reports do not guarantee immediate assistance or replace emergency services or official authorities.</p></div>
              <p className="footer-availability">Demo report content is illustrative; account and comment storage requires the configured MongoDB service.</p>
            </section>
          </div>
          <div className="footer-bottom"><span>© {new Date().getFullYear()} SheSafe Circle. All rights reserved.</span><span>Community powered · Privacy mindful</span></div>
        </div>
      </footer>
    </div>
  )
}

export default App

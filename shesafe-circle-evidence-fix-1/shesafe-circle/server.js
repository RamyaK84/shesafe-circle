import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { v2 as cloudinary } from 'cloudinary'
import { MongoClient, ObjectId } from 'mongodb'
import session from 'express-session'
import MongoStore from 'connect-mongo'
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

dotenv.config()

const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp']
const maxFileSizeBytes = 10 * 1024 * 1024
const scrypt = promisify(scryptCallback)
const commentStatuses = new Set(['still-present', 'appears-resolved', 'needs-review'])
const maxCommentLength = 1000
const rateLimitBuckets = new Map()

const app = express()
const port = Number(process.env.PORT || 3001)
let db = null
let mongoClient = null

if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1)
}

app.use(cors({
  origin(origin, callback) {
    const configuredOrigins = (process.env.CLIENT_ORIGINS || process.env.CLIENT_ORIGIN || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
    const developmentOrigin = origin && (() => {
      try {
        const parsed = new URL(origin)
        return ['localhost', '127.0.0.1'].includes(parsed.hostname)
      } catch {
        return false
      }
    })()

    if (!origin || configuredOrigins.includes(origin) || (process.env.NODE_ENV !== 'production' && developmentOrigin)) {
      callback(null, true)
      return
    }

    const originError = new Error('This origin is not allowed to access the SheSafe Circle API.')
    originError.status = 403
    callback(originError)
  },
  credentials: true,
}))
app.use((req, res, next) => {
  if (req.method !== 'POST') return next()
  const step = req.path === '/api/cloudinary/validate'
    ? 'validate evidence'
    : req.path === '/api/cloudinary/signature'
      ? 'request upload signature'
      : /^\/api\/reports\/[^/]+\/evidence$/.test(req.path)
        ? 'save evidence to report'
        : ''
  if (step) {
    res.on('finish', () => {
      if (res.statusCode >= 400) console.error(`[evidence upload] ${step} failed (HTTP ${res.statusCode})`)
    })
  }
  return next()
})
app.use(express.json({ limit: '12mb' }))
let sessionMiddleware = null
app.use((req, res, next) => {
  if (sessionMiddleware) return sessionMiddleware(req, res, next)
  return next()
})

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

const cloudinaryConfigured = () => Boolean(
  process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET,
)

const requireCloudinary = (_req, res, next) => {
  if (!cloudinaryConfigured()) {
    res.status(503).json({ error: 'Image uploads are unavailable because Cloudinary is not configured on the server.' })
    return
  }
  next()
}

const evidenceFolderFor = (reportId) => `shesafe-circle/${reportId}`
const allowedEvidenceFormats = new Set(['jpg', 'jpeg', 'png', 'webp'])

const databaseUnavailable = (_req, res, next) => {
  if (!db) {
    res.status(503).json({ error: 'Accounts and discussions are unavailable until MongoDB is configured.' })
    return
  }
  next()
}

const requireAccount = (req, res, next) => {
  if (!req.session?.accountId) {
    res.status(401).json({ error: 'Sign in to continue.' })
    return
  }
  next()
}

const requireTrustedBrowserOrigin = (req, res, next) => {
  const origin = req.get('origin')
  if (!origin) return next()
  const configuredOrigins = (process.env.CLIENT_ORIGINS || process.env.CLIENT_ORIGIN || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  let parsedOrigin
  try {
    parsedOrigin = new URL(origin)
  } catch {
    parsedOrigin = null
  }
  const localDevelopmentOrigin = process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(parsedOrigin?.hostname)
  if (!configuredOrigins.includes(origin) && !localDevelopmentOrigin) {
    return res.status(403).json({ error: 'This browser origin is not allowed to change account or discussion data.' })
  }
  return next()
}

const rateLimit = (key, maxRequests, windowMs) => (req, res, next) => {
  const now = Date.now()
  const bucketKey = `${key}:${req.ip}`
  const current = rateLimitBuckets.get(bucketKey)
  if (!current || now - current.startedAt >= windowMs) {
    rateLimitBuckets.set(bucketKey, { startedAt: now, count: 1 })
  } else if (current.count >= maxRequests) {
    res.set('Retry-After', String(Math.ceil((windowMs - (now - current.startedAt)) / 1000)))
    return res.status(429).json({ error: 'Too many requests. Please try again later.' })
  } else {
    current.count += 1
  }
  if (rateLimitBuckets.size > 10000) {
    for (const [entryKey, entry] of rateLimitBuckets) {
      if (now - entry.startedAt >= windowMs) rateLimitBuckets.delete(entryKey)
    }
  }
  return next()
}

const cleanText = (value, maxLength) => {
  if (typeof value !== 'string') return ''
  return [...value].filter((character) => {
    const code = character.codePointAt(0)
    return code >= 32 && code !== 127
  }).join('').trim().slice(0, maxLength)
}

const publicComment = (comment, currentAccountId) => ({
  id: comment._id.toString(),
  reportId: comment.reportId,
  displayName: comment.displayName,
  text: comment.text,
  observation: comment.observation,
  replyTo: comment.replyTo || null,
  createdAt: comment.createdAt,
  updatedAt: comment.updatedAt,
  canEdit: Boolean(currentAccountId && comment.authorId.toString() === currentAccountId),
  moderationStatus: comment.moderationStatus,
})

const findPublicReport = async (reportId) => db.collection('discussionReports').findOne({ reportId })

const publicEvidence = (item) => (item
  ? {
      url: item.url,
      publicId: item.publicId,
      label: item.label,
      evidenceType: item.evidenceType,
      format: item.format || '',
      bytes: Number.isFinite(item.bytes) ? item.bytes : null,
      uploadedAt: item.uploadedAt,
    }
  : null)

const publicReport = (report) => ({
  id: report.reportId,
  title: report.title,
  type: report.category,
  category: report.category,
  location: report.location,
  time: report.when || 'Recently',
  urgency: report.urgency || 'Medium',
  status: report.status || 'Submitted',
  feedStatus: report.status || 'Submitted',
  summary: report.description || '',
  details: report.description || '',
  author: report.authorName || 'Community member',
  authorId: report.createdBy?.toString?.() || null,
  persistent: true,
  demo: false,
  communityVotes: report.communityVotes || { stillPresent: 0, appearsResolved: 0, moreReview: 0 },
  userVote: null,
  evidence: {
    original: publicEvidence(report.evidence?.original),
    followUp: publicEvidence(report.evidence?.followUp),
    statusHistory: report.evidence?.statusHistory || [{ status: 'Submitted', note: 'Report saved', time: report.createdAt }],
    resolution: report.evidence?.resolution || { claim: 'No resolution claim yet.', label: 'Resolution claim' },
  },
})

app.get('/api/reports', databaseUnavailable, async (_req, res) => {
  const reports = await db.collection('discussionReports')
    .find({ demo: { $ne: true }, persistent: true })
    .sort({ createdAt: -1 })
    .limit(200)
    .toArray()
  return res.json({ reports: reports.map(publicReport) })
})

app.post('/api/reports', requireTrustedBrowserOrigin, rateLimit('create-reports', 10, 60 * 60 * 1000), databaseUnavailable, requireAccount, async (req, res) => {
  const category = cleanText(req.body?.category, 80)
  const location = cleanText(req.body?.location, 180)
  const when = cleanText(req.body?.when, 80)
  const urgency = cleanText(req.body?.urgency, 20)
  const description = cleanText(req.body?.description, 1000)
  const allowedUrgency = new Set(['Low', 'Medium', 'High'])
  if (!category || !location || !description || !allowedUrgency.has(urgency)) {
    return res.status(400).json({ error: 'Category, location, description, and a valid urgency are required.' })
  }
  const account = await db.collection('accounts').findOne({ _id: new ObjectId(req.session.accountId) }, { projection: { displayName: 1 } })
  if (!account) return res.status(401).json({ error: 'Please sign in again before submitting a report.' })
  const reportId = new ObjectId().toString()
  const report = {
    reportId,
    title: `${category} concern near ${location}`,
    category,
    location,
    when,
    urgency,
    description,
    status: 'Submitted',
    persistent: true,
    demo: false,
    createdBy: new ObjectId(req.session.accountId),
    authorName: account.displayName,
    createdAt: new Date(),
    evidence: { original: null, followUp: null, statusHistory: [{ status: 'Submitted', note: 'Report submitted', time: new Date() }] },
    communityVotes: { stillPresent: 0, appearsResolved: 0, moreReview: 0 },
  }
  await db.collection('discussionReports').insertOne(report)
  return res.status(201).json({ report: publicReport(report) })
})

app.post('/api/reports/:reportId/evidence', requireTrustedBrowserOrigin, rateLimit('report-evidence', 20, 60 * 60 * 1000), databaseUnavailable, requireAccount, requireCloudinary, async (req, res) => {
  const reportId = cleanText(req.params.reportId, 80)
  const { publicId, evidenceType } = req.body || {}
  if (!reportId || !ObjectId.isValid(reportId)) {
    return res.status(400).json({ error: 'A valid report ID is required.' })
  }
  if (!['original', 'followUp'].includes(evidenceType)) {
    return res.status(400).json({ error: 'Evidence type must be original or followUp.' })
  }
  // The asset must be one this server authorised for this report and evidence type.
  const expectedPrefix = `${evidenceFolderFor(reportId)}/${evidenceType}-`
  if (typeof publicId !== 'string' || !publicId.startsWith(expectedPrefix) || publicId.length > 300) {
    return res.status(400).json({ error: 'The uploaded asset does not belong to this report.' })
  }
  const report = await db.collection('discussionReports').findOne({ reportId, persistent: true, demo: { $ne: true } })
  if (!report) return res.status(404).json({ error: 'This is a demo or unavailable report. Create a persistent report before attaching evidence.' })
  if (!report.createdBy || report.createdBy.toString() !== req.session.accountId) return res.status(403).json({ error: 'Only the report owner can attach evidence.' })
  if (evidenceType === 'original' && report.evidence?.original) {
    return res.status(409).json({ error: 'This report already has original evidence. Add a follow-up instead, or withdraw the original first.' })
  }

  // Never trust browser-supplied URL/size/format: ask Cloudinary what was actually stored.
  let asset
  try {
    asset = await cloudinary.api.resource(publicId, { resource_type: 'image' })
  } catch (error) {
    const missing = error?.http_code === 404 || error?.error?.http_code === 404
    return res.status(missing ? 400 : 502).json({ error: missing ? 'We could not find that upload. Please try again.' : 'We could not confirm your upload right now. Please try again.' })
  }
  const assetFormat = String(asset.format || '').toLowerCase()
  const invalid = !allowedEvidenceFormats.has(assetFormat) || !(asset.bytes <= maxFileSizeBytes) || typeof asset.secure_url !== 'string' || !asset.secure_url.startsWith('https://res.cloudinary.com/')
  if (invalid) {
    await cloudinary.uploader.destroy(publicId, { resource_type: 'image' }).catch(() => {})
    return res.status(400).json({ error: 'Only JPEG, PNG, and WebP images up to 10 MB are accepted.' })
  }

  const evidence = {
    url: asset.secure_url,
    publicId,
    label: evidenceType === 'followUp' ? 'Follow-up evidence' : 'Original issue evidence',
    evidenceType,
    format: assetFormat,
    bytes: asset.bytes,
    uploadedBy: new ObjectId(req.session.accountId),
    uploadedAt: new Date(),
  }
  const status = evidenceType === 'followUp' ? 'Follow-up Submitted' : report.status || 'Submitted'
  const result = await db.collection('discussionReports').updateOne(
    { reportId, createdBy: new ObjectId(req.session.accountId), persistent: true, demo: { $ne: true } },
    { $set: { [`evidence.${evidenceType}`]: evidence, status }, $push: { 'evidence.statusHistory': { status, note: evidence.label + ' uploaded and linked to this report.', time: evidence.uploadedAt } } },
  )
  if (!result.matchedCount) return res.status(404).json({ error: 'The report could not be found for this account.' })
  const updated = await db.collection('discussionReports').findOne({ reportId })
  return res.status(201).json({ report: publicReport(updated), evidence: publicEvidence(evidence) })
})

app.get('/api/auth/me', databaseUnavailable, async (req, res) => {
  if (!req.session?.accountId) {
    return res.json({ account: null })
  }
  const account = await db.collection('accounts').findOne(
    { _id: new ObjectId(req.session.accountId) },
    { projection: { displayName: 1 } },
  )
  if (!account) {
    req.session.destroy(() => {})
    return res.json({ account: null })
  }
  return res.json({ account: { id: account._id.toString(), displayName: account.displayName } })
})

app.post('/api/auth/register', requireTrustedBrowserOrigin, rateLimit('auth', 8, 15 * 60 * 1000), databaseUnavailable, async (req, res) => {
  const displayName = cleanText(req.body?.displayName, 40)
  const email = cleanText(req.body?.email, 254).toLowerCase()
  const password = req.body?.password

  if (displayName.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Enter a display name and a valid email address.' })
  }
  if (typeof password !== 'string' || password.length < 10 || password.length > 128) {
    return res.status(400).json({ error: 'Password must be between 10 and 128 characters.' })
  }
  if (!process.env.SESSION_SECRET) {
    return res.status(503).json({ error: 'Account sessions are not configured on the server.' })
  }

  try {
    const salt = randomBytes(16).toString('hex')
    const passwordHash = (await scrypt(password, salt, 64)).toString('hex')
    const result = await db.collection('accounts').insertOne({
      displayName,
      email,
      salt,
      passwordHash,
      createdAt: new Date(),
    })
    req.session.regenerate((sessionError) => {
      if (sessionError) return res.status(500).json({ error: 'Unable to start your account session.' })
      req.session.accountId = result.insertedId.toString()
      return req.session.save((saveError) => {
        if (saveError) return res.status(500).json({ error: 'Unable to save your account session.' })
        return res.status(201).json({ account: { id: result.insertedId.toString(), displayName } })
      })
    })
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: 'An account with this email already exists.' })
    return res.status(500).json({ error: 'Unable to create the account.' })
  }
})

app.post('/api/auth/login', requireTrustedBrowserOrigin, rateLimit('auth', 8, 15 * 60 * 1000), databaseUnavailable, async (req, res) => {
  const email = cleanText(req.body?.email, 254).toLowerCase()
  const password = req.body?.password
  if (typeof password !== 'string' || password.length > 128 || !email) {
    return res.status(400).json({ error: 'Enter your email and password.' })
  }
  if (!process.env.SESSION_SECRET) {
    return res.status(503).json({ error: 'Account sessions are not configured on the server.' })
  }

  const account = await db.collection('accounts').findOne({ email })
  if (!account) return res.status(401).json({ error: 'Email or password is incorrect.' })
  const candidate = Buffer.from(await scrypt(password, account.salt, 64))
  const stored = Buffer.from(account.passwordHash, 'hex')
  if (candidate.length !== stored.length || !timingSafeEqual(candidate, stored)) {
    return res.status(401).json({ error: 'Email or password is incorrect.' })
  }

  req.session.regenerate((sessionError) => {
    if (sessionError) return res.status(500).json({ error: 'Unable to start your account session.' })
    req.session.accountId = account._id.toString()
    return req.session.save((saveError) => {
      if (saveError) return res.status(500).json({ error: 'Unable to save your account session.' })
      return res.json({ account: { id: account._id.toString(), displayName: account.displayName } })
    })
  })
})

app.patch('/api/auth/me', requireTrustedBrowserOrigin, databaseUnavailable, requireAccount, async (req, res) => {
  if (typeof req.body?.displayName !== 'string' || req.body.displayName.trim().length > 40) {
    return res.status(400).json({ error: 'Display name must be 40 characters or fewer.' })
  }
  const displayName = cleanText(req.body?.displayName, 40)
  if (displayName.length < 2) return res.status(400).json({ error: 'Display name must contain at least 2 characters.' })
  const account = await db.collection('accounts').findOneAndUpdate(
    { _id: new ObjectId(req.session.accountId) },
    { $set: { displayName, updatedAt: new Date() } },
    { returnDocument: 'after', projection: { displayName: 1 } },
  )
  if (!account) return res.status(401).json({ error: 'Sign in to continue.' })
  return res.json({ account: { id: account._id.toString(), displayName: account.displayName } })
})

app.post('/api/auth/logout', requireTrustedBrowserOrigin, databaseUnavailable, (req, res) => {
  if (!req.session) return res.json({ success: true })
  req.session.destroy((error) => {
    if (error) return res.status(500).json({ error: 'Unable to sign out.' })
    res.clearCookie('shesafe.sid', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' })
    return res.json({ success: true })
  })
})

// Register only the public identifiers and summary metadata needed to anchor a discussion.
app.post('/api/discussions/register', requireTrustedBrowserOrigin, rateLimit('discussion-register', 60, 60 * 1000), databaseUnavailable, requireAccount, async (req, res) => {
  const reportId = cleanText(String(req.body?.reportId ?? ''), 80)
  const category = cleanText(req.body?.category, 60)
  const location = cleanText(req.body?.location, 160)
  if (!reportId || !category || !location) {
    return res.status(400).json({ error: 'Report ID, category, and location are required.' })
  }
  await db.collection('discussionReports').updateOne(
    { reportId },
    { $setOnInsert: { reportId, category, location, createdAt: new Date() } },
    { upsert: true },
  )
  return res.json({ success: true })
})

app.get('/api/reports/:reportId/comments', databaseUnavailable, async (req, res) => {
  const reportId = cleanText(req.params.reportId, 80)
  if (!reportId || !(await findPublicReport(reportId))) return res.status(404).json({ error: 'Report discussion not found.' })
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 100)
  const comments = await db.collection('comments')
    .find({ reportId, moderationStatus: { $ne: 'hidden' } })
    .sort({ createdAt: 1, _id: 1 })
    .limit(limit)
    .toArray()
  return res.json({ comments: comments.map((comment) => publicComment(comment, req.session?.accountId)) })
})

app.post('/api/reports/:reportId/comments', requireTrustedBrowserOrigin, rateLimit('comments', 12, 60 * 1000), databaseUnavailable, requireAccount, async (req, res) => {
  const reportId = cleanText(req.params.reportId, 80)
  if (!reportId || !(await findPublicReport(reportId))) return res.status(404).json({ error: 'Report discussion not found.' })
  const text = cleanText(req.body?.text, maxCommentLength)
  const observation = req.body?.observation || 'needs-review'
  const replyTo = req.body?.replyTo ? cleanText(req.body.replyTo, 24) : null
  if (!text) return res.status(400).json({ error: 'Write a comment before submitting.' })
  if (typeof req.body?.text === 'string' && req.body.text.trim().length > maxCommentLength) {
    return res.status(400).json({ error: `Comments must be ${maxCommentLength} characters or fewer.` })
  }
  if (!commentStatuses.has(observation)) return res.status(400).json({ error: 'Choose a valid community observation.' })
  if (replyTo && !ObjectId.isValid(replyTo)) return res.status(400).json({ error: 'Invalid reply target.' })

  const accountId = new ObjectId(req.session.accountId)
  const account = await db.collection('accounts').findOne({ _id: accountId }, { projection: { displayName: 1 } })
  if (!account) return res.status(401).json({ error: 'Sign in to continue.' })
  if (replyTo) {
    const parent = await db.collection('comments').findOne({ _id: new ObjectId(replyTo), reportId })
    if (!parent) return res.status(400).json({ error: 'The reply target was not found in this discussion.' })
    if (parent.replyTo) return res.status(400).json({ error: 'Replies can be attached to a comment, but not to another reply.' })
  }

  const comment = {
    reportId,
    authorId: accountId,
    displayName: account.displayName,
    text,
    observation,
    replyTo,
    moderationStatus: 'visible',
    reportCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
  const result = await db.collection('comments').insertOne(comment)
  return res.status(201).json({ comment: publicComment({ ...comment, _id: result.insertedId }, req.session.accountId) })
})

app.patch('/api/comments/:commentId', requireTrustedBrowserOrigin, databaseUnavailable, requireAccount, async (req, res) => {
  if (!ObjectId.isValid(req.params.commentId)) return res.status(400).json({ error: 'Invalid comment ID.' })
  const text = cleanText(req.body?.text, maxCommentLength)
  const observation = req.body?.observation
  if (!text) return res.status(400).json({ error: 'Write a comment before saving.' })
  if (typeof req.body?.text === 'string' && req.body.text.trim().length > maxCommentLength) {
    return res.status(400).json({ error: `Comments must be ${maxCommentLength} characters or fewer.` })
  }
  if (observation !== undefined && !commentStatuses.has(observation)) {
    return res.status(400).json({ error: 'Choose a valid community observation.' })
  }
  const filter = { _id: new ObjectId(req.params.commentId), authorId: new ObjectId(req.session.accountId) }
  const update = { text, updatedAt: new Date() }
  if (observation !== undefined) update.observation = observation
  const comment = await db.collection('comments').findOneAndUpdate(
    filter,
    { $set: update },
    { returnDocument: 'after' },
  )
  if (!comment) {
    const exists = await db.collection('comments').findOne({ _id: filter._id })
    return res.status(exists ? 403 : 404).json({ error: exists ? 'You can only edit your own comment.' : 'Comment not found.' })
  }
  return res.json({ comment: publicComment(comment, req.session.accountId) })
})

app.delete('/api/comments/:commentId', requireTrustedBrowserOrigin, databaseUnavailable, requireAccount, async (req, res) => {
  if (!ObjectId.isValid(req.params.commentId)) return res.status(400).json({ error: 'Invalid comment ID.' })
  const filter = { _id: new ObjectId(req.params.commentId), authorId: new ObjectId(req.session.accountId) }
  const result = await db.collection('comments').deleteOne(filter)
  if (!result.deletedCount) {
    const exists = await db.collection('comments').findOne({ _id: filter._id })
    return res.status(exists ? 403 : 404).json({ error: exists ? 'You can only delete your own comment.' : 'Comment not found.' })
  }
  await db.collection('comments').deleteMany({ replyTo: req.params.commentId })
  return res.json({ success: true })
})

app.post('/api/comments/:commentId/report', requireTrustedBrowserOrigin, rateLimit('comment-reports', 10, 60 * 60 * 1000), databaseUnavailable, requireAccount, async (req, res) => {
  if (!ObjectId.isValid(req.params.commentId)) return res.status(400).json({ error: 'Invalid comment ID.' })
  const commentId = new ObjectId(req.params.commentId)
  const accountId = new ObjectId(req.session.accountId)
  const comment = await db.collection('comments').findOne({ _id: commentId })
  if (!comment) return res.status(404).json({ error: 'Comment not found.' })
  if (comment.authorId.equals(accountId)) return res.status(400).json({ error: 'You cannot report your own comment.' })
  try {
    await db.collection('commentReports').insertOne({ commentId, reporterId: accountId, createdAt: new Date() })
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: 'You already reported this comment.' })
    throw error
  }
  const count = await db.collection('commentReports').countDocuments({ commentId })
  await db.collection('comments').updateOne(
    { _id: commentId },
    { $inc: { reportCount: 1 }, ...(count >= 3 ? { $set: { moderationStatus: 'needs-review' } } : {}) },
  )
  return res.json({ success: true, message: 'Report sent to the moderation queue.' })
})

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    message: 'SheSafe Circle backend is running.',
    mongoConfigured: Boolean(db),
    sessionsConfigured: Boolean(db && process.env.SESSION_SECRET),
    cloudinaryConfigured: cloudinaryConfigured(),
  })
})

// Resolve the persistent report the signed-in account owns, or send the correct error response.
const loadOwnedReport = async (req, res, reportId) => {
  const id = typeof reportId === 'string' || typeof reportId === 'number' ? cleanText(String(reportId), 80) : ''
  if (!id || !ObjectId.isValid(id)) {
    res.status(400).json({ valid: false, error: 'A valid report ID is required.' })
    return null
  }
  const report = await db.collection('discussionReports').findOne({ reportId: id, persistent: true, demo: { $ne: true } })
  if (!report) {
    res.status(404).json({ valid: false, error: 'This is a demo or unavailable report. Create a persistent report before uploading evidence.' })
    return null
  }
  if (!report.createdBy || report.createdBy.toString() !== req.session.accountId) {
    res.status(403).json({ valid: false, error: 'Only the report owner can attach evidence.' })
    return null
  }
  return report
}

app.post('/api/cloudinary/validate', requireTrustedBrowserOrigin, rateLimit('cloudinary-validate', 60, 60 * 60 * 1000), databaseUnavailable, requireAccount, requireCloudinary, async (req, res) => {
  const { mimetype, size, reportId, evidenceType } = req.body || {}

  if (!mimetype || !allowedMimeTypes.includes(mimetype)) {
    return res.status(400).json({ valid: false, error: 'Only JPEG, PNG, and WebP image files are allowed.' })
  }
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
    return res.status(400).json({ valid: false, error: 'The image file size is missing or invalid.' })
  }
  if (size > maxFileSizeBytes) {
    return res.status(400).json({ valid: false, error: 'Image file is too large. Maximum size is 10 MB.' })
  }
  if (!['original', 'followUp'].includes(evidenceType)) {
    return res.status(400).json({ valid: false, error: 'A valid evidence type is required for the upload.' })
  }
  const report = await loadOwnedReport(req, res, reportId)
  if (!report) return undefined

  return res.json({
    valid: true,
    warning: 'Images may contain identifying details. Keep access restricted and review before sharing publicly.',
    maxSizeBytes: maxFileSizeBytes,
    allowedTypes: allowedMimeTypes,
  })
})

app.post('/api/cloudinary/signature', requireTrustedBrowserOrigin, rateLimit('cloudinary-signature', 30, 60 * 60 * 1000), databaseUnavailable, requireAccount, requireCloudinary, async (req, res) => {
  const { reportId, evidenceType } = req.body || {}

  if (!['original', 'followUp'].includes(evidenceType)) {
    return res.status(400).json({ error: 'A valid evidence type is required for upload authorization.' })
  }
  const report = await loadOwnedReport(req, res, reportId)
  if (!report) return undefined

  // The public_id is generated and signed on the server; a client-supplied folder/public_id is ignored.
  // Signing public_id (instead of `folder`) works for both Cloudinary folder modes: with dynamic folder
  // mode, `folder` alone is NOT part of the returned public_id and the ownership check would fail.
  const publicId = `${evidenceFolderFor(report.reportId)}/${evidenceType}-${randomBytes(8).toString('hex')}`
  const allowedFormats = 'jpg,png,webp'
  const timestamp = Math.round(Date.now() / 1000)
  const signature = cloudinary.utils.api_sign_request(
    { allowed_formats: allowedFormats, public_id: publicId, timestamp },
    process.env.CLOUDINARY_API_SECRET,
  )

  return res.json({
    uploadUrl: `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload`,
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    timestamp,
    signature,
    publicId,
    allowedFormats,
  })
})

// Removes one saved evidence image. Only the signed-in report owner may do this, and the
// MongoDB reference is cleared together with the Cloudinary asset.
app.post('/api/reports/:reportId/withdraw-media', requireTrustedBrowserOrigin, rateLimit('withdraw-media', 20, 60 * 60 * 1000), databaseUnavailable, requireAccount, requireCloudinary, async (req, res) => {
  const reportId = cleanText(req.params.reportId, 80)
  const publicId = typeof req.body?.publicId === 'string' ? req.body.publicId : ''
  if (!reportId || !ObjectId.isValid(reportId) || !publicId) {
    return res.status(400).json({ success: false, message: 'A valid report ID and Cloudinary asset ID are required for withdrawal.' })
  }
  const report = await db.collection('discussionReports').findOne({ reportId, persistent: true, demo: { $ne: true } })
  if (!report) return res.status(404).json({ success: false, message: 'Report not found.' })
  if (!report.createdBy || report.createdBy.toString() !== req.session.accountId) {
    return res.status(403).json({ success: false, message: 'Only the report owner can withdraw evidence.' })
  }
  const slot = ['original', 'followUp'].find((key) => report.evidence?.[key]?.publicId === publicId)
  if (!slot) return res.status(404).json({ success: false, message: 'That image is not attached to this report.' })

  try {
    const result = await cloudinary.uploader.destroy(publicId, { resource_type: 'image' })
    if (result.result !== 'ok' && result.result !== 'not found' && result.result !== 'not_found') {
      return res.status(502).json({ success: false, message: 'Cloudinary did not confirm the removal. The saved evidence record was kept.' })
    }
    const time = new Date()
    await db.collection('discussionReports').updateOne(
      { reportId, createdBy: report.createdBy },
      { $set: { [`evidence.${slot}`]: null }, $push: { 'evidence.statusHistory': { status: report.status || 'Submitted', note: `${slot === 'followUp' ? 'Follow-up' : 'Original'} evidence withdrawn by the report owner.`, time } } },
    )
    return res.json({ success: true, message: 'Evidence withdrawn from Cloudinary and from this report.' })
  } catch (error) {
    console.error('Cloudinary withdrawal failed:', error.message)
    return res.status(502).json({ success: false, message: 'Unable to withdraw the media asset from Cloudinary. The saved evidence record was kept.' })
  }
})

app.use((error, _req, res, next) => {
  console.error('API request failed:', error.message)
  if (res.headersSent) return next(error)
  const status = error.status === 413 || error.status === 403 ? error.status : error instanceof SyntaxError && 'body' in error ? 400 : 500
  return res.status(status).json({
    error: status === 413
      ? 'Request payload is too large.'
      : status === 403
        ? 'This browser origin is not allowed to use the SheSafe Circle API.'
        : status === 400
          ? 'Request body must contain valid JSON.'
          : 'The server could not complete this request.',
  })
})

const startServer = async () => {
  if (process.env.MONGODB_URI) {
    try {
      mongoClient = new MongoClient(process.env.MONGODB_URI)
      await mongoClient.connect()
      db = mongoClient.db(process.env.MONGODB_DB || 'shesafe_circle')
      await Promise.all([
        db.collection('accounts').createIndex({ email: 1 }, { unique: true }),
        db.collection('discussionReports').createIndex({ reportId: 1 }, { unique: true }),
        db.collection('discussionReports').createIndex({ createdBy: 1, createdAt: -1 }),
        db.collection('comments').createIndex({ reportId: 1, createdAt: 1 }),
        db.collection('comments').createIndex({ authorId: 1, createdAt: -1 }),
        db.collection('commentReports').createIndex({ commentId: 1, reporterId: 1 }, { unique: true }),
      ])
      await db.collection('discussionReports').bulkWrite([
        { updateOne: { filter: { reportId: '1' }, update: { $setOnInsert: { reportId: '1', category: 'Harassment', location: 'Civic Center Light Rail', createdAt: new Date(), demo: true } }, upsert: true } },
        { updateOne: { filter: { reportId: '2' }, update: { $setOnInsert: { reportId: '2', category: 'Unsafe route', location: 'Riverside Walkway', createdAt: new Date(), demo: true } }, upsert: true } },
        { updateOne: { filter: { reportId: '3' }, update: { $setOnInsert: { reportId: '3', category: 'Vehicle concern', location: 'North Avenue Parking Lot', createdAt: new Date(), demo: true } }, upsert: true } },
      ])
      if (process.env.SESSION_SECRET) {
        sessionMiddleware = session({
          name: 'shesafe.sid',
          secret: process.env.SESSION_SECRET,
          resave: false,
          saveUninitialized: false,
          store: MongoStore.create({
            client: mongoClient,
            dbName: process.env.MONGODB_DB || 'shesafe_circle',
            collectionName: 'sessions',
            ttl: 14 * 24 * 60 * 60,
          }),
          cookie: {
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
            maxAge: 14 * 24 * 60 * 60 * 1000,
          },
        })
      }
      console.log(`Connected to MongoDB database ${process.env.MONGODB_DB || 'shesafe_circle'}.`)
    } catch (error) {
      db = null
      console.error('MongoDB connection failed; account and discussion endpoints will return 503:', error.message)
    }
  } else {
    console.warn('MONGODB_URI is not configured; accounts and discussions are unavailable.')
  }

  app.listen(port, () => {
    console.log(`SheSafe Circle API listening on http://localhost:${port}`)
  })
}

// Only auto-start when run directly (node server.js), so tests can import `app` without side effects.
if (process.argv[1] === fileURLToPath(import.meta.url)) startServer()

// Test seam: lets automated tests inject a database and session middleware.
const __setTestDeps = (deps) => { db = deps.db; sessionMiddleware = deps.sessionMiddleware }

export { app, __setTestDeps }

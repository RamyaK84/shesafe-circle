// Server evidence-flow tests. MongoDB is replaced by a tiny in-memory fake and the two Cloudinary
// network calls (api.resource / uploader.destroy) are stubbed. Nothing here talks to real services.
import test from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { v2 as cloudinary } from 'cloudinary'

process.env.CLOUDINARY_CLOUD_NAME = 'democloud'
process.env.CLOUDINARY_API_KEY = 'key'
process.env.CLOUDINARY_API_SECRET = 'secret'
const { app, __setTestDeps } = await import('../server.js')

const rows = []
const matches = (row, filter) => Object.entries(filter).every(([k, v]) => {
  if (v && typeof v === 'object' && '$ne' in v) return row[k] !== v.$ne
  if (v instanceof ObjectId) return row[k]?.toString() === v.toString()
  return row[k] === v
})
const setPath = (obj, path, value) => { const keys = path.split('.'); const last = keys.pop(); keys.reduce((o, k) => (o[k] ??= {}), obj)[last] = value }
const fakeDb = { collection: (name) => name === 'accounts' ? { findOne: async () => ({ displayName: 'Test User' }) } : ({
  findOne: async (f) => rows.find((r) => matches(r, f)) ?? null,
  insertOne: async (d) => { rows.push(d); return { insertedId: d._id } },
  updateOne: async (f, u) => {
    const row = rows.find((r) => matches(r, f)); if (!row) return { matchedCount: 0 }
    for (const [k, v] of Object.entries(u.$set || {})) setPath(row, k, v)
    for (const [k, v] of Object.entries(u.$push || {})) { const keys = k.split('.'); const last = keys.pop(); const t = keys.reduce((o, kk) => o[kk], row); t[last].push(v) }
    return { matchedCount: 1 }
  },
  find: () => ({ sort() { return this }, limit() { return this }, toArray: async () => rows.filter((r) => r.persistent) }),
}) }
const ownerA = new ObjectId().toString()
const ownerB = new ObjectId().toString()
__setTestDeps({ db: fakeDb, sessionMiddleware: (req, _res, next) => { const id = req.get('x-test-account'); req.session = id ? { accountId: id } : {}; next() } })

const server = app.listen(0)
const base = `http://127.0.0.1:${server.address().port}`
test.after(() => server.close())
const call = async (path, { account, body, method = 'POST' } = {}) => {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(account ? { 'x-test-account': account } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return { status: res.status, data: await res.json().catch(() => ({})) }
}
const makeReport = async (account, location) => (await call('/api/reports', { account, body: { category: 'Harassment', location, when: 'Tonight', urgency: 'High', description: 'x' } })).data.report
let stored = {}
cloudinary.api.resource = async (id) => { if (!stored[id]) { const e = new Error('nf'); e.http_code = 404; throw e } return stored[id] }
cloudinary.uploader.destroy = async (id) => { delete stored[id]; return { result: 'ok' } }
const fakeUpload = (publicId, extra = {}) => { stored[publicId] = { secure_url: `https://res.cloudinary.com/democloud/image/upload/v1/${publicId}.png`, format: 'png', bytes: 5000, ...extra } }

test('A/B: original and follow-up land on the right report, original is kept, signature signs public_id', async () => {
  const r1 = await makeReport(ownerA, 'Downtown station')
  const r2 = await makeReport(ownerA, 'Other place')
  const sig = (await call('/api/cloudinary/signature', { account: ownerA, body: { reportId: r1.id, evidenceType: 'original' } })).data
  assert.match(sig.publicId, new RegExp(`^shesafe-circle/${r1.id}/original-[0-9a-f]{16}$`))
  assert.equal(sig.signature, cloudinary.utils.api_sign_request({ allowed_formats: sig.allowedFormats, public_id: sig.publicId, timestamp: sig.timestamp }, 'secret'))
  assert.equal(sig.folder, undefined)
  fakeUpload(sig.publicId)
  const saved = await call(`/api/reports/${r1.id}/evidence`, { account: ownerA, body: { publicId: sig.publicId, evidenceType: 'original' } })
  assert.equal(saved.status, 201)
  assert.equal(saved.data.report.evidence.original.url.includes(sig.publicId), true)

  const sig2 = (await call('/api/cloudinary/signature', { account: ownerA, body: { reportId: r1.id, evidenceType: 'followUp' } })).data
  fakeUpload(sig2.publicId)
  const followUp = await call(`/api/reports/${r1.id}/evidence`, { account: ownerA, body: { publicId: sig2.publicId, evidenceType: 'followUp' } })
  assert.equal(followUp.status, 201)
  assert.equal(followUp.data.report.evidence.original.publicId, sig.publicId, 'original unchanged')
  assert.equal(followUp.data.report.evidence.followUp.publicId, sig2.publicId)
  assert.equal(followUp.data.report.status, 'Follow-up Submitted')

  const list = (await call('/api/reports', { method: 'GET' })).data.reports
  assert.equal(list.find((r) => r.id === r2.id).evidence.original, null, 'other report untouched')
  assert.equal(list.find((r) => r.id === r1.id).evidence.original.publicId, sig.publicId, 'persisted for re-read')
})

test('original cannot be silently replaced', async () => {
  const r = await makeReport(ownerA, 'Replace test')
  const s1 = (await call('/api/cloudinary/signature', { account: ownerA, body: { reportId: r.id, evidenceType: 'original' } })).data
  fakeUpload(s1.publicId); await call(`/api/reports/${r.id}/evidence`, { account: ownerA, body: { publicId: s1.publicId, evidenceType: 'original' } })
  const s2 = (await call('/api/cloudinary/signature', { account: ownerA, body: { reportId: r.id, evidenceType: 'original' } })).data
  fakeUpload(s2.publicId)
  assert.equal((await call(`/api/reports/${r.id}/evidence`, { account: ownerA, body: { publicId: s2.publicId, evidenceType: 'original' } })).status, 409)
})

test('D: validation and security', async () => {
  const r = await makeReport(ownerA, 'Security test')
  const other = await makeReport(ownerA, 'Another')
  const sig = (id) => call('/api/cloudinary/signature', { account: ownerA, body: { reportId: id, evidenceType: 'followUp' } }).then((x) => x.data)
  // unauthenticated
  assert.equal((await call(`/api/reports/${r.id}/evidence`, { body: { publicId: 'x', evidenceType: 'followUp' } })).status, 401)
  // another user's report
  assert.equal((await call(`/api/reports/${r.id}/evidence`, { account: ownerB, body: { publicId: (await sig(r.id)).publicId, evidenceType: 'followUp' } })).status, 403)
  // missing / invalid report id
  assert.equal((await call('/api/reports/not-an-id/evidence', { account: ownerA, body: { publicId: 'x', evidenceType: 'followUp' } })).status, 400)
  // asset authorised for a different report
  const foreign = await sig(other.id); fakeUpload(foreign.publicId)
  assert.equal((await call(`/api/reports/${r.id}/evidence`, { account: ownerA, body: { publicId: foreign.publicId, evidenceType: 'followUp' } })).status, 400)
  // upload never happened -> safe 400, nothing saved
  const ghost = await sig(r.id)
  const missing = await call(`/api/reports/${r.id}/evidence`, { account: ownerA, body: { publicId: ghost.publicId, evidenceType: 'followUp' } })
  assert.equal(missing.status, 400); assert.ok(!JSON.stringify(missing.data).includes('democloud'))
  // wrong format and oversized are rejected AND removed from storage, regardless of what the browser claimed
  const gif = await sig(r.id); fakeUpload(gif.publicId, { format: 'gif' })
  assert.equal((await call(`/api/reports/${r.id}/evidence`, { account: ownerA, body: { publicId: gif.publicId, evidenceType: 'followUp', secureUrl: 'x', format: 'png' } })).status, 400)
  assert.equal(stored[gif.publicId], undefined)
  const big = await sig(r.id); fakeUpload(big.publicId, { bytes: 11 * 1024 * 1024 })
  assert.equal((await call(`/api/reports/${r.id}/evidence`, { account: ownerA, body: { publicId: big.publicId, evidenceType: 'followUp', bytes: 1 } })).status, 400)
  // storage outage -> generic 502, no internals
  cloudinary.api.resource = async () => { throw new Error('ECONNRESET secret-internal-detail') }
  const outage = await call(`/api/reports/${r.id}/evidence`, { account: ownerA, body: { publicId: (await sig(r.id)).publicId, evidenceType: 'followUp' } })
  assert.equal(outage.status, 502); assert.ok(!JSON.stringify(outage.data).includes('secret-internal-detail'))
})

test('C: demo reports cannot accept uploads', async () => {
  rows.push({ reportId: '1', demo: true, category: 'Harassment' })
  assert.equal((await call('/api/cloudinary/signature', { account: ownerA, body: { reportId: '1', evidenceType: 'original' } })).status >= 400, true)
})

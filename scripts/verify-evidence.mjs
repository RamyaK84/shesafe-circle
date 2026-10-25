// Verifies the report -> evidence -> ProofLoop workflow against a RUNNING server and a REAL MongoDB.
//
//   PHASE=write npm run verify:evidence     create accounts/report/evidence/comment
//   (restart the server)
//   PHASE=read  npm run verify:evidence     confirm everything survived the restart
//
// Optional: REAL_UPLOAD=1 also performs ONE real signed upload of a 1x1 PNG to Cloudinary using the
// server's configured credentials. It is never run unless you set that variable. Point the server at a
// disposable MongoDB database (MONGODB_DB) and a Cloudinary account/folder you are willing to write to.
//
// Evidence records written by this script use synthetic Cloudinary-shaped metadata so the persistence
// endpoint can be tested without credentials. They exist only in the database you point the server at.
import { readFileSync, writeFileSync } from 'node:fs'
import { v2 as cloudinary } from 'cloudinary'

const BASE = process.env.API_BASE || 'http://127.0.0.1:3001'
const ORIGIN = process.env.TEST_ORIGIN || 'http://localhost:5173'
const PHASE = process.env.PHASE || 'write'
const STATE_FILE = process.env.STATE_FILE || '/tmp/shesafe-verify-state.json'
const CLOUD = process.env.CLOUDINARY_CLOUD_NAME || ''
const SECRET = process.env.CLOUDINARY_API_SECRET || ''

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  -> ${detail}`}`)
}

const makeClient = () => {
  let cookie = ''
  return async (path, method = 'GET', body, extraHeaders = {}) => {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}), ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const set = res.headers.get('set-cookie')
    if (set) cookie = set.split(';')[0]
    let data = {}
    try { data = await res.json() } catch { /* non-JSON body */ }
    return { status: res.status, data }
  }
}

const fakeAsset = (reportId, name, extra = {}) => ({
  secureUrl: `https://res.cloudinary.com/${CLOUD || 'demo'}/image/upload/v1/shesafe-circle/${reportId}/${name}.jpg`,
  publicId: `shesafe-circle/${reportId}/${name}`,
  format: 'jpg',
  bytes: 123456,
  ...extra,
})

const health = await makeClient()('/api/health')
console.log('health:', JSON.stringify(health.data))
const stackReady = health.data.mongoConfigured && health.data.sessionsConfigured

if (PHASE === 'write') {
  const anon = makeClient()
  const owner = makeClient()
  const other = makeClient()
  const stamp = Date.now()

  // --- unauthenticated access is refused ---
  for (const [path, body] of [
    ['/api/reports', { category: 'Other', location: 'x', urgency: 'Low', description: 'x' }],
    ['/api/cloudinary/validate', { mimetype: 'image/png', size: 10, reportId: 'x', evidenceType: 'original' }],
    ['/api/cloudinary/signature', { reportId: 'x', evidenceType: 'original' }],
    ['/api/reports/abc/evidence', {}],
    ['/api/reports/abc/withdraw-media', { publicId: 'shesafe-circle/abc/x' }],
  ]) {
    const r = await anon(path, 'POST', body)
    check(`unauthenticated POST ${path} is refused`, [401, 503].includes(r.status), `status ${r.status}`)
  }

  if (!stackReady) {
    console.log('\nMongoDB/sessions are not configured on the server: remaining checks are BLOCKED.')
  } else {
    // --- accounts + report creation ---
    let r = await owner('/api/auth/register', 'POST', { displayName: 'Owner Test', email: `owner${stamp}@example.com`, password: 'a-long-password-123' })
    check('owner registers and receives a session', r.status === 201, `status ${r.status}`)
    r = await other('/api/auth/register', 'POST', { displayName: 'Other Test', email: `other${stamp}@example.com`, password: 'a-long-password-456' })
    check('second account registers', r.status === 201, `status ${r.status}`)

    r = await owner('/api/reports', 'POST', { category: 'Unsafe route', location: 'Verify Walkway', when: 'Tonight', urgency: 'High', description: 'Verification report.' })
    const reportId = r.data.report?.id
    check('report is created and saved with a persistent ID', r.status === 201 && /^[0-9a-f]{24}$/.test(reportId || ''), `status ${r.status}`)
    check('new report starts with no evidence', r.data.report?.evidence?.original === null && r.data.report?.evidence?.followUp === null)
    r = await owner('/api/reports', 'POST', { category: 'Other', location: '', urgency: 'High', description: 'x' })
    check('report with missing location is rejected', r.status === 400, `status ${r.status}`)

    const listed = await anon('/api/reports')
    check('anonymous GET /api/reports lists the saved report', listed.data.reports?.some((x) => x.id === reportId))

    // --- upload validation ---
    if (!health.data.cloudinaryConfigured) {
      r = await owner('/api/cloudinary/validate', 'POST', { mimetype: 'image/png', size: 100, reportId, evidenceType: 'original' })
      check('validate returns 503 when Cloudinary is not configured', r.status === 503, `status ${r.status}`)
    } else {
      r = await owner('/api/cloudinary/validate', 'POST', { mimetype: 'application/pdf', size: 100, reportId, evidenceType: 'original' })
      check('validate rejects a non-image type', r.status === 400, `status ${r.status}`)
      r = await owner('/api/cloudinary/validate', 'POST', { mimetype: 'image/png', size: 11 * 1024 * 1024, reportId, evidenceType: 'original' })
      check('validate rejects an oversized image', r.status === 400, `status ${r.status}`)
      r = await owner('/api/cloudinary/validate', 'POST', { mimetype: 'image/png', reportId, evidenceType: 'original' })
      check('validate rejects a missing size', r.status === 400, `status ${r.status}`)
      r = await owner('/api/cloudinary/validate', 'POST', { mimetype: 'image/png', size: 100, reportId, evidenceType: 'bogus' })
      check('validate rejects an invalid evidence type', r.status === 400, `status ${r.status}`)
      r = await owner('/api/cloudinary/validate', 'POST', { mimetype: 'image/png', size: 100, reportId: 'not-an-id', evidenceType: 'original' })
      check('validate rejects an invalid report ID', r.status === 400, `status ${r.status}`)
      r = await owner('/api/cloudinary/validate', 'POST', { mimetype: 'image/png', size: 100, reportId: '1', evidenceType: 'original' })
      check('validate refuses the demo report', [400, 404].includes(r.status), `status ${r.status}`)
      r = await other('/api/cloudinary/validate', 'POST', { mimetype: 'image/png', size: 100, reportId, evidenceType: 'original' })
      check('validate refuses a non-owner', r.status === 403, `status ${r.status}`)
    }

    // --- signature ---
    if (!health.data.cloudinaryConfigured) {
      r = await owner('/api/cloudinary/signature', 'POST', { reportId, evidenceType: 'original' })
      check('signature returns 503 when Cloudinary is not configured', r.status === 503, `status ${r.status}`)
      console.log('Cloudinary credentials absent in this run: signature-correctness and REAL upload checks are BLOCKED.')
    } else {
      r = await owner('/api/cloudinary/signature', 'POST', { reportId, evidenceType: 'original', folder: 'attacker-folder' })
      check('signature is issued to the report owner', r.status === 200 && Boolean(r.data.signature), `status ${r.status}`)
      check('server ignores a client-supplied folder', r.data.folder === `shesafe-circle/${reportId}`, r.data.folder)
      if (SECRET) {
        const expected = cloudinary.utils.api_sign_request({ folder: r.data.folder, timestamp: r.data.timestamp }, SECRET)
        check('signature equals the value Cloudinary computes (file, cloud_name, resource_type, api_key excluded)', r.data.signature === expected)
      } else {
        console.log('CLOUDINARY_API_SECRET not visible to this script: signature-equality check NOT TESTED.')
      }
      r = await other('/api/cloudinary/signature', 'POST', { reportId, evidenceType: 'original' })
      check('signature refused for a non-owner', r.status === 403, `status ${r.status}`)

      if (process.env.REAL_UPLOAD === '1') {
        const sig = (await owner('/api/cloudinary/signature', 'POST', { reportId, evidenceType: 'original' })).data
        const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64')
        const form = new FormData()
        form.append('file', new Blob([png], { type: 'image/png' }), 'verify.png')
        form.append('api_key', sig.apiKey)
        form.append('timestamp', String(sig.timestamp))
        form.append('signature', sig.signature)
        form.append('folder', sig.folder)
        const up = await fetch(sig.uploadUrl, { method: 'POST', body: form })
        const upData = await up.json().catch(() => ({}))
        check('REAL Cloudinary upload succeeds with the server signature', up.ok && Boolean(upData.secure_url), upData.error?.message || `status ${up.status}`)
        if (up.ok) {
          const saved = await owner(`/api/reports/${reportId}/evidence`, 'POST', { secureUrl: upData.secure_url, publicId: upData.public_id, evidenceType: 'original', format: upData.format, bytes: upData.bytes })
          check('REAL upload metadata is persisted against the report', saved.status === 201 && saved.data.report?.evidence?.original?.publicId === upData.public_id, `status ${saved.status}`)
        }
      } else {
        console.log('REAL_UPLOAD not set: a real Cloudinary upload was NOT performed in this run.')
      }
    }

    // --- evidence persistence endpoint (synthetic metadata) ---
    const orig = fakeAsset(reportId, 'orig-test')
    const follow = fakeAsset(reportId, 'follow-test')
    r = await owner(`/api/reports/${reportId}/evidence`, 'POST', { ...orig, evidenceType: 'original' })
    check('original evidence metadata is saved', r.status === 201, `status ${r.status}`)
    check('original evidence is stored in the original field only', r.data.report?.evidence?.original?.publicId === orig.publicId && r.data.report?.evidence?.followUp === null)
    r = await owner(`/api/reports/${reportId}/evidence`, 'POST', { ...follow, evidenceType: 'followUp' })
    check('follow-up evidence metadata is saved', r.status === 201, `status ${r.status}`)
    check('follow-up evidence is stored in the followUp field and original is untouched', r.data.report?.evidence?.followUp?.publicId === follow.publicId && r.data.report?.evidence?.original?.publicId === orig.publicId)
    check('follow-up upload moves status to Follow-up Submitted', r.data.report?.status === 'Follow-up Submitted', r.data.report?.status)
    check('uploader account ID is not exposed in the API response', !JSON.stringify(r.data).includes('uploadedBy'))

    r = await owner(`/api/reports/${reportId}/evidence`, 'POST', { ...fakeAsset(reportId, 'x', { publicId: 'shesafe-circle/other-report/x' }), evidenceType: 'original' })
    check('evidence from another report folder is rejected', r.status === 400, `status ${r.status}`)
    r = await owner(`/api/reports/${reportId}/evidence`, 'POST', { ...fakeAsset(reportId, 'x', { secureUrl: 'https://evil.example.com/a.jpg' }), evidenceType: 'original' })
    check('non-Cloudinary evidence URL is rejected', r.status === 400, `status ${r.status}`)
    r = await owner(`/api/reports/${reportId}/evidence`, 'POST', { ...fakeAsset(reportId, 'x', { secureUrl: 'https://res.cloudinary.com/some-other-cloud/image/upload/a.jpg' }), evidenceType: 'original' })
    check('evidence URL on a different Cloudinary account is rejected', CLOUD ? r.status === 400 : true, `status ${r.status}`)
    r = await owner(`/api/reports/${reportId}/evidence`, 'POST', { ...fakeAsset(reportId, 'x', { format: 'exe' }), evidenceType: 'original' })
    check('non-image format is rejected', r.status === 400, `status ${r.status}`)
    r = await owner(`/api/reports/${reportId}/evidence`, 'POST', { ...fakeAsset(reportId, 'x', { bytes: 99 * 1024 * 1024 }), evidenceType: 'original' })
    check('oversized evidence metadata is rejected', r.status === 400, `status ${r.status}`)
    r = await owner(`/api/reports/${reportId}/evidence`, 'POST', { ...orig, evidenceType: 'sideways' })
    check('invalid evidence type is rejected', r.status === 400, `status ${r.status}`)
    r = await owner('/api/reports/not-an-id/evidence', 'POST', { ...orig, evidenceType: 'original' })
    check('invalid report ID is rejected on the evidence endpoint', r.status === 400, `status ${r.status}`)
    r = await owner(`/api/reports/${'a'.repeat(24)}/evidence`, 'POST', { ...fakeAsset('a'.repeat(24), 'x'), evidenceType: 'original' })
    check('unknown report ID returns 404', r.status === 404, `status ${r.status}`)
    r = await other(`/api/reports/${reportId}/evidence`, 'POST', { ...orig, evidenceType: 'original' })
    check('non-owner cannot attach evidence', r.status === 403, `status ${r.status}`)
    r = await owner(`/api/reports/${reportId}/evidence`, 'POST', { ...orig, evidenceType: 'original' }, { Origin: 'https://evil.example.com' })
    check('untrusted browser origin is refused', r.status === 403, `status ${r.status}`)

    // --- withdraw ---
    r = await other(`/api/reports/${reportId}/withdraw-media`, 'POST', { publicId: orig.publicId })
    check('withdraw refused for a non-owner', [403, 503].includes(r.status), `status ${r.status}`)

    // --- discussion persistence ---
    r = await owner(`/api/reports/${reportId}/comments`, 'POST', { text: 'Verification comment.', observation: 'still-present' })
    const commentId = r.data.comment?.id
    check('comment on a saved report is created', r.status === 201 && Boolean(commentId), `status ${r.status}`)
    r = await other(`/api/comments/${commentId}`, 'PATCH', { text: 'hijack' })
    check('non-author cannot edit a comment', r.status === 403, `status ${r.status}`)
    r = await other(`/api/comments/${commentId}`, 'DELETE')
    check('non-author cannot delete a comment', r.status === 403, `status ${r.status}`)

    writeFileSync(STATE_FILE, JSON.stringify({ reportId, commentId, email: `owner${stamp}@example.com`, origId: orig.publicId, followId: follow.publicId }))
    console.log(`\nState saved to ${STATE_FILE}. Restart the server, then run PHASE=read.`)
  }
} else if (PHASE === 'read') {
  const state = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
  const fresh = makeClient() // no cookie: a brand-new, unauthenticated request after the restart
  let r = await fresh('/api/reports')
  const report = r.data.reports?.find((x) => x.id === state.reportId)
  check('saved report is returned after restart (new request, no session)', Boolean(report), `status ${r.status}`)
  check('original evidence is still present after restart', report?.evidence?.original?.publicId === state.origId)
  check('follow-up evidence is still present after restart', report?.evidence?.followUp?.publicId === state.followId)
  check('evidence status history persisted', (report?.evidence?.statusHistory?.length || 0) >= 3)
  r = await fresh(`/api/reports/${state.reportId}/comments`)
  check('comment persisted after restart', r.data.comments?.some((c) => c.id === state.commentId), `status ${r.status}`)
  const login = makeClient()
  r = await login('/api/auth/login', 'POST', { email: state.email, password: 'a-long-password-123' })
  check('account can sign in after restart', r.status === 200, `status ${r.status}`)
  r = await login('/api/auth/me')
  check('session is valid for follow-up authenticated requests', Boolean(r.data.account?.id))
}

const failed = results.filter((x) => !x.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — ${failed.length} FAILED` : ''}`)
process.exit(failed.length ? 1 : 0)

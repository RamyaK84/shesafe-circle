import { v2 as cloudinary } from 'cloudinary'
const BASE = 'http://127.0.0.1:3001'
const SECRET = 'dummy_secret_for_signature_math_only'
let cookie = ''
const call = async (path, method = 'GET', body) => {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0]
  return { status: res.status, data: await res.json().catch(() => ({})) }
}
const email = `repro${Date.now()}@example.com`
let r = await call('/api/auth/register', 'POST', { displayName: 'Repro User', email, password: 'a-long-password-123' })
console.log('register', r.status)
r = await call('/api/reports', 'POST', { category: 'Unsafe route', location: 'Repro Walkway', when: 'Tonight', urgency: 'High', description: 'Repro description' })
const reportId = r.data.report?.id; console.log('create report', r.status, reportId)
const sig = await call('/api/cloudinary/signature', 'POST', { reportId, evidenceType: 'original', folder: 'shesafe-circle/' + reportId })
console.log('signature', sig.status)
const { timestamp, folder, signature } = sig.data
const expectedByCloudinary = cloudinary.utils.api_sign_request({ folder, timestamp }, SECRET)
console.log('server signature       :', signature)
console.log('cloudinary would expect:', expectedByCloudinary)
console.log('MATCH:', signature === expectedByCloudinary)

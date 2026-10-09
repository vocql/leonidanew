// Local test stack. Run: node --experimental-strip-types tests/mock-stack.mjs
//  :8124  GitHub Pages emulator (static files; unknown paths -> 404.html with HTTP 404, exactly like GitHub Pages)
//  :8125  MOCK Supabase: Auth (signup/password/refresh/recover/user/logout), PostgREST subset for `profiles`
//         (emulating the RLS rules in supabase/schema.sql), Storage bucket "bio", and Functions -> the REAL
//         supabase/functions/voqcl-api/index.ts handler talking to a MOCK YouTube API.
// This verifies our client code against our understanding of Supabase's APIs; it is not real Supabase.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = 8124, SBP = 8125, SITE = `http://127.0.0.1:${PAGES}`;

/* ---------- mock YouTube ---------- */
const yt = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), j = o => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  const CH = { id: 'UC' + 'a'.repeat(22), snippet: { title: 'Mock Channel', customUrl: '@mockchannel', description: 'Mock channel description', thumbnails: { medium: { url: `${SITE}/assets/favicon.png` } } }, statistics: { subscriberCount: '5000', videoCount: '42' }, contentDetails: { relatedPlaylists: { uploads: 'UU' + 'a'.repeat(22) } } };
  if (u.pathname === '/channels') return j({ items: u.searchParams.get('forHandle') === '@missing' ? [] : [CH] });
  if (u.pathname === '/playlistItems') return j({ items: [1, 2, 3].map(i => ({ contentDetails: { videoId: 'VID1111111' + i }, snippet: { title: 'Mock video ' + i, publishedAt: new Date().toISOString(), resourceId: { videoId: 'VID1111111' + i }, thumbnails: { medium: { url: `${SITE}/assets/logo.png` } } } })) });
  if (u.pathname === '/videos') return j({ items: [{ id: 'VID11111111', liveStreamingDetails: { activeLiveChatId: 'C1' } }] });
  if (u.pathname === '/liveChat/messages') return j({ nextPageToken: 'n' + Date.now(), pollingIntervalMillis: 2000, items: [
    { id: 'y1', snippet: { type: 'textMessageEvent', displayMessage: 'hello from youtube', publishedAt: new Date().toISOString() }, authorDetails: { displayName: 'YtAlice', profileImageUrl: `${SITE}/assets/favicon.png` } },
    { id: 'y2', snippet: { type: 'superChatEvent', publishedAt: new Date().toISOString(), superChatDetails: { amountDisplayString: '$5.00', userComment: 'big donation' } }, authorDetails: { displayName: 'YtBob' } }] });
  res.writeHead(404); res.end('{}');
});
await new Promise(r => yt.listen(0, r));
Object.assign(process.env, { YOUTUBE_API_KEY: 'mock-key', YT_API_BASE: `http://127.0.0.1:${yt.address().port}` });
const { handle } = await import('../supabase/functions/voqcl-api/index.ts');

/* ---------- mock Supabase ---------- */
const users = new Map(), byEmail = new Map(), access = new Map(), profiles = new Map(), files = new Map(), links = new Map();
let confirmMode = false;
const RESERVED = new Set(['admin', 'api', 'bio', 'u', 'assets', 'css', 'js', 'live', 'tool', 'tools', 'account', 'reset', 'login', 'register', 'support', 'help', 'voqcl_admin']);
const tok = p => p + crypto.randomBytes(12).toString('hex');
const session = uid => { const at = tok('at_'), rt = tok('rt_'); access.set(at, uid); access.set(rt, uid); const u = users.get(uid); return { access_token: at, refresh_token: rt, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: pubUser(u) }; };
const pubUser = u => ({ id: u.id, email: u.email, user_metadata: u.meta, identities: [{ id: u.id }] });
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, apikey, content-type, prefer, x-client-info, cache-control, x-upsert', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'access-control-expose-headers': 'content-range' };
const send = (res, s, o, h = {}) => { res.writeHead(s, { 'content-type': 'application/json', ...CORS, ...h }); res.end(o === undefined ? '' : JSON.stringify(o)); };
const body = req => new Promise(r => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });
const validUname = u => /^[a-z0-9_]{3,24}$/.test(u) && !RESERVED.has(u);

const sb = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 200);
  const u = new URL(req.url, 'http://x'), p = u.pathname;
  if (p.startsWith('/__test/')) {
    if (p === '/__test/confirm') { confirmMode = u.searchParams.get('on') === '1'; return send(res, 200, { confirmMode }); }
    if (p === '/__test/link') return send(res, 200, { link: links.get(u.searchParams.get('email')) || null });
  }
  if (p.startsWith('/functions/v1/voqcl-api')) {
    const r = await handle(new Request('http://fn' + req.url.replace('/functions/v1', ''), { headers: { origin: req.headers.origin || '' } }));
    res.writeHead(r.status, Object.fromEntries(r.headers)); return res.end(await r.text());
  }
  if (!req.headers.apikey) return send(res, 401, { message: 'No API key found in request' });
  const authz = String(req.headers.authorization || '').replace(/^Bearer /, ''), uid = access.get(authz) || null;
  const raw = await body(req); let b = {}; try { b = raw.length && /json/.test(req.headers['content-type'] || '') ? JSON.parse(raw) : {}; } catch {}

  /* ---- auth ---- */
  if (p === '/auth/v1/signup' && req.method === 'POST') {
    const email = String(b.email || '').toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) return send(res, 400, { code: 400, msg: 'Unable to validate email address: invalid format' });
    if (String(b.password || '').length < 6) return send(res, 422, { code: 422, msg: 'Password should be at least 6 characters.' });
    if (byEmail.has(email)) return send(res, 422, { code: 422, error_code: 'user_already_exists', msg: 'User already registered' });
    const uname = String(b.data?.username || '').toLowerCase();
    if (!validUname(uname) || [...profiles.values()].some(x => x.username === uname)) return send(res, 500, { code: 500, msg: 'Database error saving new user' }); // trigger insert fails
    const user = { id: crypto.randomUUID(), email, password: b.password, meta: { username: uname }, confirmed: !confirmMode };
    users.set(user.id, user); byEmail.set(email, user.id);
    profiles.set(user.id, { id: user.id, username: uname, published: false, data: {}, updated_at: new Date().toISOString() });
    if (confirmMode) { const s = session(user.id); links.set(email, `${decodeURIComponent(u.searchParams.get('redirect_to') || SITE + '/')}#access_token=${s.access_token}&refresh_token=${s.refresh_token}&expires_in=3600&token_type=bearer&type=signup`); return send(res, 200, pubUser(user)); }
    return send(res, 200, session(user.id));
  }
  if (p === '/auth/v1/token' && req.method === 'POST') {
    const gt = u.searchParams.get('grant_type');
    if (gt === 'password') {
      const usr = users.get(byEmail.get(String(b.email || '').toLowerCase()));
      if (!usr || usr.password !== b.password) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
      if (!usr.confirmed) return send(res, 400, { error: 'invalid_grant', error_description: 'Email not confirmed' });
      return send(res, 200, session(usr.id));
    }
    if (gt === 'refresh_token') { const id = access.get(b.refresh_token); if (!id) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' }); access.delete(b.refresh_token); return send(res, 200, session(id)); }
  }
  if (p === '/auth/v1/user') {
    if (!uid) return send(res, 401, { code: 401, msg: 'invalid JWT' });
    const usr = users.get(uid);
    if (req.method === 'PUT') { if (b.password) { if (String(b.password).length < 6) return send(res, 422, { msg: 'Password should be at least 6 characters.' }); usr.password = b.password; } }
    usr.confirmed = true; return send(res, 200, pubUser(usr));
  }
  if (p === '/auth/v1/recover' && req.method === 'POST') {
    const id = byEmail.get(String(b.email || '').toLowerCase());
    if (id) { const s = session(id); links.set(users.get(id).email, `${decodeURIComponent(u.searchParams.get('redirect_to') || SITE + '/')}#access_token=${s.access_token}&refresh_token=${s.refresh_token}&expires_in=3600&token_type=bearer&type=recovery`); }
    return send(res, 200, {});
  }
  if (p === '/auth/v1/logout') { access.delete(authz); return send(res, 204); }

  /* ---- PostgREST (profiles + rpc) emulating RLS from schema.sql ---- */
  if (p === '/rest/v1/rpc/username_available') { const n = String(b.u || '').toLowerCase(); return send(res, 200, validUname(n) && ![...profiles.values()].some(x => x.username === n)); }
  if (p === '/rest/v1/profiles') {
    const f = {}; for (const [k, v] of u.searchParams) if (/^eq\./.test(v)) f[k] = v.slice(3);
    const match = r => Object.entries(f).every(([k, v]) => String(r[k]) === v);
    const visible = r => r.published || r.id === uid;   // select policy
    if (req.method === 'GET') return send(res, 200, [...profiles.values()].filter(r => visible(r) && match(r)));
    if (req.method === 'PATCH') {
      const rows = [...profiles.values()].filter(r => r.id === uid && match(r));  // update policy: owner only
      for (const r of rows) {
        if ('username' in b) {
          const nu = String(b.username);
          if (!/^[a-z0-9_]{3,24}$/.test(nu)) return send(res, 400, { code: '23514', message: 'new row for relation "profiles" violates check constraint "username_format"' });
          if (RESERVED.has(nu)) return send(res, 400, { code: '23514', message: 'new row for relation "profiles" violates check constraint "username_not_reserved"' });
          if ([...profiles.values()].some(x => x.username === nu && x.id !== r.id)) return send(res, 409, { code: '23505', message: 'duplicate key value violates unique constraint "profiles_username_key"' });
        }
        Object.assign(r, Object.fromEntries(Object.entries(b).filter(([k]) => ['username', 'published', 'data'].includes(k))), { updated_at: new Date().toISOString() });
      }
      return send(res, 200, rows);
    }
    if (req.method === 'POST') { if (!uid || b.id !== uid) return send(res, 403, { code: '42501', message: 'new row violates row-level security policy for table "profiles"' }); return send(res, 409, { code: '23505', message: 'duplicate key value violates unique constraint "profiles_pkey"' }); }
  }

  /* ---- storage ---- */
  let m;
  if ((m = p.match(/^\/storage\/v1\/object\/public\/bio\/(.+)$/))) { const f2 = files.get(m[1]); if (!f2) return send(res, 404, { message: 'Object not found' }); res.writeHead(200, { 'content-type': f2.type, ...CORS }); return res.end(f2.buf); }
  if ((m = p.match(/^\/storage\/v1\/object\/bio\/(.+)$/)) && req.method === 'POST') {
    if (!uid || m[1].split('/')[0] !== uid) return send(res, 403, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
    if (raw.length > 3145728) return send(res, 413, { statusCode: '413', message: 'The object exceeded the maximum allowed size' });
    if (!/^image\/(png|jpeg|webp|gif)$/.test(req.headers['content-type'] || '')) return send(res, 415, { statusCode: '415', message: 'mime type not supported' });
    files.set(m[1], { type: req.headers['content-type'], buf: raw }); return send(res, 200, { Key: 'bio/' + m[1] });
  }
  send(res, 404, { message: 'not found (mock)' });
});
sb.listen(SBP, '127.0.0.1');

/* ---------- GitHub Pages emulator ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/config.js' && process.env.MOCK_UNCONFIGURED !== '1') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(`window.VOQCL_CONFIG={siteOrigin:'https://voqcl.com',supabaseUrl:'http://127.0.0.1:${SBP}',supabaseAnonKey:'eyJmock.anon.key'};`); }
  if (p.endsWith('/')) p += 'index.html';
  const f = path.normalize(path.join(ROOT, p));
  if (f.startsWith(ROOT + path.sep) && !f.includes(`${path.sep}tests${path.sep}`) && !f.includes(`${path.sep}supabase${path.sep}`) && fs.existsSync(f) && fs.statSync(f).isFile()) { res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); return res.end(fs.readFileSync(f)); }
  res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(path.join(ROOT, '404.html')));
}).listen(PAGES, '127.0.0.1', () => console.log('ready'));

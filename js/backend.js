/* ===== Backend client: Supabase Auth + Database + Storage + the voqcl-api Edge Function, over plain fetch (no SDK). ===== */
const CFG = Object.assign({ siteOrigin: 'https://voqcl.com', supabaseUrl: '', supabaseAnonKey: '' }, window.VOQCL_CONFIG || {});
const SITE = String(CFG.siteOrigin || 'https://voqcl.com').replace(/\/+$/, '');
const BASE = window.VOQCL_BASE || '/';
const HERE = (location.origin + BASE).replace(/\/+$/, '');   // where this copy of the site is actually running
const bioUrl = u => `${SITE}/bio/${u}`;

const SB = (() => {
  const url = String(CFG.supabaseUrl || '').replace(/\/+$/, ''), key = String(CFG.supabaseAnonKey || '');
  const ok = /^https:\/\/[^/]+$/.test(url) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url);
  const configured = ok && !!key;
  const jwtKey = key.startsWith('eyJ');
  let session = LS.g('sb.session', null);
  const save = s => { session = s; LS.s('sb.session', s); };
  const FRIENDLY = [
    [/invalid login credentials/i, 'Incorrect email or password.'],
    [/user already registered|already been registered/i, 'An account with that email already exists.'],
    [/email not confirmed/i, 'Confirm your email first (check your inbox), then sign in.'],
    [/database error saving new user/i, 'That username was just taken. Try another one.'],
    [/rate limit|too many/i, 'Too many attempts. Please wait a few minutes and try again.'],
    [/password should be at least (\d+)/i, m => `Password must be at least ${m[1]} characters.`],
    [/unable to validate email|invalid email|email address .* is invalid/i, 'Enter a valid email address.'],
    [/new password should be different/i, 'Choose a password different from your current one.'],
    [/duplicate key.*username/i, 'That username is taken.'],
    [/username_format/i, 'Usernames are 3-24 characters: lowercase letters, numbers and underscores.'],
    [/username_not_reserved/i, 'That username is reserved. Pick another.'],
    [/jwt expired|invalid jwt|not authenticated/i, 'Your session expired. Please sign in again.'],
  ];
  const friendly = msg => { for (const [re, out] of FRIENDLY) { const m = String(msg).match(re); if (m) return typeof out === 'function' ? out(m) : out; } return String(msg || 'Something went wrong.'); };
  const notConfigured = () => Object.assign(new Error('Accounts and bio pages are not set up on this site yet (add your Supabase details to config.js — see README).'), { code: 'not_configured' });

  async function raw(path, { method = 'GET', body, auth = true, headers = {}, rawBody, timeout = 15000 } = {}) {
    if (!configured) throw notConfigured();
    const h = { apikey: key, ...headers };
    if (auth && session) { await fresh(); if (session) h.authorization = 'Bearer ' + session.access_token; }
    else if (jwtKey) h.authorization = 'Bearer ' + key;
    let b;
    if (rawBody) b = rawBody; else if (body !== undefined) { h['content-type'] = 'application/json'; b = JSON.stringify(body); }
    let r;
    try { r = await fetch(url + path, { method, headers: h, body: b, signal: AbortSignal.timeout(timeout) }); }
    catch (e) { throw Object.assign(new Error(e.name === 'TimeoutError' ? 'The server took too long to respond.' : 'Could not reach the server. Check your connection.'), { code: 'network' }); }
    const text = await r.text(); let j = null; try { j = text ? JSON.parse(text) : null; } catch {}
    if (!r.ok) {
      const msg = j?.msg || j?.error_description || j?.message || j?.error || `Request failed (${r.status})`;
      if (r.status === 401 && session && auth) { /* token revoked elsewhere */ }
      throw Object.assign(new Error(friendly(msg + (j?.details ? ' ' + j.details : ''))), { status: r.status, code: j?.code || j?.error_code || '' });
    }
    return j;
  }
  async function fresh() {
    if (!session) return;
    if ((session.expires_at || 0) * 1000 > Date.now() + 60000) return;
    try {
      const s = await fetch(url + '/auth/v1/token?grant_type=refresh_token', { method: 'POST', headers: { apikey: key, 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: session.refresh_token }) });
      if (!s.ok) throw 0;
      const j = await s.json(); save(norm(j));
    } catch { save(null); }
  }
  const norm = j => ({ access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600), user: j.user });
  const redirect = () => encodeURIComponent(HERE + '/');

  const api = {
    configured,
    get session() { return session; },
    async signUp(email, password, username) {
      username = String(username || '').trim().toLowerCase();
      if (!/^[a-z0-9_]{3,24}$/.test(username)) throw new Error('Usernames are 3-24 characters: lowercase letters, numbers and underscores.');
      const free = await raw('/rest/v1/rpc/username_available', { method: 'POST', body: { u: username }, auth: false });
      if (free !== true) throw new Error('That username is taken or reserved.');
      const j = await raw('/auth/v1/signup?redirect_to=' + redirect(), { method: 'POST', body: { email, password, data: { username } }, auth: false });
      if (j && j.access_token) { save(norm(j)); return { confirm: false }; }
      if (j && j.user && Array.isArray(j.user.identities) && !j.user.identities.length) throw new Error('An account with that email already exists.');
      if (j && Array.isArray(j.identities) && !j.identities.length) throw new Error('An account with that email already exists.');
      return { confirm: true };
    },
    async signIn(email, password) { const j = await raw('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: String(email).trim(), password }, auth: false }); save(norm(j)); },
    async signOut() { try { if (session) await raw('/auth/v1/logout', { method: 'POST' }); } catch {} save(null); },
    async recover(email) { await raw('/auth/v1/recover?redirect_to=' + redirect(), { method: 'POST', body: { email: String(email).trim() }, auth: false }); },
    async updatePassword(password) { await raw('/auth/v1/user', { method: 'PUT', body: { password } }); },
    /* tokens arrive in the URL hash after email confirmation / password-reset links */
    async fromHash(hash) {
      const p = new URLSearchParams(String(hash).replace(/^#/, ''));
      if (p.get('error_description')) throw new Error(p.get('error_description').replace(/\+/g, ' '));
      const at = p.get('access_token'); if (!at) return null;
      if (!configured) throw notConfigured();
      const r = await fetch(url + '/auth/v1/user', { headers: { apikey: key, authorization: 'Bearer ' + at } });
      if (!r.ok) throw new Error('This link is invalid or has expired. Request a new one.');
      const user = await r.json();
      save({ access_token: at, refresh_token: p.get('refresh_token'), expires_at: Number(p.get('expires_at')) || Math.floor(Date.now() / 1000) + Number(p.get('expires_in') || 3600), user });
      return p.get('type') || 'signin';
    },
    async me() {
      if (!session || !configured) return null;
      await fresh(); if (!session) return null;
      const uid = session.user?.id;
      let rows;
      try { rows = await raw(`/rest/v1/profiles?id=eq.${encodeURIComponent(uid)}&select=id,username,published,data,updated_at`); }
      catch (e) { if (e.status === 401) { save(null); return null; } throw e; }
      const prof = rows?.[0] || null;
      return { id: uid, email: session.user?.email || '', username: prof?.username || session.user?.user_metadata?.username || '', profile: prof };
    },
    async publicProfile(username) {
      const rows = await raw(`/rest/v1/profiles?username=eq.${encodeURIComponent(username)}&published=eq.true&select=username,data,updated_at`, { auth: false });
      return rows?.[0] || null;
    },
    async saveProfile(uid, patch) {
      const rows = await raw(`/rest/v1/profiles?id=eq.${encodeURIComponent(uid)}`, { method: 'PATCH', body: patch, headers: { prefer: 'return=representation' } });
      if (rows && rows.length) return rows[0];
      /* no row yet (e.g. created before the trigger existed): insert our own */
      const ins = await raw('/rest/v1/profiles', { method: 'POST', body: { id: uid, username: ME?.username, ...patch }, headers: { prefer: 'return=representation' } });
      return ins[0];
    },
    async upload(uid, file) {
      if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error('Choose a PNG, JPEG, WebP or GIF image.');
      if (file.size > 3 * 1024 * 1024) throw new Error('Images must be under 3 MB.');
      const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[file.type];
      const path = `${uid}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      await raw('/storage/v1/object/bio/' + path, { method: 'POST', rawBody: file, headers: { 'content-type': file.type, 'cache-control': '31536000' }, timeout: 60000 });
      return `${url}/storage/v1/object/public/bio/${path}`;
    },
    /* the voqcl-api Edge Function (YouTube + Twitch proxy; holds the API key) */
    async fn(action, params = {}) {
      if (!configured) throw Object.assign(new Error('YouTube features need this site\'s Supabase backend (see README).'), { code: 'not_configured' });
      const q = new URLSearchParams({ action }); for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, v);
      const h = { apikey: key }; if (jwtKey) h.authorization = 'Bearer ' + key;
      let r;
      try { r = await fetch(`${url}/functions/v1/voqcl-api?${q}`, { headers: h, signal: AbortSignal.timeout(15000) }); }
      catch { throw Object.assign(new Error('Could not reach the YouTube service.'), { code: 'network' }); }
      let j = null; try { j = await r.json(); } catch {}
      if (r.status === 404 && !j?.code) throw Object.assign(new Error('The voqcl-api function is not deployed yet (see README).'), { code: 'not_configured' });
      if (!r.ok) throw Object.assign(new Error(j?.error || j?.message || `YouTube service error (${r.status})`), { code: j?.code || 'http_' + r.status });
      return j;
    },
  };
  return api;
})();

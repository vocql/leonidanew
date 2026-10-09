// VOQCL API - Supabase Edge Function (Deno).
// Keeps YOUTUBE_API_KEY (and optional Twitch credentials) on the server. Browsers call:
//   https://<project>.supabase.co/functions/v1/voqcl-api?action=...
// Secrets (Supabase dashboard -> Edge Functions -> Secrets): YOUTUBE_API_KEY, optional TWITCH_CLIENT_ID,
// TWITCH_CLIENT_SECRET, ALLOWED_ORIGINS (comma separated, e.g. https://voqcl.com).
// Written as plain JavaScript-compatible TypeScript so the same file is unit-tested under Node.

const env = (k) => (globalThis.Deno ? globalThis.Deno.env.get(k) : globalThis.process?.env[k]) || '';
const YT = () => (env('YT_API_BASE') || 'https://www.googleapis.com/youtube/v3').replace(/\/$/, '');
const TW_API = () => (env('TWITCH_API_BASE') || 'https://api.twitch.tv/helix').replace(/\/$/, '');
const TW_ID = () => (env('TWITCH_ID_BASE') || 'https://id.twitch.tv').replace(/\/$/, '');

class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

/* ---------- small TTL cache (per function instance) ---------- */
const cache = new Map();
const cget = (k) => { const e = cache.get(k); if (e && e.exp > Date.now()) return e.v; cache.delete(k); return undefined; };
const cset = (k, v, ms) => { if (cache.size > 3000) cache.clear(); cache.set(k, { v, exp: Date.now() + ms }); return v; };

/* ---------- per-IP rate limit (per instance; a soft guard for quota) ---------- */
const hits = new Map();
function limited(ip, max = 120, windowMs = 60000) {
  const now = Date.now();
  let b = hits.get(ip);
  if (!b || b.reset < now) { b = { n: 0, reset: now + windowMs }; hits.set(ip, b); }
  if (hits.size > 5000) hits.clear();
  return ++b.n > max;
}

async function ytGet(path, params) {
  const key = env('YOUTUBE_API_KEY');
  if (!key) throw new ApiError(501, 'not_configured', 'YouTube is not configured (YOUTUBE_API_KEY secret missing).');
  const u = new URL(YT() + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') u.searchParams.set(k, String(v));
  u.searchParams.set('key', key);
  let r;
  try { r = await fetch(u, { signal: AbortSignal.timeout(10000) }); }
  catch { throw new ApiError(502, 'upstream_unreachable', 'Could not reach YouTube.'); }
  let j = null; try { j = await r.json(); } catch { /* ignore */ }
  if (!r.ok) {
    const reason = j?.error?.errors?.[0]?.reason || '';
    if (reason === 'quotaExceeded' || reason === 'rateLimitExceeded' || reason === 'dailyLimitExceeded') throw new ApiError(429, 'quota', 'YouTube API quota exceeded. Try again later.');
    if (reason === 'liveChatEnded') throw new ApiError(410, 'chat_ended', 'This live chat has ended.');
    if (reason === 'liveChatDisabled') throw new ApiError(403, 'chat_disabled', 'Chat is disabled for this stream.');
    if (reason === 'liveChatNotFound' || r.status === 404) throw new ApiError(404, 'not_found', 'Live chat not found.');
    if (reason === 'keyInvalid' || reason === 'badRequest' && /API key/i.test(JSON.stringify(j))) throw new ApiError(502, 'bad_key', 'The YouTube API key was rejected. Check the YOUTUBE_API_KEY secret.');
    if (reason === 'ipRefererBlocked' || reason === 'forbidden' || r.status === 403) throw new ApiError(403, 'forbidden', 'YouTube refused the request (check the API key restrictions, or the chat may be private/members-only).');
    throw new ApiError(502, 'upstream_error', `YouTube returned ${r.status}.`);
  }
  return j;
}

/* ---------- input parsing ---------- */
function parseYtInput(q) {
  q = String(q || '').trim();
  if (!q) return null;
  let m;
  if (/^[\w-]{11}$/.test(q) && !/^UC/.test(q)) return { video: q, handle: /^[\w.\-]{3,30}$/.test(q) ? '@' + q : undefined, ambiguous: true }; // 11 chars: video ID or handle
  if ((m = q.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|live\/|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/i))) return { video: m[1] };
  if ((m = q.match(/youtube\.com\/channel\/(UC[\w-]{22})/i))) return { channelId: m[1] };
  if ((m = q.match(/youtube\.com\/(@[\w.\-]{3,30})/i))) return { handle: m[1] };
  if ((m = q.match(/youtube\.com\/(?:c|user)\/([\w.\-]{2,60})/i))) return { legacy: m[1] };
  if (/^UC[\w-]{22}$/.test(q)) return { channelId: q };
  if (/^@?[\w.\-]{3,30}$/.test(q)) return { handle: q.startsWith('@') ? q : '@' + q };
  return null;
}

async function channelIdFor(inp) {
  if (inp.channelId) return inp.channelId;
  const k = 'h:' + (inp.handle || inp.legacy).toLowerCase();
  const hit = cget(k);
  if (hit) return hit;
  const j = await ytGet('/channels', inp.handle ? { part: 'id', forHandle: inp.handle } : { part: 'id', forUsername: inp.legacy });
  const id = j.items?.[0]?.id;
  if (!id) throw new ApiError(404, 'channel_not_found', 'YouTube channel not found.');
  return cset(k, id, 6 * 3600e3);
}

/* Live video via uploads playlist (1 unit) + videos.list (1 unit) instead of search.list (100 units). */
async function liveVideoForChannel(channelId) {
  const k = 'live:' + channelId;
  const hit = cget(k);
  if (hit !== undefined) { if (hit) return hit; throw new ApiError(404, 'not_live', 'That channel is not live right now.'); }
  const pl = await ytGet('/playlistItems', { part: 'contentDetails', playlistId: 'UU' + channelId.slice(2), maxResults: 6 });
  const ids = (pl.items || []).map((i) => i.contentDetails?.videoId).filter(Boolean);
  let found = '';
  if (ids.length) {
    const v = await ytGet('/videos', { part: 'liveStreamingDetails', id: ids.join(',') });
    for (const it of v.items || []) { const d = it.liveStreamingDetails; if (d?.activeLiveChatId && !d.actualEndTime) { found = it.id; break; } }
  }
  cset(k, found, found ? 120e3 : 45e3);
  if (!found) throw new ApiError(404, 'not_live', 'That channel is not live right now.');
  return found;
}

async function resolveVideo(q) {
  const inp = parseYtInput(q);
  if (!inp) throw new ApiError(400, 'bad_input', 'Enter a YouTube @handle, channel URL/ID (UC…), or a live video URL/ID.');
  if (inp.video && !inp.ambiguous) return inp.video;
  if (inp.ambiguous) {
    const v = await ytGet('/videos', { part: 'id', id: inp.video });
    if (v.items?.length) return inp.video;
  }
  return liveVideoForChannel(await channelIdFor({ handle: inp.handle, channelId: inp.channelId, legacy: inp.legacy }));
}

async function chatIdForVideo(video) {
  const k = 'chat:' + video;
  const hit = cget(k);
  if (hit) return hit;
  const j = await ytGet('/videos', { part: 'liveStreamingDetails', id: video });
  const it = j.items?.[0];
  if (!it) throw new ApiError(404, 'video_not_found', 'Video not found (or it is private).');
  const d = it.liveStreamingDetails;
  if (!d || !d.activeLiveChatId) throw new ApiError(404, 'not_live', d?.actualEndTime ? 'That stream has ended.' : 'That video has no active live chat.');
  return cset(k, d.activeLiveChatId, 5 * 60e3);
}

function normMessage(it) {
  const s = it.snippet || {}, a = it.authorDetails || {};
  let text = s.displayMessage || s.textMessageDetails?.messageText || '', kind = 'text', extra = '';
  if (s.type === 'superChatEvent') { kind = 'super'; extra = s.superChatDetails?.amountDisplayString || ''; text = s.superChatDetails?.userComment || ''; }
  else if (s.type === 'superStickerEvent') { kind = 'super'; extra = s.superStickerDetails?.amountDisplayString || ''; text = ''; }
  else if (s.type === 'newSponsorEvent') { kind = 'member'; text = text || 'became a member'; }
  else if (s.type !== 'textMessageEvent') return null;
  return { id: it.id, name: a.displayName || 'Unknown', avatar: a.profileImageUrl || '', text, ts: Date.parse(s.publishedAt) || Date.now(), kind, extra, owner: !!a.isChatOwner, mod: !!a.isChatModerator, member: !!a.isChatSponsor };
}

/* Stateless chat page: the overlay keeps the pageToken and calls again after pollMs. */
async function chat(video, pageToken) {
  if (!/^[\w-]{11}$/.test(video)) throw new ApiError(400, 'bad_input', 'Invalid video id.');
  const liveChatId = await chatIdForVideo(video);
  const ck = 'page:' + liveChatId + ':' + (pageToken || '');
  const hit = cget(ck);
  if (hit) return hit;
  const j = await ytGet('/liveChat/messages', { part: 'snippet,authorDetails', liveChatId, pageToken, maxResults: 200 });
  const pollMs = Math.max(2000, Math.min(15000, Number(j.pollingIntervalMillis) || 5000));
  const out = { messages: (j.items || []).map(normMessage).filter(Boolean), nextPageToken: j.nextPageToken || pageToken || '', pollMs };
  return cset(ck, out, Math.min(pollMs, 4000)); // several viewers of the same page share one upstream call
}

async function channel(q, full) {
  const inp = parseYtInput(q);
  if (!inp || (inp.video && !inp.ambiguous)) throw new ApiError(400, 'bad_input', 'Enter a YouTube @handle, channel URL, or channel ID (UC…).');
  const id = await channelIdFor({ handle: inp.handle, channelId: inp.channelId, legacy: inp.legacy });
  const k = (full ? 'chf:' : 'ch:') + id;
  const hit = cget(k);
  if (hit) return hit;
  const j = await ytGet('/channels', { part: full ? 'snippet,statistics,contentDetails' : 'snippet,statistics', id });
  const it = j.items?.[0];
  if (!it) throw new ApiError(404, 'channel_not_found', 'YouTube channel not found.');
  const st = it.statistics || {}, sn = it.snippet || {};
  const r = {
    id, title: sn.title || '', avatar: sn.thumbnails?.medium?.url || sn.thumbnails?.default?.url || '',
    subscribers: st.hiddenSubscriberCount || st.subscriberCount === undefined ? null : Number(st.subscriberCount),
    hidden: !!st.hiddenSubscriberCount, url: sn.customUrl ? 'https://www.youtube.com/' + sn.customUrl : 'https://www.youtube.com/channel/' + id,
  };
  if (full) {
    r.description = (sn.description || '').slice(0, 1000);
    r.videoCount = st.videoCount === undefined ? null : Number(st.videoCount);
    const uploads = it.contentDetails?.relatedPlaylists?.uploads || 'UU' + id.slice(2);
    let videos = [];
    try {
      const pl = await ytGet('/playlistItems', { part: 'snippet', playlistId: uploads, maxResults: 6 });
      videos = (pl.items || []).map((v) => ({
        id: v.snippet?.resourceId?.videoId, title: v.snippet?.title || '', published: v.snippet?.publishedAt || '',
        thumb: v.snippet?.thumbnails?.medium?.url || v.snippet?.thumbnails?.default?.url || '',
      })).filter((v) => v.id && v.title !== 'Private video' && v.title !== 'Deleted video');
    } catch (e) { if (e.code === 'quota') throw e; /* channel with no public uploads */ }
    r.videos = videos;
    r.fetchedAt = new Date().toISOString();
  }
  return cset(k, r, full ? 10 * 60e3 : 60e3);
}

/* ---------- Twitch avatars (optional) ---------- */
let twTok = null;
async function twitchAvatar(login) {
  if (!env('TWITCH_CLIENT_ID') || !env('TWITCH_CLIENT_SECRET')) throw new ApiError(501, 'not_configured', 'Twitch avatars are not configured.');
  if (!/^\w{3,25}$/.test(login)) throw new ApiError(400, 'bad_input', 'Invalid channel name.');
  const k = 'twa:' + login.toLowerCase();
  const hit = cget(k);
  if (hit !== undefined) { if (hit) return hit; throw new ApiError(404, 'not_found', 'Channel not found.'); }
  if (!twTok || twTok.exp < Date.now() + 60e3) {
    const r = await fetch(`${TW_ID()}/oauth2/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: env('TWITCH_CLIENT_ID'), client_secret: env('TWITCH_CLIENT_SECRET'), grant_type: 'client_credentials' }), signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new ApiError(502, 'twitch_auth', 'Twitch rejected the app credentials.');
    const j = await r.json(); twTok = { t: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  }
  const r = await fetch(`${TW_API()}/users?login=${encodeURIComponent(login)}`, { headers: { 'client-id': env('TWITCH_CLIENT_ID'), authorization: 'Bearer ' + twTok.t }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new ApiError(502, 'upstream_error', 'Twitch lookup failed.');
  const u = (await r.json()).data?.[0];
  cset(k, u?.profile_image_url || '', 3600e3);
  if (!u) throw new ApiError(404, 'not_found', 'Channel not found.');
  return u.profile_image_url;
}

/* ---------- HTTP handler ---------- */
function cors(origin) {
  const allowed = env('ALLOWED_ORIGINS').split(',').map((s) => s.trim()).filter(Boolean);
  const allow = !allowed.length ? '*' : allowed.includes(origin) ? origin : allowed[0];
  return { 'access-control-allow-origin': allow, 'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info', 'access-control-allow-methods': 'GET, OPTIONS', vary: 'origin' };
}

export async function handle(req) {
  const origin = req.headers.get('origin') || '';
  const h = cors(origin);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: h });
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...h, 'content-type': 'application/json', 'cache-control': 'no-store' } });
  if (req.method !== 'GET') return json({ error: 'Method not allowed.', code: 'method' }, 405);
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  if (limited(ip)) return json({ error: 'Too many requests. Slow down.', code: 'rate' }, 429);
  const u = new URL(req.url), p = u.searchParams, action = p.get('action') || '';
  try {
    switch (action) {
      case 'config': return json({ youtube: !!env('YOUTUBE_API_KEY'), twitchAvatars: !!(env('TWITCH_CLIENT_ID') && env('TWITCH_CLIENT_SECRET')) });
      case 'resolve': return json({ video: await resolveVideo(p.get('q')) });
      case 'chat': return json(await chat(String(p.get('video') || ''), p.get('pageToken') || ''));
      case 'channel': return json(await channel(p.get('q'), false));
      case 'channel_full': return json(await channel(p.get('q'), true));
      case 'twitch_avatar': return json({ avatar: await twitchAvatar(String(p.get('login') || '')) });
      default: return json({ error: 'Unknown action.', code: 'bad_action' }, 400);
    }
  } catch (e) {
    if (e instanceof ApiError) return json({ error: e.message, code: e.code }, e.status);
    console.error(e);
    return json({ error: 'Server error.', code: 'server' }, 500);
  }
}

if (globalThis.Deno) globalThis.Deno.serve(handle);

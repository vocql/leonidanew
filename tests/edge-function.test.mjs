// Tests the real supabase/functions/voqcl-api/index.ts handler under Node against a MOCK YouTube API.
// Run: node --experimental-strip-types tests/edge-function.test.mjs
import http from 'node:http'; import assert from 'node:assert';
let n = 0; const ok = (c, m) => { assert(c, m); n++; };
const seen = { keys: new Set(), chat: 0, search: 0 }; let mode = 'live';
const mock = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); seen.keys.add(u.searchParams.get('key'));
  const j = (o, s = 200) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (u.pathname === '/search') { seen.search++; return j({ items: [] }); }
  if (u.pathname === '/channels') {
    if (u.searchParams.get('forHandle') && u.searchParams.get('forHandle') !== '@livechan') return j({ items: [] });
    if (mode === 'quota') return j({ error: { errors: [{ reason: 'quotaExceeded' }] } }, 403);
    return j({ items: [{ id: 'UC' + 'a'.repeat(22), snippet: { title: 'Live Chan', customUrl: '@livechan', description: 'desc', thumbnails: { medium: { url: 'https://yt3.example/a.jpg' } } }, statistics: { subscriberCount: '4321', videoCount: '12' }, contentDetails: { relatedPlaylists: { uploads: 'UU' + 'a'.repeat(22) } } }] });
  }
  if (u.pathname === '/playlistItems') return j({ items: [{ contentDetails: { videoId: 'VID11111111' }, snippet: { title: 'Latest video', publishedAt: '2026-01-01T00:00:00Z', resourceId: { videoId: 'VID11111111' }, thumbnails: { medium: { url: 'https://i.ytimg.com/vi/VID11111111/mqdefault.jpg' } } } }, { snippet: { title: 'Private video', resourceId: { videoId: 'PRIV1111111' } } }] });
  if (u.pathname === '/videos') { const id = u.searchParams.get('id').split(',')[0]; return j({ items: mode === 'nolive' ? [{ id, liveStreamingDetails: { actualEndTime: 'x' } }] : [{ id, liveStreamingDetails: { activeLiveChatId: 'CHAT1' } }] }); }
  if (u.pathname === '/liveChat/messages') { seen.chat++; return j({ nextPageToken: 'T2', pollingIntervalMillis: 1000, items: [
    { id: 'm1', snippet: { type: 'textMessageEvent', displayMessage: 'hello', publishedAt: '2026-01-01T00:00:00Z' }, authorDetails: { displayName: 'Alice', profileImageUrl: 'https://yt3.example/a.png', isChatModerator: true } },
    { id: 'm2', snippet: { type: 'superChatEvent', publishedAt: '2026-01-01T00:00:01Z', superChatDetails: { amountDisplayString: '$5.00', userComment: 'wow' } }, authorDetails: { displayName: 'Bob' } },
    { id: 'm3', snippet: { type: 'chatEndedEvent' }, authorDetails: {} }] }); }
  j({}, 404);
});
await new Promise(r => mock.listen(0, r));
const SECRET = 'TEST_SECRET_KEY_DO_NOT_LEAK';
Object.assign(process.env, { YOUTUBE_API_KEY: SECRET, YT_API_BASE: `http://127.0.0.1:${mock.address().port}`, ALLOWED_ORIGINS: 'https://voqcl.com' });
const { handle } = await import('../supabase/functions/voqcl-api/index.ts');
const call = async (qs, origin = 'https://voqcl.com', method = 'GET') => { const r = await handle(new Request('http://fn/voqcl-api?' + qs, { method, headers: { origin } })); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { s: r.status, j, t, h: r.headers }; };

let r = await call('action=config'); ok(r.s === 200 && r.j.youtube === true && r.j.twitchAvatars === false, 'config');
ok(r.h.get('access-control-allow-origin') === 'https://voqcl.com', 'CORS allows voqcl.com');
ok((await call('action=config', 'https://evil.example')).h.get('access-control-allow-origin') === 'https://voqcl.com', 'CORS does not echo other origins');
ok((await call('', 'https://voqcl.com', 'OPTIONS')).s === 200, 'preflight');
ok((await call('action=config', 'https://voqcl.com', 'POST')).s === 405, 'GET only');
ok((await call('action=nope')).j.code === 'bad_action', 'unknown action');
r = await call('action=resolve&q=%40livechan'); ok(r.j.video === 'VID11111111' && seen.search === 0, 'resolve @handle -> live video without 100-unit search');
ok((await call('action=resolve&q=' + encodeURIComponent('https://youtu.be/dQw4w9WgXcQ'))).j.video === 'dQw4w9WgXcQ', 'resolve youtu.be URL');
ok((await call('action=resolve&q=%40nobody')).j.code === 'channel_not_found', 'unknown channel');
ok((await call('action=resolve&q=%3C%3E')).j.code === 'bad_input', 'bad input');
r = await call('action=chat&video=VID11111111');
ok(r.s === 200 && r.j.messages.length === 2 && r.j.messages[0].avatar === 'https://yt3.example/a.png' && r.j.messages[0].mod && r.j.messages[1].kind === 'super' && r.j.messages[1].extra === '$5.00' && r.j.nextPageToken === 'T2' && r.j.pollMs === 2000, 'chat page normalized (avatar, super chat, min poll 2s, unsupported events dropped)');
await call('action=chat&video=VID11111111'); ok(seen.chat === 1, 'identical page request served from cache');
ok((await call('action=chat&video=bad')).j.code === 'bad_input', 'chat bad id');
r = await call('action=channel_full&q=' + encodeURIComponent('https://www.youtube.com/@livechan'));
ok(r.j.title === 'Live Chan' && r.j.subscribers === 4321 && r.j.videoCount === 12 && r.j.url === 'https://www.youtube.com/@livechan' && r.j.videos.length === 1 && r.j.videos[0].id === 'VID11111111', 'channel_full: stats + recent videos (private videos filtered)');
ok((await call('action=channel&q=%40livechan')).j.subscribers === 4321, 'channel');
ok((await call('action=channel&q=livechan123')).s !== 400, '11-character bare handle treated as a handle for channel lookups');
mode = 'nolive'; r = await call('action=chat&video=ENDEDVID123'); ok(r.s === 404 && r.j.code === 'not_live', 'ended stream -> not_live');
mode = 'quota'; r = await call('action=channel&q=UC' + 'b'.repeat(22)); ok(r.s === 429 && r.j.code === 'quota', 'quota error -> 429 quota'); mode = 'live';
ok([...seen.keys].every(k => k === SECRET), 'key sent upstream only');
ok(!JSON.stringify(r) .includes(SECRET), 'key never in responses');
delete process.env.YOUTUBE_API_KEY; r = await call('action=resolve&q=%40freshchannel'); ok(r.s === 501 && r.j.code === 'not_configured', 'missing key -> 501 not_configured'); process.env.YOUTUBE_API_KEY = SECRET;
ok((await call('action=twitch_avatar&login=voqcl')).j.code === 'not_configured', 'twitch avatars optional');
console.log(`edge-function: ${n} assertions passed`); mock.close();

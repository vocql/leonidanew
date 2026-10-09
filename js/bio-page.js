/* ===== Public bio page: voqcl.com/bio/<username> (served by 404.html on GitHub Pages) ===== */
function bioNotFound(title, msg) {
  document.title = title + ' · VOQCL';
  $$('link[rel=stylesheet]').forEach(l => l.remove());
  const st = document.createElement('style');
  st.textContent = 'body{margin:0;background:#000;color:#fff;font-family:Inter,system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;text-align:center;padding:20px}p{color:#8a8a90}a{color:#fff}';
  document.head.append(st);
  document.body.className = ''; document.body.innerHTML = `<div><h1>${esc(title)}</h1><p>${esc(msg)}</p><a href="${esc(BASE)}">VOQCL TOOLS</a></div>`;
}

async function renderBioPage(username) {
  username = String(username || '').toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/.test(username)) return bioNotFound('Page not found', 'That is not a valid username.');
  document.body.innerHTML = '<div style="min-height:100vh;display:grid;place-items:center;color:#8a8a90;font-family:system-ui">Loading…</div>';
  let row;
  try { row = await SB.publicProfile(username); }
  catch (e) { return bioNotFound('Could not load this page', e.code === 'not_configured' ? 'This site is not connected to its database yet.' : 'Please check your connection and refresh.'); }
  if (!row) return bioNotFound('Page not found', `No published page for @${username}.`);
  const yq = BIO.normalize(row.data).youtube;
  const cacheKey = 'bio.yt.' + yq.q;
  const cached = yq.show ? LS.g(cacheKey, null) : null;
  const r = BIO.renderParts(row.data, { username: row.username, yt: cached, ytState: 'loading' });
  $$('link[rel=stylesheet]').forEach(l => l.remove());
  document.title = r.title + ' (@' + row.username + ')';
  const meta = (n, c, prop) => { const m = document.createElement('meta'); m.setAttribute(prop ? 'property' : 'name', n); m.content = c; document.head.append(m); };
  meta('description', r.description || `${r.title} on VOQCL`); meta('og:title', r.title, true); meta('og:url', bioUrl(row.username), true); if (r.image) meta('og:image', r.image, true);
  const st = document.createElement('style'); st.textContent = r.css; document.head.append(st);
  document.body.className = ''; document.body.removeAttribute('style'); document.body.innerHTML = r.body;
  const ft = $('.ft a'); if (ft) ft.href = BASE;
  if (!yq.show) return;
  const box = $('#yt .yt-b');
  const load = async force => {
    if (!cached || force) box.innerHTML = BIO.renderYoutube(null, 'loading');
    try { const c = await SB.fn('channel_full', { q: yq.q, ...(force ? { t: Date.now() } : {}) }); LS.s(cacheKey, c); box.innerHTML = BIO.renderYoutube(c); }
    catch (e) { if (!cached || force) box.innerHTML = BIO.renderYoutube(null, 'error', e.code === 'quota' ? 'YouTube data is unavailable right now (daily limit reached).' : e.code === 'channel_not_found' ? 'This YouTube channel could not be found.' : 'YouTube data is unavailable right now.'); }
  };
  const btn = $('#ytr'); if (btn) btn.onclick = async () => { btn.disabled = true; await load(true); btn.disabled = false; };
  load(false);
}

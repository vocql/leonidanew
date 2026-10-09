/* ===== Link in Bio editor. Public page: voqcl.com/bio/<username>. Data: Supabase (profiles table + "bio" storage bucket). ===== */
add('linkbio', 'util', '🔗', 'Link in Bio', 'Your own page at voqcl.com/bio/username with links, socials and your YouTube channel.', el => {
  el.innerHTML = page('Link in Bio', 'Build your page, preview it live, then publish it.', '<p class="d">Loading…</p>');
  lbInit(el).catch(e => { if (el.isConnected) el.innerHTML = page('Link in Bio', '', `<p class="err">${esc(e.message)}</p>`); });
});

async function lbInit(el) {
  const gen = el._lbGen = (el._lbGen || 0) + 1, stale = () => el._lbGen !== gen || !el.isConnected;
  await meReady; if (stale()) return;
  const rid = () => Math.random().toString(36).slice(2, 10);
  const baseDesign = () => ({ ...BIO.PRESETS.midnight, preset: 'midnight', bgImage: '' });
  const blank = () => ({ displayName: ME ? ME.username : '', bio: '', avatar: '', banner: '', links: [], socials: [], youtube: { q: '', show: true }, design: baseDesign() });
  const S = { username: ME ? ME.username : '', published: false, saved: false, dirty: false, data: blank(), tab: 'profile', yt: null, ytState: 'idle', ytMsg: '' };
  if (ME && ME.profile) {
    S.username = ME.profile.username; S.published = !!ME.profile.published;
    const d = ME.profile.data || {};
    if (Object.keys(d).length) { S.data = { ...blank(), ...BIO.normalize(d), design: { ...baseDesign(), ...BIO.normalize(d).design } }; S.saved = true; }
    else { const dr = LS.g('lb.draft', null); if (dr) { S.data = dr; S.dirty = true; } }
  } else { const dr = LS.g('lb.draft', null); if (dr) S.data = dr; }
  S.data.links.forEach(l => l.id ||= rid());
  S.data.youtube ||= { q: '', show: true };
  const D = () => S.data, DS = () => S.data.design;
  const setS = m => { const e = $('#lbs'); if (e) e.textContent = m; };

  const setup = !SB.configured ? '<div class="note" style="margin:0 0 12px"><b>Not set up yet:</b> saving and publishing need the Supabase backend in <code>config.js</code> (see README). You can still design and preview.</div>'
    : !ME ? '<div class="note" style="margin:0 0 12px">You are not signed in. You can design and preview now; create a free account to save and publish. <button class="pri" id="lsi" style="margin-left:8px">Sign in / Create account</button></div>' : '';
  el.innerHTML = page('Link in Bio', 'Build your page, preview it live, then publish it at your own address.', `${setup}
  <div class="lb"><div class="panel lb-ed"><div class="tabs" id="lt" role="tablist">${['profile:Profile', 'links:Links', 'youtube:YouTube', 'design:Design', 'publish:Publish'].map(t => { const [k, n] = t.split(':'); return `<span class="chip" role="tab" tabindex="0" data-t="${k}">${n}</span>`; }).join('')}</div><div id="lbb"></div></div>
  <div class="lb-pv"><div class="phone"><iframe id="lbp" title="Page preview" sandbox="allow-popups"></iframe></div><div class="row" style="justify-content:center"><span id="lbs" style="color:var(--mu);font-size:12px" role="status"></span></div></div></div>`);
  const si = $('#lsi'); if (si) si.onclick = () => openAuth('login');

  let pt;
  const preview = () => { clearTimeout(pt); pt = setTimeout(() => { const f = $('#lbp'); if (f) f.srcdoc = BIO.renderProfile(S.data, { username: S.username || 'username', preview: true, yt: S.yt, ytState: S.ytState === 'error' ? 'error' : 'loading', ytMsg: S.ytState === 'idle' ? 'Look up your channel in the YouTube tab.' : S.ytMsg }); }, 120); };
  const touch = () => { S.dirty = true; LS.s('lb.draft', S.data); preview(); setS(ME ? 'Unsaved changes' : ''); };
  on(window, 'beforeunload', e => { if (S.dirty && ME) { e.preventDefault(); e.returnValue = ''; } });

  const f = (label, html) => `<label>${label}</label>${html}`;
  const colorRow = (key, label) => `<div style="flex:1">${f(label, `<input type="color" data-k="${key}" value="${DS()[key]}">`)}</div>`;
  const upload = async file => { if (!SB.configured) throw new Error('Image uploads need the Supabase backend (see README).'); if (!ME) { openAuth('login'); throw new Error('Sign in to upload images.'); } return SB.upload(ME.id, file); };
  const fmtN = n => n == null ? '—' : Number(n).toLocaleString();

  async function lookupYt(force) {
    const q = String(D().youtube.q || '').trim();
    if (!q) { S.yt = null; S.ytState = 'idle'; S.ytMsg = ''; show(); preview(); return; }
    S.ytState = 'loading'; S.ytMsg = ''; if (S.tab === 'youtube') show();
    try { S.yt = await SB.fn('channel_full', { q, ...(force ? { t: Date.now() } : {}) }); S.ytState = 'ok'; LS.s('lb.yt.' + q, S.yt); }
    catch (e) { S.yt = null; S.ytState = 'error'; S.ytMsg = e.code === 'quota' ? 'YouTube quota reached for today. Try again later.' : e.message; }
    if (!stale()) { if (S.tab === 'youtube') show(); preview(); }
  }

  const bodies = {
    profile() {
      return `${f('Profile picture', `<div class="row" style="margin:0"><div class="lb-av">${D().avatar ? `<img src="${esc(D().avatar)}" alt="">` : esc((D().displayName || '?')[0].toUpperCase())}</div><input type="file" id="lav" accept="image/png,image/jpeg,image/webp,image/gif" style="flex:1" aria-label="Upload profile picture"><button id="lavx" ${D().avatar ? '' : 'disabled'}>Remove</button></div><div class="err" id="lae" style="min-height:18px"></div>`)}
      ${f('Banner (wide image, about 3:1)', `<div class="row" style="margin:0">${D().banner ? `<div class="lb-bn" style="background-image:url('${esc(D().banner)}')"></div>` : ''}<input type="file" id="lbn" accept="image/png,image/jpeg,image/webp,image/gif" style="flex:1" aria-label="Upload banner"><button id="lbnx" ${D().banner ? '' : 'disabled'}>Remove</button></div><div class="err" id="lbne" style="min-height:18px"></div>`)}
      ${f('Display name', `<input data-p="displayName" maxlength="60" value="${esc(D().displayName)}">`)}
      ${f('Username', `<input value="${esc(ME ? '@' + S.username : 'Sign in to choose your username')}" disabled><small style="color:var(--mu)">Change it in the Publish tab.</small>`)}
      ${f('Bio', `<textarea data-p="bio" rows="4" maxlength="300" style="font-family:inherit">${esc(D().bio)}</textarea><small style="color:var(--mu)"><span id="lbc">${D().bio.length}</span>/300</small>`)}`;
    },
    links() {
      const L = D().links.map((l, i) => `<div class="lb-link" draggable="true" data-i="${i}"><div class="row" style="margin:0;flex-wrap:nowrap"><span class="grab" title="Drag to reorder" aria-hidden="true">⠿</span><select data-l="icon" style="width:96px" aria-label="Icon">${BIO.ICON_NAMES.map(n => `<option ${n === l.icon ? 'selected' : ''}>${n}</option>`).join('')}</select><input data-l="title" placeholder="Title" maxlength="80" value="${esc(l.title)}" style="flex:1;min-width:0" aria-label="Link title"></div><div class="row" style="margin:6px 0 0;flex-wrap:nowrap"><input data-l="url" placeholder="https://…" value="${esc(l.url)}" style="flex:1;min-width:0" aria-label="Link URL"><button data-up title="Move up" aria-label="Move up">↑</button><button data-dn title="Move down" aria-label="Move down">↓</button><button data-del title="Delete" aria-label="Delete link">✕</button></div><div class="err" data-le style="font-size:12px"></div></div>`).join('');
      const S2 = D().socials.map((s, i) => `<div class="row" style="flex-wrap:nowrap" data-si="${i}"><select data-s="type" style="width:110px" aria-label="Platform">${Object.entries(BIO.SOCIALS).map(([k, n]) => `<option value="${k}" ${k === s.type ? 'selected' : ''}>${n}</option>`).join('')}</select><input data-s="url" value="${esc(s.url)}" placeholder="https://…" style="flex:1;min-width:0" aria-label="Profile URL"><button data-sdel aria-label="Remove">✕</button></div>`).join('');
      return `<div id="lll">${L || '<p class="d">No links yet. Add your first one.</p>'}</div><div class="row"><button class="pri" id="lad">+ Add link</button></div><h2>Social links</h2>${S2 || '<p class="d" style="margin:0">Twitch, YouTube, Kick, X, Instagram, TikTok, Discord…</p>'}<div class="row"><button id="lsa" ${D().socials.length >= 20 ? 'disabled' : ''}>+ Add social</button></div>`;
    },
    youtube() {
      const y = D().youtube, c = S.yt;
      const card = S.ytState === 'loading' ? '<p class="d">Looking up channel…</p>'
        : S.ytState === 'error' ? `<p class="err">${esc(S.ytMsg)}</p>`
        : c ? `<div class="panel" style="margin-top:10px;display:flex;gap:12px;align-items:center">${c.avatar ? `<img src="${esc(c.avatar)}" alt="" referrerpolicy="no-referrer" style="width:56px;height:56px;border-radius:50%">` : ''}<div style="min-width:0"><b>${esc(c.title)}</b><div style="color:var(--mu);font-size:12px">${c.subscribers != null ? fmtN(c.subscribers) + ' subscribers' : 'Subscriber count hidden'} · ${fmtN(c.videoCount)} videos · ${c.videos.length} recent shown</div><div style="color:var(--mu);font-size:12px">ID ${esc(c.id)}</div></div></div>` : '';
      return `<p class="d" style="margin:0 0 6px">Show your YouTube channel and latest videos on your page. Uses public channel data only.</p>
      ${f('Channel (@handle, channel URL or channel ID)', `<div class="row" style="margin:0;flex-wrap:nowrap"><input id="lyq" value="${esc(y.q)}" placeholder="@voqcl or https://youtube.com/@voqcl" spellcheck="false" style="flex:1;min-width:0"><button class="pri" id="lyl">Look up</button></div>`)}
      <label class="sw">Show on my page<input type="checkbox" id="lys" ${y.show !== false ? 'checked' : ''}></label>
      ${card}<div class="row"><button id="lyr" ${y.q ? '' : 'disabled'}>Refresh data</button><button id="lyx" ${y.q ? '' : 'disabled'}>Remove channel</button></div>
      <div class="note">Your page loads fresh channel info each time it's viewed (cached for about 10 minutes). Data comes from the YouTube Data API.</div>`;
    },
    design() {
      const d = DS();
      return `<label>Presets</label><div class="row" style="margin:0" id="lpr">${Object.keys(BIO.PRESETS).map(k => { const p = BIO.PRESETS[k]; return `<button data-pr="${k}" style="background:linear-gradient(135deg,${p.bg1},${p.bg2});color:${p.textColor};text-transform:capitalize;min-width:84px">${k}</button>`; }).join('')}</div>
      <div class="row"><button id="lrs">Reset design</button></div>
      ${f('Background', `<select data-k="bgType"><option value="color" ${d.bgType === 'color' ? 'selected' : ''}>Solid colour</option><option value="gradient" ${d.bgType === 'gradient' ? 'selected' : ''}>Gradient</option><option value="image" ${d.bgType === 'image' ? 'selected' : ''}>Image</option></select>`)}
      <div class="row">${colorRow('bg1', 'Colour 1')}${d.bgType === 'gradient' ? colorRow('bg2', 'Colour 2') : ''}</div>
      ${d.bgType === 'gradient' ? f(`Angle: ${d.angle}°`, `<input type="range" min="0" max="360" data-k="angle" value="${d.angle}">`) : ''}
      ${d.bgType === 'image' ? f('Background image', `<input type="file" id="lbg" accept="image/png,image/jpeg,image/webp,image/gif"><div class="err" id="lbe" style="min-height:18px"></div>`) : ''}
      ${f('Font', `<select data-k="font">${Object.keys(BIO.FONTS).map(n => `<option ${n === d.font ? 'selected' : ''}>${n}</option>`).join('')}</select>`)}
      <div class="row">${colorRow('textColor', 'Text')}${colorRow('btnColor', 'Buttons')}${colorRow('btnText', 'Button text')}</div>
      <div class="row"><div style="flex:1">${f('Button shape', `<select data-k="btnShape">${['pill', 'round', 'square'].map(n => `<option ${n === d.btnShape ? 'selected' : ''}>${n}</option>`).join('')}</select>`)}</div><div style="flex:1">${f('Button style', `<select data-k="btnStyle">${['fill', 'outline', 'shadow'].map(n => `<option ${n === d.btnStyle ? 'selected' : ''}>${n}</option>`).join('')}</select>`)}</div></div>
      ${f(`Spacing: ${d.spacing}px`, `<input type="range" min="4" max="28" data-k="spacing" value="${d.spacing}">`)}
      ${f('Layout', `<select data-k="layout"><option value="stack" ${d.layout === 'stack' ? 'selected' : ''}>Single column</option><option value="grid" ${d.layout === 'grid' ? 'selected' : ''}>Grid</option></select>`)}`;
    },
    publish() {
      if (!SB.configured) return '<p class="d">Publishing needs the Supabase backend configured in <code>config.js</code>. See README → "Accounts & bio pages".</p>';
      if (!ME) return '<p class="d">Create a free account to save and publish your page.</p><div class="row"><button class="pri" id="lp1">Sign in / Create account</button></div>';
      const local = HERE !== SITE ? `<div class="note">You're running this copy at <code>${esc(HERE)}</code>. Once the site is live on ${esc(SITE.replace(/^https?:\/\//, ''))}, your page is at the address above. <a href="${esc(HERE + '/bio/' + S.username)}" target="_blank" rel="noopener" style="text-decoration:underline">Open it on this copy</a>.</div>` : '';
      return `<div class="row" style="margin:0"><span class="chip ${S.published ? 'on' : ''}">${S.published ? 'Published' : 'Not published'}</span><span style="color:var(--mu)">${S.saved ? (S.dirty ? 'Unsaved changes' : 'All changes saved') : 'Not saved yet'}</span></div>
      ${f('Your page address', `<div class="row" style="margin:0;flex-wrap:nowrap"><span style="color:var(--mu);white-space:nowrap">${esc(SITE.replace(/^https?:\/\//, ''))}/bio/</span><input id="lsl" value="${esc(S.username)}" maxlength="24" spellcheck="false" aria-label="Username"></div><small style="color:var(--mu)">This is also your username. 3-24 lowercase letters, numbers or underscores.</small>`)}
      <div class="row"><code style="flex:1;min-width:200px;padding:10px" id="lpu">${esc(bioUrl(S.username))}</code></div>
      <div class="row"><button class="pri" id="lsv">Save</button><button id="lpb">${S.published ? 'Unpublish' : 'Publish'}</button><button id="lcp">Copy link</button><a class="btn" id="lop" target="_blank" rel="noopener" href="${esc(bioUrl(S.username))}" ${S.published ? '' : 'hidden'}>Open page</a></div>
      <div class="err" id="lpe" style="min-height:20px;margin-top:8px" role="alert"></div><div class="ok" id="lpm" role="status"></div>${local}
      <div class="note">Only you can edit this page. Anyone can view it once it's published. Unpublishing hides it right away.</div>`;
    },
  };

  async function save() {
    const uname = S.username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,24}$/.test(uname)) throw new Error('Usernames are 3-24 characters: lowercase letters, numbers and underscores.');
    const patch = { data: BIO.normalize(S.data) };
    if (uname !== ME.username) patch.username = uname;
    const row = await SB.saveProfile(ME.id, patch);
    S.username = row.username; ME.username = row.username; ME.profile = row; S.saved = true; S.dirty = false; S.published = !!row.published;
    LS.s('lb.draft', null); setS('Saved'); paintAccount();
  }

  function bind() {
    const b = $('#lbb');
    $$('[data-p]', b).forEach(i => i.oninput = () => { D()[i.dataset.p] = i.value; if (i.dataset.p === 'bio') $('#lbc').textContent = i.value.length; if (i.dataset.p === 'displayName') { const av = $('.lb-av', b); if (av && !D().avatar) av.textContent = (i.value[0] || '?').toUpperCase(); } touch(); });
    const img = (inputId, errId, key, clearId) => {
      const inp = $('#' + inputId, b); if (!inp) return;
      inp.onchange = async () => { const fl = inp.files[0]; if (!fl) return; $('#' + errId).textContent = 'Uploading…'; try { D()[key] = await upload(fl); $('#' + errId).textContent = ''; touch(); show(); } catch (e) { $('#' + errId).textContent = e.message; } };
      $('#' + clearId, b).onclick = () => { D()[key] = ''; touch(); show(); };
    };
    img('lav', 'lae', 'avatar', 'lavx'); img('lbn', 'lbne', 'banner', 'lbnx');
    /* links */
    $$('.lb-link', b).forEach(row => {
      const i = +row.dataset.i, L = D().links[i];
      $$('[data-l]', row).forEach(inp => inp.oninput = inp.onchange = () => { L[inp.dataset.l] = inp.value; touch(); if (inp.dataset.l === 'url') $('[data-le]', row).textContent = !inp.value || BIO.safeUrl(inp.value) ? '' : 'Enter a full link starting with https://'; });
      $('[data-del]', row).onclick = () => { D().links.splice(i, 1); touch(); show(); };
      $('[data-up]', row).onclick = () => { if (i > 0) { [D().links[i - 1], D().links[i]] = [D().links[i], D().links[i - 1]]; touch(); show(); } };
      $('[data-dn]', row).onclick = () => { if (i < D().links.length - 1) { [D().links[i + 1], D().links[i]] = [D().links[i], D().links[i + 1]]; touch(); show(); } };
      row.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', String(i)); e.dataTransfer.effectAllowed = 'move'; row.classList.add('drag'); });
      row.addEventListener('dragend', () => row.classList.remove('drag'));
      row.addEventListener('dragover', e => { e.preventDefault(); row.classList.add('over'); });
      row.addEventListener('dragleave', () => row.classList.remove('over'));
      row.addEventListener('drop', e => { e.preventDefault(); const from = +e.dataTransfer.getData('text/plain'); if (Number.isInteger(from) && from !== i) { const [m] = D().links.splice(from, 1); D().links.splice(i, 0, m); touch(); show(); } });
    });
    const ad = $('#lad', b); if (ad) ad.onclick = () => { D().links.push({ id: rid(), title: '', url: '', icon: 'link' }); touch(); show(); const t = $$('[data-l=title]', b).pop(); t && t.focus(); };
    const sa = $('#lsa', b); if (sa) sa.onclick = () => { D().socials.push({ type: 'twitch', url: '' }); touch(); show(); };
    $$('[data-si]', b).forEach(row => { const s = D().socials[+row.dataset.si]; $$('[data-s]', row).forEach(inp => inp.oninput = inp.onchange = () => { s[inp.dataset.s] = inp.value; touch(); }); $('[data-sdel]', row).onclick = () => { D().socials.splice(+row.dataset.si, 1); touch(); show(); }; });
    /* youtube */
    const yl = $('#lyl', b);
    if (yl) {
      const go = () => { D().youtube.q = $('#lyq').value.trim(); touch(); lookupYt(); };
      yl.onclick = go; $('#lyq').addEventListener('keydown', e => e.key === 'Enter' && go());
      $('#lys').onchange = () => { D().youtube.show = $('#lys').checked; touch(); };
      $('#lyr').onclick = () => lookupYt(true);
      $('#lyx').onclick = () => { D().youtube = { q: '', show: true }; S.yt = null; S.ytState = 'idle'; touch(); show(); };
    }
    /* design */
    $$('[data-k]', b).forEach(inp => inp.oninput = inp.onchange = () => { const k = inp.dataset.k; DS()[k] = inp.type === 'range' ? Number(inp.value) : inp.value; DS().preset = 'custom'; touch(); if (k === 'bgType') show(); else if (inp.type === 'range') inp.previousElementSibling.textContent = k === 'angle' ? `Angle: ${inp.value}°` : `Spacing: ${inp.value}px`; });
    $$('[data-pr]', b).forEach(btn => btn.onclick = () => { const keepImg = DS().bgImage; S.data.design = { ...BIO.PRESETS[btn.dataset.pr], preset: btn.dataset.pr, bgImage: keepImg }; touch(); show(); });
    const rs = $('#lrs', b); if (rs) rs.onclick = () => { S.data.design = baseDesign(); touch(); show(); };
    const bg = $('#lbg', b); if (bg) bg.onchange = async () => { const fl = bg.files[0]; if (!fl) return; $('#lbe').textContent = 'Uploading…'; try { DS().bgImage = await upload(fl); DS().preset = 'custom'; touch(); $('#lbe').innerHTML = '<span class="ok">Image added.</span>'; } catch (e) { $('#lbe').textContent = e.message; } };
    /* publish */
    const p1 = $('#lp1', b); if (p1) p1.onclick = () => openAuth('login');
    const sl = $('#lsl', b); if (sl) sl.oninput = () => { sl.value = sl.value.toLowerCase().replace(/[^a-z0-9_]/g, ''); S.username = sl.value; $('#lpu').textContent = bioUrl(S.username); S.dirty = true; preview(); };
    const flash = (m, bad) => { $('#lpe').textContent = bad ? m : ''; $('#lpm').textContent = bad ? '' : m; };
    const run = async (btn, fn) => { btn.disabled = true; try { flash(''); await fn(); } catch (e) { if ($('#lpe')) flash(e.message, true); } if (btn.isConnected) btn.disabled = false; };
    const sv = $('#lsv', b); if (sv) sv.onclick = () => run(sv, async () => { await save(); show(); flash('Saved.'); });
    const pb = $('#lpb', b); if (pb) pb.onclick = () => run(pb, async () => {
      if (S.dirty || !S.saved) await save();
      const row = await SB.saveProfile(ME.id, { published: !S.published });
      S.published = !!row.published; ME.profile = row; show(); flash(S.published ? `Published. Your page is live at ${bioUrl(S.username)}` : 'Unpublished. Your page is hidden.');
    });
    const cp = $('#lcp', b); if (cp) cp.onclick = () => copy(bioUrl(S.username), cp);
  }
  function show() {
    $$('#lt .chip').forEach(c => c.classList.toggle('on', c.dataset.t === S.tab));
    const box = $('#lbb'); if (!box) return;
    const y = box.scrollTop; box.innerHTML = bodies[S.tab](); bind(); box.scrollTop = y;
  }
  $$('#lt .chip').forEach(c => { c.onclick = () => { S.tab = c.dataset.t; show(); }; c.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); c.click(); } }; });
  show(); preview();
  setS(ME ? (S.saved ? (S.dirty ? 'Unsaved changes' : '') : 'Not saved yet') : '');
  if (D().youtube.q) { const cached = LS.g('lb.yt.' + D().youtube.q, null); if (cached) { S.yt = cached; S.ytState = 'ok'; preview(); } if (SB.configured) lookupYt(); }
}

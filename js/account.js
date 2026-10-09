/* ===== Accounts (Supabase Auth): sign in, create account, forgot/reset password ===== */
let ME = null;           // { id, email, username, profile }
let AUTH_NOTICE = '';    // message to show after returning from an email link

/* Email links (confirm sign-up / reset password) come back as #access_token=...&type=signup|recovery */
async function consumeAuthHash() {
  const h = location.hash;
  if (!/access_token=|error_description=/.test(h)) return false;
  try {
    const type = await SB.fromHash(h);
    history.replaceState(null, '', location.pathname + (type === 'recovery' ? '#/reset' : '#/'));
    if (type === 'signup') AUTH_NOTICE = 'Email confirmed. You are signed in.';
  } catch (e) { AUTH_NOTICE = e.message; history.replaceState(null, '', location.pathname + '#/'); }
  return true;
}
const meReady = (async () => { await consumeAuthHash(); try { ME = await SB.me(); } catch { ME = null; } })();

async function refreshMe() { try { ME = await SB.me(); } catch { ME = null; } paintAccount(); }

function paintAccount() {
  $$('.acct-slot').forEach(slot => {
    slot.innerHTML = '';
    if (!ME) {
      const b = document.createElement('button'); b.className = 'btn pri acct-btn'; b.textContent = 'Sign in'; b.onclick = () => openAuth('login'); slot.append(b);
    } else {
      const wrap = document.createElement('div'); wrap.className = 'acct-menu';
      wrap.innerHTML = `<button class="btn acct-btn" aria-haspopup="true">@${esc(ME.username || 'account')} ▾</button><div class="acct-dd" hidden><a href="#/tool/linkbio">My bio page</a><a href="#/account">Account</a><button data-out>Sign out</button></div>`;
      const dd = $('.acct-dd', wrap);
      $('button', wrap).onclick = e => { e.stopPropagation(); dd.hidden = !dd.hidden; };
      $('[data-out]', wrap).onclick = async () => { await SB.signOut(); ME = null; paintAccount(); if (/linkbio|account/.test(location.hash)) render(); };
      dd.addEventListener('click', () => { dd.hidden = true; });
      slot.append(wrap);
    }
  });
}
document.addEventListener('click', () => $$('.acct-dd').forEach(d => d.hidden = true));
const rerunCurrent = () => { const el = $('#tp'); if (el && el.dataset.tool) rerun(el); else if (/^#\/account/.test(location.hash)) render(); };

function modal(html) {
  closeModal();
  const bg = document.createElement('div'); bg.className = 'modal-bg'; bg.id = 'modal';
  bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  bg.addEventListener('mousedown', e => { if (e.target === bg) closeModal(); });
  document.body.append(bg);
  const f = $('input', bg); f && f.focus();
  return bg;
}
const closeModal = () => { const m = $('#modal'); if (m) m.remove(); };
addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

function openAuth(mode = 'login') {
  if (!SB.configured) {
    modal(`<div class="mh"><b>Accounts not set up yet</b><button class="x" data-x aria-label="Close">✕</button></div><p class="d" style="margin:0">This copy of the site has no account backend configured. The site owner needs to add the Supabase URL and key to <code>config.js</code> (see README). All overlays and utilities still work without an account.</p>`);
    $('[data-x]').onclick = closeModal; return;
  }
  const titles = { login: 'Sign in', register: 'Create account', forgot: 'Reset password' };
  const m = modal(`<div class="mh"><b>${titles[mode]}</b><button class="x" data-x aria-label="Close">✕</button></div>
  <div class="tabs"><span class="chip ${mode === 'login' ? 'on' : ''}" data-m="login">Sign in</span><span class="chip ${mode === 'register' ? 'on' : ''}" data-m="register">Create account</span></div>
  <div data-body></div><div class="err" data-err style="min-height:20px;margin-top:8px" role="alert"></div><div class="ok" data-msg role="status"></div>`);
  $('[data-x]', m).onclick = closeModal;
  $$('[data-m]', m).forEach(c => c.onclick = () => openAuth(c.dataset.m));
  const body = $('[data-body]', m), err = $('[data-err]', m), msg = $('[data-msg]', m);
  const fld = (id, label, type = 'text', extra = '') => `<label for="${id}">${label}</label><input id="${id}" type="${type}" ${extra}>`;
  const bind = (btn, fn) => {
    const run = async () => { err.textContent = ''; msg.textContent = ''; btn.disabled = true; const t = btn.textContent; btn.textContent = 'Please wait…'; try { await fn(); } catch (e) { err.textContent = e.message; } btn.disabled = false; btn.textContent = t; };
    btn.onclick = run; body.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') run(); });
  };
  const done = async () => { await refreshMe(); closeModal(); rerunCurrent(); };
  if (mode === 'login') {
    body.innerHTML = fld('ae', 'Email', 'email', 'autocomplete="email"') + fld('ap', 'Password', 'password', 'autocomplete="current-password"') + `<div class="row"><button class="pri" data-go>Sign in</button><button data-f>Forgot password?</button></div>`;
    $('[data-f]', m).onclick = () => openAuth('forgot');
    bind($('[data-go]', m), async () => {
      if (!/^\S+@\S+\.\S+$/.test($('#ae').value.trim())) throw new Error('Enter the email you signed up with.');
      await SB.signIn($('#ae').value, $('#ap').value); await done();
    });
  } else if (mode === 'register') {
    body.innerHTML = fld('ae', 'Email', 'email', 'autocomplete="email"') + fld('au', 'Username — your page will be voqcl.com/bio/<username>', 'text', 'autocomplete="username" spellcheck="false" maxlength="24" placeholder="3-24 letters, numbers, _"') + '<small id="aun" style="display:block;color:var(--mu);margin-top:3px;min-height:16px"></small>' + fld('ap', 'Password (8+ characters)', 'password', 'autocomplete="new-password"') + fld('ac', 'Confirm password', 'password', 'autocomplete="new-password"') + `<div class="row"><button class="pri" data-go>Create account</button></div>`;
    $('#au').oninput = () => { const v = $('#au').value.toLowerCase().replace(/[^a-z0-9_]/g, ''); $('#au').value = v; $('#aun').textContent = v ? `Your page: ${bioUrl(v)}` : ''; };
    bind($('[data-go]', m), async () => {
      const email = $('#ae').value.trim(), u = $('#au').value.trim(), p = $('#ap').value;
      if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Enter a valid email address.');
      if (!/^[a-z0-9_]{3,24}$/.test(u)) throw new Error('Usernames are 3-24 characters: lowercase letters, numbers and underscores.');
      if (p.length < 8) throw new Error('Password must be at least 8 characters.');
      if (p !== $('#ac').value) throw new Error('Passwords do not match.');
      const r = await SB.signUp(email, p, u);
      if (r.confirm) { body.innerHTML = `<p style="margin:6px 0">Almost done. We sent a confirmation link to <b>${esc(email)}</b>. Open it to finish creating your account.</p>`; return; }
      await done();
    });
  } else {
    body.innerHTML = `<p class="d" style="margin:6px 0">Enter your account email and we'll send you a link to choose a new password.</p>` + fld('ae', 'Email', 'email', 'autocomplete="email"') + `<div class="row"><button class="pri" data-go>Send reset link</button><button data-b>Back</button></div>`;
    $('[data-b]', m).onclick = () => openAuth('login');
    bind($('[data-go]', m), async () => {
      if (!/^\S+@\S+\.\S+$/.test($('#ae').value.trim())) throw new Error('Enter a valid email address.');
      await SB.recover($('#ae').value); msg.textContent = 'If that email has an account, a reset link is on its way. Check your inbox (and spam).';
    });
  }
}

/* #/reset — reached through the emailed recovery link (the session is already set from the link's tokens) */
function resetPage(app) {
  if (!SB.session) { app.innerHTML = page('Reset link expired', 'Open the link from your newest reset email, or request a new one.', '<button class="pri" id="rq">Send a new link</button>'); $('#rq').onclick = () => openAuth('forgot'); return; }
  app.innerHTML = page('Choose a new password', 'Enter a new password for your account.', `<div class="panel" style="max-width:420px"><label for="rp">New password (8+ characters)</label><input id="rp" type="password" autocomplete="new-password"><label for="rc">Confirm password</label><input id="rc" type="password" autocomplete="new-password"><div class="row"><button class="pri" id="rg">Set password</button></div><div class="err" id="re" style="margin-top:8px" role="alert"></div><div class="ok" id="rm" role="status"></div></div>`);
  const go = async () => {
    $('#re').textContent = '';
    if ($('#rp').value.length < 8) { $('#re').textContent = 'Password must be at least 8 characters.'; return; }
    if ($('#rp').value !== $('#rc').value) { $('#re').textContent = 'Passwords do not match.'; return; }
    $('#rg').disabled = true;
    try { await SB.updatePassword($('#rp').value); await refreshMe(); $('#rm').textContent = 'Password updated. You are signed in.'; }
    catch (e) { $('#re').textContent = e.message; $('#rg').disabled = false; }
  };
  $('#rg').onclick = go; $('#rc').addEventListener('keydown', e => e.key === 'Enter' && go());
}

/* #/account — private settings (email, password), separate from the public bio page */
function accountPage(app) {
  if (!ME) { app.innerHTML = page('Account', 'Sign in to manage your account.', '<button class="pri" id="asi">Sign in</button>'); $('#asi').onclick = () => openAuth('login'); return; }
  app.innerHTML = page('Account', 'Private settings. Nothing on this page is shown publicly.', `<div class="panel" style="max-width:480px"><label>Email</label><input value="${esc(ME.email)}" disabled><label>Username</label><input value="@${esc(ME.username)}" disabled><small style="color:var(--mu)">Change your username (and page address) in the bio page editor.</small>
  <h2>Change password</h2><label for="np">New password</label><input id="np" type="password" autocomplete="new-password"><label for="nc">Confirm</label><input id="nc" type="password" autocomplete="new-password"><div class="row"><button class="pri" id="ng">Update password</button></div><div class="err" id="ne"></div><div class="ok" id="nm"></div></div>`);
  $('#ng').onclick = async () => {
    $('#ne').textContent = $('#nm').textContent = '';
    if ($('#np').value.length < 8) return $('#ne').textContent = 'Password must be at least 8 characters.';
    if ($('#np').value !== $('#nc').value) return $('#ne').textContent = 'Passwords do not match.';
    try { await SB.updatePassword($('#np').value); $('#nm').textContent = 'Password updated.'; $('#np').value = $('#nc').value = ''; } catch (e) { $('#ne').textContent = e.message; }
  };
}

# Browser tests (Chromium via Playwright) against tests/mock-stack.mjs.
#   node --experimental-strip-types tests/mock-stack.mjs &   then   python3 tests/ui_test.py
import re, sys, json, urllib.request, subprocess
from playwright.sync_api import sync_playwright
import cv2

BASE, SB = 'http://127.0.0.1:8124', 'http://127.0.0.1:8125'
PNG = bytes.fromhex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63fcffff3f0300090301ff4e5b3b6a0000000049454e44ae426082')
results, fails, errors = [], [], []
def check(name, cond, info=''):
    results.append(bool(cond))
    if not cond: fails.append(f'{name}  [{info}]')
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{info}]' if (info and not cond) else ''))
def sbtest(path): return json.loads(urllib.request.urlopen(SB + path).read())

with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx = b.new_context(viewport={'width': 1280, 'height': 900}, permissions=['clipboard-read', 'clipboard-write'], accept_downloads=True)
    ctx.add_init_script("window.addEventListener('error',e=>console.error('ERR_STACK '+(e.error&&e.error.stack)))")
    def wire(page):
        page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
        page.on('console', lambda m: m.type == 'error' and not m.text.startswith('Failed to load resource: the server responded with a status of 4') and errors.append('console: ' + m.text))
        page.route(re.compile(r'(7tv\.io|betterttv\.net)'), lambda r: r.fulfill(status=200, content_type='application/json', body='{}'))
        page.route(re.compile(r'decapi\.me/twitch/followcount/'), lambda r: r.fulfill(status=200, body='1234'))
        page.route(re.compile(r'decapi\.me/twitch/avatar/'), lambda r: r.fulfill(status=200, body=BASE + '/assets/favicon.png'))
        page.route(re.compile(r'static-cdn\.jtvnw\.net'), lambda r: r.fulfill(status=200, content_type='image/png', body=PNG))
        def irc(ws):
            def on(m):
                if 'JOIN #' in m:
                    for l in [':tmi.twitch.tv 001 justinfan1 :Welcome', ':justinfan1!justinfan1@justinfan1.tmi.twitch.tv JOIN #voqcl', '@room-id=12345 :tmi.twitch.tv ROOMSTATE #voqcl',
                              '@badges=moderator/1;color=#1E90FF;display-name=TwitchAlice;emotes=25:6-10;id=m1;tmi-sent-ts=1700000000000 :twitchalice!twitchalice@x.tmi.twitch.tv PRIVMSG #voqcl :hello Kappa world',
                              '@display-name=Nightbot;id=m2;tmi-sent-ts=1700000000001 :nightbot!nightbot@x.tmi.twitch.tv PRIVMSG #voqcl :I am a hidden bot', 'PING :tmi.twitch.tv']:
                        ws.send(l + '\r\n')
            ws.on_message(on)
        page.route_web_socket(re.compile(r'irc-ws\.chat\.twitch\.tv'), irc)
        return page
    page = wire(ctx.new_page())

    # ---------- site structure ----------
    page.goto(BASE + '/'); page.wait_for_selector('.h-row')
    check('home: 7 overlays + 8 utilities + featured Multiview', page.locator('.h-cols > div:nth-child(1) .h-row').count() == 7 and page.locator('.h-cols > div:nth-child(2) .h-row').count() == 8 and page.locator('.h-feat').count() == 1)
    check('home: no CS2 / ChatIS anywhere', not re.search(r'CS2|ChatIS|chatis', page.content()))
    check('home: Sign in top-right', page.locator('.h-top .acct-slot button:has-text("Sign in")').count() == 1)
    check('logo + favicon load (relative paths)', page.evaluate("() => { const i=document.querySelector('.h-logo'); return i.complete && i.naturalWidth>0 }") and page.evaluate("() => document.querySelector('link[rel=icon]').href") == BASE + '/assets/favicon.png')
    page.goto(BASE + '/#/tools'); page.wait_for_selector('.card'); names = page.locator('.card b').all_inner_texts()
    check('tools page: exactly 16 tools', len(names) == 16, str(names))
    for gone in ['cs2', 'chatis', 'follow', 'discord', 'json', 'ytthumb', 'pomo', 'calc', 'color', 'regex', 'stopwatch', 'sched']:
        page.goto(BASE + f'/#/tool/{gone}'); page.wait_for_selector('h1'); check(f'removed tool "{gone}" -> not found', 'Tool not found' in page.inner_text('#app'))
    page.goto(BASE + '/#/tools'); page.fill('#q', 'qr'); check('search filters', page.locator('.card').count() == 1)
    page.goto(BASE + '/#/c/obs'); page.wait_for_selector('.card'); check('Overlays category: 7', page.locator('.card').count() == 7)
    page.goto(BASE + '/#/c/util'); page.wait_for_selector('.card'); check('Utilities category: 9', page.locator('.card').count() == 9)
    for t in ['multiview', 'mask', 'bgr']:
        page.goto(BASE + f'/#/tool/{t}'); page.wait_for_selector('h1'); check(f'kept tool {t} loads', 'went wrong' not in page.inner_text('#app') and 'not found' not in page.inner_text('h1').lower())
    r = page.goto(BASE + '/some/unknown/page'); page.wait_for_selector('h1'); check('unknown path -> styled 404 page', r.status == 404 and 'Page not found' in page.inner_text('h1'))

    # ---------- overlay URL generators ----------
    for t, tool in [('chat','chat'),('emote','emote'),('followtracker','followlive'),('countdown','countdown'),('goal','goal'),('ticker','ticker'),('scene','scene')]:
        page.goto(BASE + f'/#/tool/{tool}')
        if tool == 'followlive': page.wait_for_selector('#go'); page.fill('#c', 'voqcl'); page.click('#go')
        page.wait_for_selector('code[data-u]'); url = page.locator('code[data-u]').first.inner_text()
        check(f'generator {t}: https://voqcl.com/#/live/voqcl/overlay/{t}?user=voqcl', url.startswith(f'https://voqcl.com/#/live/voqcl/overlay/{t}?') and 'user=voqcl' in url, url)
        page.locator('[data-cp]').first.click(); check(f'generator {t}: copy = full URL', page.evaluate('navigator.clipboard.readText()') == url)
    page.goto(BASE + '/#/tool/chat'); page.wait_for_selector('[data-f]')
    page.select_option('[data-f] select >> nth=0', 'youtube'); page.fill('[data-f] input[type=text] >> nth=0', '@some channel&x'); page.wait_for_timeout(100)
    u = page.locator('code[data-u]').inner_text(); check('chat URL encodes user + keeps platform', 'platform=youtube' in u and 'user=%40some+channel%26x' in u, u)
    page.wait_for_function("() => document.querySelector('[data-st]')?.textContent.includes('YouTube chat: enabled')"); check('chat tool shows YouTube enabled (function config)', True)
    page.reload(); page.wait_for_selector('[data-f]'); check('generator settings persist after reload', page.locator('[data-f] select >> nth=0').input_value() == 'youtube')
    page.fill('[data-d]', 'ftp://bad'); check('bad domain -> error + copy disabled', page.locator('[data-e]').inner_text() != '' and page.locator('[data-cp]').is_disabled())
    page.click('[data-loc]'); check('"Use this site\'s address" fills current origin', page.locator('[data-d]').input_value() == BASE)
    page.fill('[data-d]', 'https://voqcl.com'); page.click('[data-f] button:has-text("Reset")'); page.wait_for_selector('[data-f]')

    # ---------- overlays load independently (OBS) ----------
    ov = wire(ctx.new_page())
    def load(h, sel): ov.goto(BASE + h); ov.reload(); ov.wait_for_selector(sel, timeout=10000)
    load('/#/live/voqcl/overlay/chat?user=voqcl', '.msg'); tx = ov.locator('.msg').all_inner_texts()
    check('Twitch chat: message, emote, bot hidden, avatar + tag', any('TwitchAlice' in t and 'world' in t for t in tx) and ov.locator('img.emo').count() == 1 and not any('hidden bot' in t for t in tx) and ov.locator('.msg .av').count() == 1)
    check('overlay: transparent background, no site header', ov.evaluate("getComputedStyle(document.body).backgroundColor") in ('rgba(0, 0, 0, 0)', 'transparent') and not ov.locator('header').is_visible())
    load('/#/live/voqcl/overlay/chat?user=@mockchannel&platform=youtube', '.msg.youtube'); tx = ov.locator('.msg.youtube').all_inner_texts()
    check('YouTube chat via Edge Function: messages + super chat', any('YtAlice' in t and 'hello from youtube' in t for t in tx) and any('$5.00' in t for t in tx), str(tx))
    ov.wait_for_timeout(2600); check('YouTube chat: repeated polls do not duplicate messages', ov.locator('.msg.youtube').count() == 2)
    check('YouTube chat: profile picture loads', ov.evaluate("() => { const i=document.querySelector('.msg.youtube img.av'); return !!i && i.complete && i.naturalWidth>0 }"))
    load('/#/live/voqcl/overlay/chat?user=a', '.ovst'); check('invalid Twitch name -> error', 'Invalid Twitch channel' in ov.inner_text('.ovst'))
    load('/#/live/voqcl/overlay/countdown?user=voqcl&minutes=5&label=Soon', '.cdt'); check('countdown ~05:00', re.match(r'0[45]:\d\d', ov.inner_text('.cdt')))
    load('/#/live/voqcl/overlay/goal?user=voqcl&current=50&goal=200', '.gn'); check('goal manual 25%', '50 / 200 (25%)' in ov.inner_text('.gn'))
    load('/#/live/voqcl/overlay/goal?user=@mockchannel&source=youtube&goal=10000', '.gn'); ov.wait_for_function("() => document.querySelector('.gn').textContent.includes('5,000')"); check('goal YouTube subs (function)', True)
    load('/#/live/voqcl/overlay/ticker?user=voqcl&text=Hello%20world|Two', '.tin'); x1 = ov.evaluate("document.querySelector('.tin').getBoundingClientRect().x"); ov.wait_for_timeout(400); check('ticker scrolls', ov.evaluate("document.querySelector('.tin').getBoundingClientRect().x") < x1)
    load('/#/live/voqcl/overlay/scene?user=voqcl&title=BRB&minutes=2', '.ovs'); check('scene title + timer', 'BRB' in ov.inner_text('.st') and ov.locator('.sc').count() == 1)
    load('/#/live/voqcl/overlay/emote?user=voqcl&n=4&every=1', '.em'); check('emote bursts', ov.locator('.em').count() >= 4)
    load('/#/live/voqcl/overlay/followtracker?user=voqcl', '.cnt'); ov.wait_for_function("() => document.querySelector('.cnt').textContent.includes('1,234')"); check('follow tracker Twitch', True)
    load('/#/live/voqcl/overlay/followtracker?user=@mockchannel&platform=youtube', '.cnt'); ov.wait_for_function("() => document.querySelector('.cnt').textContent.includes('5,000')"); check('follow tracker YouTube (function)', 'Subscribers' in ov.inner_text('.lb'))
    load('/#/live/voqcl/overlay', '.cnt'); check('base URL /#/live/voqcl/overlay loads (follower tracker)', True)
    for bad in ['cs2', 'chatis']: load(f'/#/live/voqcl/overlay/{bad}', '.ove'); check(f'overlay "{bad}" rejected', 'Unknown overlay' in ov.inner_text('.ove'))
    ov.close()

    # ---------- QR ----------
    page.goto(BASE + '/#/tool/qr'); page.wait_for_selector('#qc'); page.fill('#qt', 'https://voqcl.com/bio/voqcl'); page.wait_for_timeout(200)
    with page.expect_download() as d: page.click('#qp')
    d.value.save_as('/tmp/qr.png'); txt, _, _ = cv2.QRCodeDetector().detectAndDecode(cv2.imread('/tmp/qr.png', cv2.IMREAD_GRAYSCALE))
    check('QR PNG decodes to input (OpenCV)', txt == 'https://voqcl.com/bio/voqcl', repr(txt))
    page.fill('#qt', ''); page.wait_for_timeout(100); check('QR empty -> error', 'Enter a link' in page.inner_text('#qerr') and page.locator('#qp').is_disabled())

    # ---------- accounts ----------
    page.goto(BASE + '/#/tool/linkbio'); page.wait_for_selector('.lb'); check('Link in Bio: signed-out prompt', 'not signed in' in page.inner_text('#app'))
    page.click('header .acct-slot button'); page.click('[data-m=register]')
    page.fill('#ae', 'ui@test.io'); page.fill('#au', 'UI-Tester!'); check('username input sanitised live + shows bio URL', page.input_value('#au') == 'uitester' and 'voqcl.com/bio/uitester' in page.inner_text('#aun'))
    page.fill('#ap', 'password123'); page.fill('#ac', 'nope'); page.click('[data-go]'); page.wait_for_function("() => document.querySelector('[data-err]').textContent"); check('register: mismatch error', 'do not match' in page.inner_text('[data-err]'))
    page.fill('#ac', 'password123'); page.click('[data-go]'); page.wait_for_selector('header .acct-menu'); check('registered + signed in (@uitester top-right)', '@uitester' in page.inner_text('header .acct-slot'))

    # ---------- link in bio editing ----------
    page.wait_for_selector('#lbb [data-p=displayName]'); page.fill('[data-p=displayName]', 'UI Tester'); page.fill('[data-p=bio]', 'Hello <b>bio</b>')
    page.set_input_files('#lav', {'name': 'a.png', 'mimeType': 'image/png', 'buffer': PNG}); page.wait_for_selector('.lb-av img')
    page.set_input_files('#lbn', {'name': 'b.png', 'mimeType': 'image/png', 'buffer': PNG}); page.wait_for_selector('.lb-bn')
    check('avatar + banner uploaded to Supabase storage', '/storage/v1/object/public/bio/' in page.get_attribute('.lb-av img', 'src'))
    page.set_input_files('#lav', {'name': 'x.txt', 'mimeType': 'text/plain', 'buffer': b'hello'}); page.wait_for_function("() => document.getElementById('lae').textContent.length>0"); check('non-image upload rejected', 'PNG, JPEG' in page.inner_text('#lae'))
    page.click('[data-t=links]'); page.click('#lad'); page.fill('[data-l=title] >> nth=0', 'My Site'); page.fill('[data-l=url] >> nth=0', 'https://example.com')
    page.click('#lad'); page.fill('[data-l=title] >> nth=1', 'Second'); page.fill('[data-l=url] >> nth=1', 'javascript:alert(1)'); check('bad link URL flagged', 'https://' in page.locator('[data-le] >> nth=1').inner_text())
    page.fill('[data-l=url] >> nth=1', 'second.example'); page.click('[data-dn] >> nth=0')
    check('reorder', page.locator('[data-l=title]').evaluate_all('e => e.map(x => x.value)') == ['Second', 'My Site'])
    page.click('#lsa'); page.select_option('[data-s=type]', 'youtube'); page.fill('[data-s=url]', 'https://youtube.com/@voqcl')
    page.click('[data-t=youtube]'); page.fill('#lyq', '@mockchannel'); page.click('#lyl'); page.wait_for_selector('#lbb b:has-text("Mock Channel")')
    check('YouTube lookup: name, subs, video count', '5,000 subscribers' in page.inner_text('#lbb') and '42 videos' in page.inner_text('#lbb'))
    page.fill('#lyq', '@missing'); page.click('#lyl'); page.wait_for_selector('#lbb .err'); check('YouTube lookup: unknown channel error', 'not found' in page.inner_text('#lbb .err').lower())
    page.fill('#lyq', '@mockchannel'); page.click('#lyl'); page.wait_for_selector('#lbb b:has-text("Mock Channel")')
    page.click('[data-t=design]'); page.click('[data-pr=sunset]'); page.wait_for_function("() => document.getElementById('lbp').srcdoc.includes('Mock video 1')")
    pv = page.evaluate("document.getElementById('lbp').srcdoc")
    check('live preview: name, links, socials, banner, YouTube, theme, escaping', all(s in pv for s in ['UI Tester', 'My Site', 'Second', 'YouTube', 'class="bn"', 'Mock Channel', '#ff7a59']) and '<b>bio</b>' not in pv)
    page.click('[data-t=publish]'); check('page address uses voqcl.com/bio/<username>', page.inner_text('#lpu') == 'https://voqcl.com/bio/uitester')
    page.click('#lcp'); check('copy link -> https://voqcl.com/bio/uitester', page.evaluate('navigator.clipboard.readText()') == 'https://voqcl.com/bio/uitester')
    page.click('#lpb'); page.wait_for_function("() => document.getElementById('lpm')?.textContent.includes('Published')"); check('publish', 'voqcl.com/bio/uitester' in page.inner_text('#lpm'))

    # ---------- public bio page (GitHub Pages 404.html routing) ----------
    pub = wire(ctx.new_page()); resp = pub.goto(BASE + '/bio/uitester'); pub.wait_for_selector('.links a')
    check('/bio/uitester renders via 404.html (as on GitHub Pages)', resp.status == 404 and pub.title().startswith('UI Tester'))
    check('bio page: links in saved order, socials, avatar, banner', pub.locator('.links a span').all_inner_texts() == ['Second', 'My Site'] and pub.locator('.soc a').count() == 1 and pub.locator('img.av').count() == 1 and pub.locator('.bn').count() == 1)
    check('bio page: bare domain link upgraded to https', pub.locator('.links a >> nth=0').get_attribute('href') == 'https://second.example')
    pub.wait_for_selector('.yt-v a'); check('bio page: YouTube channel + recent videos (function)', 'Mock Channel' in pub.inner_text('#yt') and pub.locator('.yt-v a').count() == 3 and '5K subscribers' in pub.inner_text('#yt'))
    pub.click('#ytr'); pub.wait_for_selector('.yt-v a'); check('bio page: YouTube refresh works', pub.locator('.yt-v a').count() == 3)
    check('bio page: no app chrome / stylesheets', pub.locator('header').count() == 0 and pub.locator('link[rel=stylesheet]').count() == 0)
    pub.set_viewport_size({'width': 375, 'height': 740}); check('bio page: mobile, no horizontal scroll', pub.evaluate("document.documentElement.scrollWidth <= innerWidth"))
    pub.reload(); pub.wait_for_selector('.links a'); check('bio page survives refresh', 'UI Tester' in pub.inner_text('h1'))
    pub.goto(BASE + '/bio/UITester'); pub.wait_for_selector('.links a'); check('bio URL is case-insensitive', True)
    for bad, why in [('/bio/nobody_here', 'No published page'), ('/bio/x!', 'not a valid username')]:
        pub.goto(BASE + bad); pub.wait_for_selector('h1'); check(f'bio {bad} -> not found', why in pub.inner_text('body'))
    page.reload(); page.wait_for_selector('#lbb [data-p=displayName]'); check('editor data persists after refresh', page.input_value('[data-p=displayName]') == 'UI Tester')

    # ---------- second user: duplicates + ownership ----------
    p2 = wire(b.new_context(permissions=['clipboard-read', 'clipboard-write']).new_page())
    p2.goto(BASE + '/#/tool/linkbio'); p2.wait_for_selector('.lb'); p2.click('header .acct-slot button'); p2.click('[data-m=register]')
    p2.fill('#ae', 'two@test.io'); p2.fill('#au', 'uitester'); p2.fill('#ap', 'password123'); p2.fill('#ac', 'password123'); p2.click('[data-go]')
    p2.wait_for_function("() => document.querySelector('[data-err]')?.textContent"); check('duplicate username blocked at sign-up', 'taken' in p2.inner_text('[data-err]'))
    p2.fill('#au', 'second_user'); p2.click('[data-go]'); p2.wait_for_selector('header .acct-menu')
    p2.wait_for_selector('#lt'); p2.click('[data-t=publish]'); p2.fill('#lsl', 'uitester'); p2.click('#lsv'); p2.wait_for_function("() => document.getElementById('lpe').textContent")
    check('changing to a taken username is blocked', 'taken' in p2.inner_text('#lpe'))
    p2.fill('#lsl', 'admin'); p2.click('#lsv'); p2.wait_for_function("() => document.getElementById('lpe').textContent.includes('reserved')"); check('reserved username blocked', True)
    p2.fill('#lsl', 'renamed_two'); p2.click('#lsv'); p2.wait_for_function("() => document.getElementById('lpm').textContent.includes('Saved')"); check('username change saved + header updated', '@renamed_two' in p2.inner_text('header .acct-slot'))
    pub.goto(BASE + '/bio/uitester'); pub.wait_for_selector('.links a'); check('other user cannot alter first user page', 'UI Tester' in pub.inner_text('h1'))
    p2.context.close()

    # ---------- password reset + account page + sign out/in ----------
    page.goto(BASE + '/#/account'); page.wait_for_selector('h1'); check('account page (private): email shown', 'ui@test.io' in page.content())
    page.click('header .acct-menu > button'); page.click('[data-out]'); page.wait_for_selector('header .acct-slot button:has-text("Sign in")')
    page.click('header .acct-slot button'); page.click('[data-f]'); page.fill('#ae', 'ui@test.io'); page.click('[data-go]'); page.wait_for_function("() => document.querySelector('[data-msg]').textContent")
    check('forgot password: neutral confirmation', 'If that email' in page.inner_text('[data-msg]'))
    link = sbtest('/__test/link?email=ui@test.io')['link']; check('reset link returns to this site', link.startswith(BASE + '/#access_token='), link)
    page.goto(link); page.wait_for_selector('#rp'); check('reset link opens "Choose a new password"', 'new password' in page.inner_text('h1').lower())
    page.fill('#rp', 'brandnew123'); page.fill('#rc', 'brandnew123'); page.click('#rg'); page.wait_for_function("() => document.getElementById('rm').textContent"); check('password updated', 'updated' in page.inner_text('#rm'))
    page.click('header .acct-menu > button'); page.click('[data-out]'); page.wait_for_selector('header .acct-slot button:has-text("Sign in")')
    page.click('header .acct-slot button'); page.fill('#ae', 'ui@test.io'); page.fill('#ap', 'password123'); page.click('[data-go]'); page.wait_for_function("() => document.querySelector('[data-err]').textContent"); check('old password rejected', 'Incorrect' in page.inner_text('[data-err]'))
    page.fill('#ap', 'brandnew123'); page.click('[data-go]'); page.wait_for_selector('header .acct-menu'); check('new password works', True)
    page.goto(BASE + '/#/tool/linkbio'); page.wait_for_selector('[data-t=links]'); page.click('[data-t=links]'); check('saved links restored after sign-in', page.locator('[data-l=title]').count() == 2)
    page.click('[data-t=publish]'); page.click('#lpb'); page.wait_for_function("() => document.getElementById('lpm')?.textContent.includes('Unpublished')")
    pub.goto(BASE + '/bio/uitester'); pub.wait_for_selector('h1'); check('unpublished page is hidden', 'Page not found' in pub.inner_text('h1'))

    # ---------- email-confirmation flow ----------
    sbtest('/__test/confirm?on=1'); p3 = wire(b.new_context().new_page()); p3.goto(BASE + '/'); p3.wait_for_selector('.h-row')
    p3.click('.h-top .acct-slot button'); p3.click('[data-m=register]'); p3.fill('#ae', 'three@test.io'); p3.fill('#au', 'third'); p3.fill('#ap', 'password123'); p3.fill('#ac', 'password123'); p3.click('[data-go]')
    p3.wait_for_selector('text=confirmation link'); check('confirm-email mode: "check your inbox" message', True)
    p3.click('[data-m=login]'); p3.fill('#ae', 'three@test.io'); p3.fill('#ap', 'password123'); p3.click('[data-go]'); p3.wait_for_function("() => document.querySelector('[data-err]').textContent"); check('unconfirmed sign-in explained', 'Confirm your email' in p3.inner_text('[data-err]'))
    p3.goto(sbtest('/__test/link?email=three@test.io')['link']); p3.wait_for_selector('.toast'); check('confirmation link signs in + toast', '@third' in p3.inner_text('.h-top .acct-slot') and 'confirmed' in p3.inner_text('.toast'))
    sbtest('/__test/confirm?on=0'); p3.context.close()

    # ---------- site with no backend configured (fresh GitHub upload) ----------
    c4 = b.new_context(); p4 = wire(c4.new_page()); p4.route('**/config.js', lambda r: r.fulfill(status=200, content_type='text/javascript', body="window.VOQCL_CONFIG={siteOrigin:'https://voqcl.com',supabaseUrl:'',supabaseAnonKey:''};"))
    p4.goto(BASE + '/'); p4.wait_for_selector('.h-row'); p4.click('.h-top .acct-slot button'); check('unconfigured: sign-in explains setup', 'not set up' in p4.inner_text('#modal'))
    p4.goto(BASE + '/#/live/voqcl/overlay/chat?user=voqcl'); p4.reload(); p4.wait_for_selector('.msg'); check('unconfigured: Twitch chat overlay still works', True)
    p4.goto(BASE + '/#/live/voqcl/overlay/chat?user=@x&platform=youtube'); p4.reload(); p4.wait_for_function("() => document.querySelector('.ovst')?.textContent.length > 0"); check('unconfigured: YouTube overlay explains setup', 'Supabase' in p4.inner_text('.ovst'))
    p4.goto(BASE + '/#/tool/linkbio'); p4.wait_for_selector('.lb'); check('unconfigured: bio editor explains setup', 'Not set up yet' in p4.inner_text('#app'))
    p4.goto(BASE + '/bio/uitester'); p4.wait_for_selector('h1'); check('unconfigured: bio page fails gracefully', 'Could not load' in p4.inner_text('h1'))
    c4.close()

    check('no JavaScript errors during the whole run', not errors, '\n'.join(errors[:6]))
    b.close()
print(f'\n{sum(results)}/{len(results)} UI checks passed')
if fails: print('FAILED:\n' + '\n'.join(fails)); sys.exit(1)

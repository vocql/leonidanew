# VOQCL TOOLS

Free stream overlays and creator tools at **voqcl.com**, hosted on **GitHub Pages**.
Accounts, bio pages and YouTube data use a free **Supabase** project (GitHub Pages can only serve static files).

- **The site's entry point is `index.html` in the top folder.** Upload the *contents* of this ZIP to the root of your GitHub repo.
- **Works immediately with no setup:** every overlay (Twitch chat, emotes, follower tracker, countdown, goal bar, ticker, scene), Multiview and all utilities.
- **Needs Supabase:** sign in, bio pages (`voqcl.com/bio/<username>`), YouTube chat, YouTube subscriber counts and YouTube on bio pages. This takes about 15 minutes, once.

## Tools (16)
**Overlays:** Chat (Twitch + YouTube), Emote, Follower tracker, Countdown, Goal bar, Text ticker, Scene screen.
**Utilities:** Multiview, Mask generator, Background remover, QR code generator, Link in Bio, Discord timestamps, Image converter, Palette extractor, Title & limit checker.
CS2 stats, ChatIS and all other earlier tools are removed, not hidden. Their code and registrations are gone, and old links show "Tool not found".

## 1. Put it on GitHub Pages
1. Create a repo (e.g. `voqcl-tools`) and upload **everything inside this ZIP** so `index.html`, `404.html`, `CNAME`, `config.js` and the `js/`, `css/` and `assets/` folders sit at the top level.
2. In the repo, go to **Settings → Pages → Build and deployment**, choose **Deploy from a branch**, then **main** and **/ (root)**, and save.
3. Set the custom domain to `voqcl.com` (the `CNAME` file already says this). At your domain registrar, add these DNS records:
   - `A` records for `@` pointing to `185.199.108.153`, `185.199.109.153`, `185.199.110.153` and `185.199.111.153`.
   - A `CNAME` for `www` pointing to `<your-github-username>.github.io`.
   - Once DNS has updated, tick **Enforce HTTPS** in the Pages settings.
4. Replace `assets/logo.png` and `assets/favicon.png` with your logo. **The ones included are placeholders.** Use a square PNG with transparency: 512×512 for the logo, 64×64 or larger for the favicon.

`404.html` is what makes `voqcl.com/bio/<username>` work: GitHub Pages serves it for any unknown path, and it renders the bio page. Keep it in sync with `index.html` if you edit the `<head>`.

## 2. Set up Supabase (accounts, bio pages, YouTube)
1. Create a free project at supabase.com.
2. In the **SQL Editor**, click **New query**, paste all of `supabase/schema.sql` and click **Run**. This creates:
   - the `profiles` table, with row-level security so anyone can read published pages but only the owner can edit theirs;
   - a unique, validated username for every account;
   - the `bio` image bucket (3 MB images, PNG/JPEG/WebP/GIF only, each user can upload only to their own folder).
3. Under **Authentication → URL Configuration**, set the Site URL to `https://voqcl.com` and add `https://voqcl.com/**` to Redirect URLs.
4. **Authentication → Email:** keep "Confirm email" on (recommended) or turn it off; the site handles both. Supabase's built-in email sender is heavily rate-limited (a few emails per hour), so for real use add your own SMTP provider (e.g. Resend or Brevo) under Authentication → SMTP Settings. Without it, sign-up confirmations and password resets may be delayed.
5. In **Project Settings → API**, copy the **Project URL** and the **anon / publishable** key into `config.js`:
   ```js
   supabaseUrl: 'https://abcdefghijklm.supabase.co',
   supabaseAnonKey: 'eyJ...or sb_publishable_...',
   ```
   This key is meant to be public; the row-level security in `schema.sql` is what protects data. **Do not** put the YouTube key in `config.js`.

## 3. YouTube Data API (kept secret in Supabase)
1. In Google Cloud Console, enable **YouTube Data API v3**, then create an **API key** under Credentials. Edit the key and set **API restrictions → Restrict key → YouTube Data API v3**. Leave application restrictions as **None**: the calls come from Supabase's servers, which have no fixed IP.
2. In Supabase, go to **Edge Functions → Deploy a new function → Via Editor**, name it **`voqcl-api`**, paste `supabase/functions/voqcl-api/index.ts`, deploy it, then **turn off "Verify JWT" / "Enforce JWT verification"** for this function. It is a public read-only proxy, and new publishable keys aren't JWTs.
   - CLI alternative: `supabase functions deploy voqcl-api --no-verify-jwt`.
3. Go to **Edge Functions → Secrets** and add:
   - `YOUTUBE_API_KEY` = your key;
   - `ALLOWED_ORIGINS` = `https://voqcl.com`;
   - optionally `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET`, for Twitch profile pictures in chat.

   The key exists only there. It is never in the repo, never in the browser and never in a URL. `supabase/secrets.example.env` lists these with placeholder values.
4. To check it worked, open **voqcl.com → Chat overlay**: the status box should say *YouTube chat: enabled*. In **Link in Bio → YouTube**, look up your channel.

**Quota:** the default allowance is 10,000 units per day.
- **Bio page:** about 3 units per view at most, and results are cached for 10 minutes, so this is cheap.
- **Live chat:** a YouTube chat overlay costs 5 units per poll, roughly 40,000–85,000 units per day of continuous streaming. Request a quota increase in Google Cloud (Quotas → YouTube Data API v3) before using YouTube chat on long streams.
- **When quota runs out,** the overlay and bio page say so instead of showing wrong data.

## Overlay URLs
Format: `https://voqcl.com/#/live/voqcl/overlay/<type>?user=<username>&<settings>`

| Overlay | Example |
|---|---|
| Follower tracker (default) | `https://voqcl.com/#/live/voqcl/overlay` |
| Chat | `https://voqcl.com/#/live/voqcl/overlay/chat?user=USERNAME` (add `&platform=youtube` for YouTube) |
| Follower tracker | `https://voqcl.com/#/live/voqcl/overlay/followtracker?user=USERNAME` |
| Emote | `…/overlay/emote?user=USERNAME&e=%F0%9F%94%A5&n=6&every=8` |
| Countdown | `…/overlay/countdown?user=USERNAME&minutes=10&label=Soon` |
| Goal bar | `…/overlay/goal?user=USERNAME&source=twitch&goal=500` |
| Ticker | `…/overlay/ticker?user=USERNAME&text=Hi%7CFollow%20me` |
| Scene | `…/overlay/scene?user=USERNAME&title=BRB&minutes=5` |

Each overlay tool builds this URL for you, with Copy and Open buttons and a live preview, and it remembers your settings. In OBS, add a **Browser** source, paste the URL, and set the size the tool suggests.

## Bio pages
- **Creating one:** sign up and pick a username. Your page address is `https://voqcl.com/bio/<username>`.
- **Editing:** go to **Link in Bio** to set your picture, banner, name, bio, unlimited links (drag or use the arrows to reorder), social links, your YouTube channel with its latest videos, six presets and full styling.
- **Publishing:** you get a live preview, then Save, Publish/Unpublish and Copy link.
- **Usernames:** must be unique and 3–24 characters (lowercase letters, numbers, `_`). Reserved names are blocked.
- **Who sees what:** your email and password settings are private (on the **Account** page); only the published page content is public.

**Known GitHub Pages limitation:** bio pages work in every browser, but GitHub sends them with an HTTP 404 status, and Discord/Twitter link previews won't show the creator's name or picture because those crawlers don't run JavaScript. Putting Cloudflare in front of the site (also free) can fix this later.

## Local development and tests
```bash
npm test                                         # unit tests: QR (decoded with OpenCV), overlay URLs, chat parser, bio renderer, Edge Function (mock YouTube)
node --experimental-strip-types tests/mock-stack.mjs   # site on :8124 behaving like GitHub Pages + mock Supabase on :8125
python3 tests/ui_test.py                         # 111 browser checks (pip install playwright opencv-python-headless; playwright install chromium)
```
A plain `python3 -m http.server` works for the tools, but not for `/bio/...` URLs, because it doesn't do GitHub's 404.html fallback.
There is no build step and there are no npm dependencies, so there is no lockfile.

## What was verified, and what still needs your real accounts
**Verified in automated tests:** everything in the test commands above, including the real Edge Function code.

**Mocked, because the build environment has no internet access:**
- Twitch chat, 7TV/BTTV emotes and DecAPI follower counts;
- the YouTube API;
- Supabase itself. The mock follows Supabase's documented Auth, REST and Storage behaviour and the rules in `schema.sql`; the SQL was not run on a real database.

**After setup, check once by hand:**
1. sign up, confirm the email, and reset your password;
2. publish a bio page and open `voqcl.com/bio/<you>` in a private window;
3. a Twitch chat overlay in OBS;
4. a YouTube chat overlay while you're live.

/* VOQCL TOOLS public configuration. Everything here is SAFE to publish on GitHub.
   Never put your YouTube API key here: it goes in Supabase -> Edge Functions -> Secrets (see README). */
window.VOQCL_CONFIG = {
  siteOrigin: 'https://voqcl.com',   // used for overlay URLs and bio links: voqcl.com/bio/<username>
  supabaseUrl: '',                   // e.g. 'https://abcdefghijklm.supabase.co'  (Supabase -> Project Settings -> API)
  supabaseAnonKey: '',               // the "anon" / "publishable" key from the same page (public by design; protected by row-level security)
};

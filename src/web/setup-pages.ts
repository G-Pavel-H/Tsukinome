/**
 * Self-contained HTML for the setup page (Phase 12b / 2.1). Styling mirrors tsukinome.io — same
 * palette, gradient and panel treatment — but every asset stays inlined on purpose: this page
 * takes a credential, and a page that takes a credential shouldn't pull in third parties. Fonts
 * name the site's families first and fall back to system stacks.
 *
 * All interpolated values are numbers we control or static strings — no untrusted input reaches
 * these templates.
 */

const STYLE = `
  :root {
    --bg: #06070f; --bg2: #0a0c1a; --panel: #0d1022;
    --cyan: #38f2ff; --cyan-soft: #8ff7ff;
    --ink: #e8edfb; --muted: #9fb0d6; --dim: #6b7ba6;
    --line: rgba(120,150,220,.14);
    --grad: linear-gradient(100deg,#38f2ff 0%,#8f6bff 52%,#ff3caa 100%);
    color-scheme: dark;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 3rem 1.25rem 4rem; background: var(--bg); color: var(--ink);
    font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    line-height: 1.6; font-size: 16px;
    background-image: radial-gradient(60rem 40rem at 50% -12rem, rgba(143,107,255,.16), transparent 70%);
    background-repeat: no-repeat;
  }
  .wrap { max-width: 40rem; margin: 0 auto; }
  .brand { display: flex; align-items: baseline; gap: .6rem; margin-bottom: 2.5rem; }
  .brand .mark { font-size: 1.35rem; letter-spacing: .06em; color: var(--cyan-soft); }
  .brand .name {
    font-family: "Space Grotesk", Inter, sans-serif; font-weight: 700; letter-spacing: -.01em;
    background: var(--grad); -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  h1 {
    font-family: "Space Grotesk", Inter, sans-serif; font-weight: 700; font-size: 2rem;
    line-height: 1.2; letter-spacing: -.02em; margin: 0 0 .75rem;
  }
  .lede { color: var(--muted); margin: 0 0 2rem; }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 18px; padding: 1.5rem; }
  .option { border: 1px solid var(--line); border-radius: 14px; padding: 1.1rem 1.25rem; margin-bottom: 1rem; }
  .option:has(input:checked) { border-color: rgba(56,242,255,.45); background: rgba(56,242,255,.04); }
  .option > label { display: flex; gap: .65rem; align-items: baseline; cursor: pointer; font-weight: 600; }
  .option input[type=radio] { accent-color: var(--cyan); margin: 0; }
  .tag { font-weight: 400; color: var(--dim); font-size: .9rem; }
  .body { padding-left: 1.6rem; margin-top: .75rem; }
  .body[hidden] { display: none; }
  ol { margin: .5rem 0 1rem; padding-left: 1.2rem; color: var(--muted); }
  ol li { margin-bottom: .45rem; }
  p.hint { color: var(--muted); font-size: .92rem; margin: .5rem 0; }
  label.field { display: block; font-weight: 600; margin: 1rem 0 .4rem; font-size: .95rem; }
  input[type=password] {
    width: 100%; padding: .7rem .85rem; font-size: 1rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    color: var(--ink); background: var(--bg2);
    border: 1px solid var(--line); border-radius: 10px;
  }
  input[type=password]:focus { outline: none; border-color: rgba(56,242,255,.55); }
  button {
    margin-top: 1.5rem; width: 100%; padding: .85rem 1.75rem; font-size: 1rem; font-weight: 600;
    font-family: inherit; border: 0; border-radius: 12px; cursor: pointer;
    background: var(--grad); color: var(--bg);
  }
  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .9em;
    background: rgba(120,150,220,.12); border: 1px solid var(--line);
    padding: .12rem .4rem; border-radius: 6px; color: var(--cyan-soft);
  }
  a { color: var(--cyan-soft); }
  .muted { color: var(--muted); font-size: .9rem; }
  .foot { color: var(--dim); font-size: .85rem; margin-top: 1.75rem; }
  .error {
    color: #ffb4d4; background: rgba(255,60,170,.09); border: 1px solid rgba(255,60,170,.35);
    border-radius: 10px; padding: .7rem .9rem; margin: 0 0 1.25rem; font-size: .95rem;
  }
  .ok { font-size: 2.5rem; line-height: 1; margin-bottom: .5rem; }
`;

function page(title: string, inner: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} · Tsukinome</title>
<style>${STYLE}</style>
</head>
<body>
<div class="wrap">
  <div class="brand"><span class="mark">月ノ目</span><span class="name">Tsukinome</span></div>
${inner}
</div>
</body>
</html>`;
}

/** Toggles the two credential panels. Without JS both stay visible and the radio still decides. */
const TOGGLE_SCRIPT = `
<script>
  document.querySelectorAll('input[name=auth_type]').forEach(function (radio) {
    radio.addEventListener('change', function () {
      document.getElementById('panel-subscription').hidden = this.value !== 'subscription';
      document.getElementById('panel-api-key').hidden = this.value !== 'api_key';
    });
  });
</script>`;

export function renderCredentialForm(installationId: number, error?: string): string {
  const errorLine = error ? `<p class="error">${error}</p>` : '';
  return page(
    'Connect',
    `<h1>Connect Tsukinome to Claude</h1>
<p class="lede">Tsukinome reads your issues and writes pull requests using <strong>your</strong> Claude
account, so model usage is billed to you. Whichever option you pick is encrypted at rest and never
shown again.</p>
<div class="card">
  <form method="POST" action="/setup/key">
    ${errorLine}
    <input type="hidden" name="installation_id" value="${installationId}" />

    <div class="option">
      <label for="opt-sub">
        <input type="radio" id="opt-sub" name="auth_type" value="subscription" checked />
        <span>Use my Claude subscription <span class="tag">— Pro or Max, no separate bill</span></span>
      </label>
      <div class="body" id="panel-subscription">
        <p class="hint">Runs draw on the plan you already pay for. To get your token:</p>
        <ol>
          <li>Install Claude Code, if you haven't:<br />
            <code>npm install -g @anthropic-ai/claude-code</code></li>
          <li>Sign in to the account holding your Pro or Max plan — run <code>claude</code>, then
            <code>/login</code> if it doesn't prompt you.</li>
          <li>Run <code>claude setup-token</code> in your terminal.</li>
          <li>It opens a browser to authorise, then prints a token beginning
            <code>sk-ant-oat</code>. Copy the whole line.</li>
          <li>Paste it below. It's long-lived, so this is a one-time step.</li>
        </ol>
        <label class="field" for="subscription_token">Claude subscription token</label>
        <input id="subscription_token" name="subscription_token" type="password" autocomplete="off"
               placeholder="sk-ant-oat01-..." spellcheck="false" />
      </div>
    </div>

    <div class="option">
      <label for="opt-key">
        <input type="radio" id="opt-key" name="auth_type" value="api_key" />
        <span>Use an Anthropic API key <span class="tag">— pay as you go</span></span>
      </label>
      <div class="body" id="panel-api-key" hidden>
        <p class="hint">Runs are billed per token to your Anthropic Console account. Create a key
          under API Keys at
          <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">console.anthropic.com</a>.</p>
        <label class="field" for="api_key">Anthropic API key</label>
        <input id="api_key" name="api_key" type="password" autocomplete="off"
               placeholder="sk-ant-api03-..." spellcheck="false" />
      </div>
    </div>

    <button type="submit">Validate &amp; connect</button>
  </form>
</div>
<p class="foot">Installation <code>${installationId}</code>. Bookmark this page — you can return any
time to switch method or rotate your credential, without reinstalling the app.</p>
${TOGGLE_SCRIPT}`,
  );
}

export function renderSuccessPage(
  installationId: number,
  authType: 'api_key' | 'subscription',
): string {
  const what = authType === 'subscription' ? 'your Claude subscription' : 'your Anthropic API key';
  return page(
    'Connected',
    `<div class="ok">✅</div>
<h1>You're connected</h1>
<p class="lede">Tsukinome will bill runs for installation <code>${installationId}</code> to ${what}.</p>
<div class="card">
  <p style="margin-top:0">Open an issue on a connected repo describing what you want. Tsukinome
  drafts a spec, asks anything it needs, proposes a plan for your approval, then implements it
  test-first and opens a pull request.</p>
  <p class="muted" style="margin-bottom:0">Bookmark this page. Coming back here lets you switch
  between a subscription and an API key, or rotate your credential — no reinstall needed.</p>
</div>`,
  );
}

export function renderErrorPage(title: string, message: string): string {
  return page(
    title,
    `<h1>${title}</h1>
<div class="card"><p style="margin:0">${message}</p></div>`,
  );
}

export function renderNotConfiguredPage(): string {
  return page(
    'Setup unavailable',
    `<h1>Setup isn't available</h1>
<div class="card">
  <p style="margin-top:0">This Tsukinome deployment hasn't enabled the connect page.</p>
  <p class="muted" style="margin-bottom:0">If you host this instance, set <code>GITHUB_CLIENT_ID</code>,
  <code>GITHUB_CLIENT_SECRET</code> and <code>SETUP_BASE_URL</code> to enable it.</p>
</div>`,
  );
}

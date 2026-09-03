/**
 * Minimal, self-contained HTML for the setup page (Phase 12b). No external assets (inline
 * styles only). All interpolated values are numbers we control or static strings — no
 * untrusted input reaches these templates.
 */

function page(title: string, inner: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} · Tsukinome</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         max-width: 34rem; margin: 4rem auto; padding: 0 1.25rem; line-height: 1.5; }
  h1 { font-size: 1.5rem; }
  .card { border: 1px solid rgba(128,128,128,0.3); border-radius: 12px; padding: 1.5rem; }
  label { display: block; font-weight: 600; margin-bottom: 0.5rem; }
  input[type=password] { width: 100%; padding: 0.6rem 0.7rem; font-size: 1rem; box-sizing: border-box;
         border: 1px solid rgba(128,128,128,0.5); border-radius: 8px; }
  button { margin-top: 1rem; padding: 0.6rem 1.1rem; font-size: 1rem; font-weight: 600;
           border: 0; border-radius: 8px; background: #4f46e5; color: white; cursor: pointer; }
  .muted { color: rgba(128,128,128,0.95); font-size: 0.9rem; }
  .error { color: #dc2626; font-weight: 600; }
  code { background: rgba(128,128,128,0.15); padding: 0.1rem 0.35rem; border-radius: 4px; }
  fieldset.choice { border: 0; padding: 0; margin: 0; }
  .option { font-weight: 400; margin: 1rem 0 0.25rem; display: flex; gap: 0.5rem; align-items: baseline; }
  .option input { margin: 0; }
  #sub, #key { padding-left: 1.5rem; }
</style>
</head>
<body>
${inner}
</body>
</html>`;
}

export function renderCredentialForm(installationId: number, error?: string): string {
  const errorLine = error ? `<p class="error">${error}</p>` : '';
  return page(
    'Connect Tsukinome',
    `<h1>Connect Tsukinome to Anthropic</h1>
<p class="muted">Tsukinome runs your issues through Claude using <strong>your</strong> account, so model
usage is billed to you. Whichever you choose is encrypted at rest and never shown again.</p>
<div class="card">
  <form method="POST" action="/setup/key">
    ${errorLine}
    <input type="hidden" name="installation_id" value="${installationId}" />

    <fieldset class="choice">
      <label class="option">
        <input type="radio" name="auth_type" value="subscription" checked
               onchange="document.getElementById('sub').hidden=false;document.getElementById('key').hidden=true" />
        <strong>My Claude subscription</strong> — Pro or Max
      </label>
      <div id="sub">
        <p class="muted">Runs draw on your Claude plan's usage, with no separate API bill. On a machine
        signed in to that plan, run <code>claude setup-token</code> and paste the token it prints.</p>
        <label for="subscription_token">Claude subscription token</label>
        <input id="subscription_token" name="subscription_token" type="password" autocomplete="off"
               placeholder="sk-ant-oat..." spellcheck="false" />
      </div>

      <label class="option">
        <input type="radio" name="auth_type" value="api_key"
               onchange="document.getElementById('sub').hidden=true;document.getElementById('key').hidden=false" />
        <strong>An Anthropic API key</strong> — pay as you go
      </label>
      <div id="key" hidden>
        <p class="muted">Runs are billed to your Anthropic Console account per token.</p>
        <label for="api_key">Anthropic API key</label>
        <input id="api_key" name="api_key" type="password" autocomplete="off"
               placeholder="sk-ant-..." spellcheck="false" />
      </div>
    </fieldset>

    <button type="submit">Validate &amp; save</button>
  </form>
</div>
<p class="muted">Installation <code>${installationId}</code>. Re-visit this page any time to switch or rotate.</p>`,
  );
}

export function renderSuccessPage(
  installationId: number,
  authType: 'api_key' | 'subscription',
): string {
  const what =
    authType === 'subscription'
      ? 'your Claude subscription'
      : 'your Anthropic API key';
  return page(
    'Connected',
    `<h1>✅ You're connected</h1>
<div class="card">
  <p>Tsukinome will bill runs for installation <code>${installationId}</code> to ${what}.</p>
  <p class="muted">Open an issue on a connected repo to start a run. Re-visit this page any time to
  switch method or rotate the credential.</p>
</div>`,
  );
}

export function renderErrorPage(title: string, message: string): string {
  return page(
    title,
    `<h1>${title}</h1>
<div class="card">
  <p>${message}</p>
</div>`,
  );
}

export function renderNotConfiguredPage(): string {
  return page(
    'Setup unavailable',
    `<h1>Setup isn't available</h1>
<div class="card">
  <p>This Tsukinome deployment hasn't enabled the bring-your-own-key setup page.</p>
  <p class="muted">If you host this instance, set <code>GITHUB_CLIENT_ID</code>,
  <code>GITHUB_CLIENT_SECRET</code>, and <code>SETUP_BASE_URL</code> to enable it.</p>
</div>`,
  );
}

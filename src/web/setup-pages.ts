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
</style>
</head>
<body>
${inner}
</body>
</html>`;
}

export function renderKeyForm(installationId: number, error?: string): string {
  const errorLine = error ? `<p class="error">${error}</p>` : '';
  return page(
    'Set your Anthropic key',
    `<h1>Connect your Anthropic key</h1>
<p class="muted">Tsukinome runs your issues through the Anthropic API using <strong>your</strong> key, so
model usage is billed to you. Your key is encrypted at rest and never shown again.</p>
<div class="card">
  <form method="POST" action="/setup/key">
    ${errorLine}
    <input type="hidden" name="installation_id" value="${installationId}" />
    <label for="api_key">Anthropic API key</label>
    <input id="api_key" name="api_key" type="password" autocomplete="off"
           placeholder="sk-ant-..." spellcheck="false" required />
    <button type="submit">Validate &amp; save</button>
  </form>
</div>
<p class="muted">Installation <code>${installationId}</code>. Re-visit this page any time to rotate the key.</p>`,
  );
}

export function renderSuccessPage(installationId: number): string {
  return page(
    'Key saved',
    `<h1>✅ Your key is saved</h1>
<div class="card">
  <p>Tsukinome will now use your Anthropic key for installation <code>${installationId}</code>.</p>
  <p class="muted">Open an issue on a connected repo to start a run. Re-visit this page any time to rotate the key.</p>
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

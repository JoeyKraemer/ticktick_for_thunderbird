/**
 * Thin wrapper around TickTick's Open API (https://developer.ticktick.com/docs#/openapi).
 *
 * This module owns:
 *  - the OAuth2 authorization-code flow (via identity.launchWebAuthFlow)
 *  - token storage (browser.storage.local)
 *  - authenticated REST calls to api.ticktick.com
 *
 * It is imported by background.js only. popup/options pages never touch
 * tokens directly - they ask the background page to do it via
 * runtime.sendMessage, so there is a single source of truth for auth state
 * (important since Manifest V3 background pages can be killed/restarted at
 * any time - nothing here relies on in-memory state surviving a restart,
 * except the short-lived OAuth "state" nonce which is fine to lose).
 */

const AUTHORIZE_URL = "https://ticktick.com/oauth/authorize";
const TOKEN_URL = "https://ticktick.com/oauth/token";
const API_BASE = "https://api.ticktick.com/open/v1";
const SCOPE = "tasks:write tasks:read";

const STORAGE_KEYS = {
  clientId: "settings.clientId",
  clientSecret: "settings.clientSecret",
  defaultProjectId: "settings.defaultProjectId",
  accountProjectMap: "settings.accountProjectMap",
  accessToken: "auth.accessToken",
  tokenType: "auth.tokenType",
  scope: "auth.scope",
};

function randomState() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function getStorage(keys) {
  return browser.storage.local.get(keys);
}

async function setStorage(obj) {
  return browser.storage.local.set(obj);
}

/** Public: read the non-secret + secret settings needed by the options UI. */
export async function getSettings() {
  const data = await getStorage([
    STORAGE_KEYS.clientId,
    STORAGE_KEYS.clientSecret,
    STORAGE_KEYS.defaultProjectId,
    STORAGE_KEYS.accountProjectMap,
  ]);
  return {
    clientId: data[STORAGE_KEYS.clientId] || "",
    clientSecret: data[STORAGE_KEYS.clientSecret] || "",
    defaultProjectId: data[STORAGE_KEYS.defaultProjectId] || "",
    accountProjectMap: data[STORAGE_KEYS.accountProjectMap] || {},
  };
}

export async function saveSettings({
  clientId,
  clientSecret,
  defaultProjectId,
  accountProjectMap,
}) {
  const update = {};
  if (clientId !== undefined) update[STORAGE_KEYS.clientId] = clientId.trim();
  if (clientSecret !== undefined) update[STORAGE_KEYS.clientSecret] = clientSecret.trim();
  if (defaultProjectId !== undefined) update[STORAGE_KEYS.defaultProjectId] = defaultProjectId;
  if (accountProjectMap !== undefined) update[STORAGE_KEYS.accountProjectMap] = accountProjectMap;
  await setStorage(update);
}

/**
 * Sets (or clears, when projectId is falsy) the default TickTick list for a
 * single mail account, without disturbing the mappings of other accounts.
 */
export async function setAccountProject(accountId, projectId) {
  const data = await getStorage([STORAGE_KEYS.accountProjectMap]);
  const map = { ...(data[STORAGE_KEYS.accountProjectMap] || {}) };
  if (projectId) {
    map[accountId] = projectId;
  } else {
    delete map[accountId];
  }
  await setStorage({ [STORAGE_KEYS.accountProjectMap]: map });
  return map;
}

/**
 * Resolves which TickTick project a new task should land in for a given
 * mail account: the account-specific mapping wins, falling back to the
 * global default list, falling back to "" (TickTick's own default/Inbox).
 */
export async function getProjectForAccount(accountId) {
  const settings = await getSettings();
  if (accountId && settings.accountProjectMap[accountId]) {
    return settings.accountProjectMap[accountId];
  }
  return settings.defaultProjectId || "";
}

export async function isAuthenticated() {
  const data = await getStorage([STORAGE_KEYS.accessToken]);
  return Boolean(data[STORAGE_KEYS.accessToken]);
}

export async function disconnect() {
  await browser.storage.local.remove([
    STORAGE_KEYS.accessToken,
    STORAGE_KEYS.tokenType,
    STORAGE_KEYS.scope,
  ]);
}

/**
 * Runs the OAuth2 "authorization code" dance:
 *   1. open ticktick.com/oauth/authorize in a popup window (launchWebAuthFlow)
 *   2. TickTick redirects to our extension's redirect URL with ?code=...
 *   3. exchange the code for an access_token via a POST to /oauth/token
 *      (client_id/secret sent as HTTP Basic auth, per TickTick's docs)
 *
 * Throws with a human-readable message on failure - callers should surface
 * err.message directly in the UI.
 */
export async function connect() {
  const { clientId, clientSecret } = await getSettings();
  if (!clientId || !clientSecret) {
    throw new Error(
      "Add your TickTick Client ID and Client Secret in the add-on options first."
    );
  }

  const redirectUri = await browser.identity.getRedirectURL();
  const state = randomState();

  const authUrl = new URL(AUTHORIZE_URL);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("scope", SCOPE);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");

  let redirectResult;
  try {
    redirectResult = await browser.identity.launchWebAuthFlow({
      url: authUrl.href,
      interactive: true,
    });
  } catch (err) {
    throw new Error(
      "TickTick sign-in was cancelled or failed to open. " + (err?.message || "")
    );
  }

  const redirected = new URL(redirectResult);
  const code = redirected.searchParams.get("code");
  const returnedState = redirected.searchParams.get("state");

  if (!code) {
    throw new Error("TickTick did not return an authorization code.");
  }
  if (returnedState !== state) {
    throw new Error("OAuth state mismatch - aborting for safety, please try again.");
  }

  const basicAuth = btoa(`${clientId}:${clientSecret}`);
  const body = new URLSearchParams({
    code,
    grant_type: "authorization_code",
    scope: SCOPE,
    redirect_uri: redirectUri,
  });

  const tokenResponse = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!tokenResponse.ok) {
    const text = await tokenResponse.text().catch(() => "");
    throw new Error(
      `TickTick rejected the token exchange (HTTP ${tokenResponse.status}). ${text}`
    );
  }

  const tokenData = await tokenResponse.json();
  if (!tokenData.access_token) {
    throw new Error("TickTick response did not include an access_token.");
  }

  await setStorage({
    [STORAGE_KEYS.accessToken]: tokenData.access_token,
    [STORAGE_KEYS.tokenType]: tokenData.token_type || "Bearer",
    [STORAGE_KEYS.scope]: tokenData.scope || SCOPE,
  });

  return true;
}

/**
 * Authenticated fetch against the TickTick Open API.
 * On a 401 (expired/invalid token) it clears the stored token and throws a
 * specific error so the UI can prompt the user to reconnect - TickTick's
 * Open API does not expose a refresh_token grant, so re-running the full
 * authorize flow is the only recovery path.
 */
async function apiFetch(path, options = {}) {
  const data = await getStorage([STORAGE_KEYS.accessToken, STORAGE_KEYS.tokenType]);
  const token = data[STORAGE_KEYS.accessToken];
  if (!token) {
    const err = new Error("Not connected to TickTick yet.");
    err.code = "NOT_AUTHENTICATED";
    throw err;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `${data[STORAGE_KEYS.tokenType] || "Bearer"} ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (response.status === 401) {
    await disconnect();
    const err = new Error("Your TickTick session expired. Please reconnect.");
    err.code = "NOT_AUTHENTICATED";
    throw err;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const err = new Error(`TickTick API error ${response.status}: ${text || response.statusText}`);
    err.code = "API_ERROR";
    err.status = response.status;
    throw err;
  }

  if (response.status === 204 || response.status === 201) {
    return null;
  }

  const contentLength = response.headers.get("content-length");
  if (contentLength === "0") return null;

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

/** GET /open/v1/project - all lists/projects visible to the user. */
export async function getProjects() {
  const projects = await apiFetch("/project");
  return Array.isArray(projects) ? projects : [];
}

/**
 * POST /open/v1/task
 * @param {object} task - { title, projectId, content, dueDate, priority, ... }
 */
export async function createTask(task) {
  return apiFetch("/task", {
    method: "POST",
    body: JSON.stringify(task),
  });
}

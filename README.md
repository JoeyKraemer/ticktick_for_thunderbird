# TickTick for Thunderbird

A Thunderbird MailExtension that adds an **"Add to TickTick"** button to the
message-reading toolbar. Click it while an email is open, and a small popup
lets you turn that email into a TickTick task (title pre-filled from the
subject, notes pre-filled with sender/date/snippet plus a link back to the
email itself, list/due date/priority pickers) — similar in spirit to the
TickTick Gmail add-on. The destination list can also default per email
account, so work email goes to your Work list and personal email goes
elsewhere automatically.

Built against Thunderbird's Manifest V3 support (Thunderbird 128+).

## How it works (architecture)

```
manifest.json
├─ background.js         message router (popup/options -> ticktick-api.js)
├─ ticktick-api.js        OAuth2 flow + token storage + REST calls to TickTick
├─ popup/                 message_display_action popup (the task-creation form)
│  ├─ popup.html/.css/.js reads the open email via messenger.messageDisplay,
│                         messenger.messages.listInlineTextParts()
└─ options/               settings page: Client ID/Secret, Connect, default list
   └─ options.html/.css/.js
```

- **UI hook**: `message_display_action` puts a toolbar button on the message
  view (same slot the Gmail add-on's side-panel button occupies).
- **Reading the email**: `messenger.messageDisplay.getDisplayedMessages()` +
  `messenger.messages.listInlineTextParts()` (needs the `messagesRead`
  permission).
- **Auth**: `browser.identity.launchWebAuthFlow()` drives TickTick's OAuth2
  "authorization code" flow. `browser.identity.getRedirectURL()` generates a
  stable per-extension redirect URL that you register once in TickTick's
  developer console.
- **API calls**: plain `fetch()` against `api.ticktick.com/open/v1/...`, with
  the bearer token stored in `browser.storage.local`.

## Building

The `dist/` folder (containing the packaged `.xpi`) is gitignored - it's a
build artifact, not source, so it's never committed. Rebuild it anytime with:

```sh
npm install   # first time only, installs web-ext locally
npm run build # -> dist/ticktick_for_thunderbird-1.0.0.zip (rename/copy to .xpi)
npm run lint  # runs web-ext lint (a few Thunderbird-only-API warnings are expected/harmless)
```

`npm run build` explicitly excludes `package.json`/`package-lock.json`/
`node_modules` from the packaged extension - only the actual source files
listed in the architecture diagram above get shipped.
- **Per-account default list**: `messenger.accounts.list()` (needs
  `accountsRead`) populates a settings table mapping each mail account to a
  TickTick list; `message.folder.accountId` on the open message resolves
  which mapping applies, falling back to one global default list.
- **Link back to the email**: every created task's notes start with a
  Markdown link (`[text](mid:...)`) built from the message's `Message-ID`
  header — Markdown is used because TickTick's editor renders it as a real
  clickable link, whereas its plain-text autolinker doesn't recognize bare
  `mid:` URLs (no `//`). Thunderbird has natively opened `mid:` links since
  v91, no custom protocol handler needed. See "Opening the link back in
  Thunderbird" below for one-time OS setup.

## Setup

### 1. Register a TickTick app

1. Go to <https://developer.ticktick.com/manage> and sign in with your
   TickTick account.
2. Click **+App Name** to create a new app (any name is fine).
3. Note the generated **Client ID** and **Client Secret**.
4. Load the extension once (see below) so you can open its Options page and
   copy the **redirect URL** it shows you — paste that exact value into the
   app's **OAuth Redirect URL** field, then save.

### 2. Load the extension in Thunderbird

Temporary install, for development/testing:

1. Thunderbird → hamburger menu → *Developer Tools* → *Debug Add-ons* (or
   navigate to `about:debugging` and select "This Thunderbird").
2. Click **Load Temporary Add-on...** and pick `manifest.json` from this
   folder.

This install is temporary and will be removed when Thunderbird restarts —
fine for testing. See "Permanent install" below for daily use.

### 3. Configure & connect

1. Open the add-on's **Options** page (Add-ons Manager → TickTick for
   Thunderbird → Preferences, or the link Thunderbird shows right after
   loading it).
2. Copy the redirect URL shown at the top into TickTick's app settings (step
   1 above) if you haven't already.
3. Paste your Client ID / Client Secret and click **Save**.
4. Click **Connect to TickTick** — a window opens for you to log in to
   TickTick and approve access. On success you'll see "Connected".
5. Optionally pick a global default list, and/or set a default list for
   each mail account individually in the table below it (saves
   automatically as you change each dropdown). An account without an
   override falls back to the global default list.

### 4. Use it

Open any email, click the **Add to TickTick** button in the message
toolbar, adjust the title/list/due date/priority/notes, and click **Add
Task**. The task's notes will start with a link back to the original email
(see below to make that link clickable).

## Opening the link back in Thunderbird

Every created task's notes start with a Markdown link followed by the raw
URL, e.g.:

```
[📧 Open original email in Thunderbird](mid:1234abcd@mail.example.com)
mid:1234abcd@mail.example.com
```

Markdown is used (rather than relying on TickTick auto-detecting a bare
`mid:...` string as a link) because most link auto-detectors only recognize
schemes followed by `//` (`http://`, `https://`) and never linkify a bare
`mid:` URL — TickTick's task description editor does render Markdown, so an
explicit `[text](url)` link renders as a real clickable link regardless of
the scheme. The raw URL is repeated as plain text right below it so you can
always copy-paste it (e.g. into a terminal as `thunderbird mid:...`) even if
your TickTick client doesn't render Markdown links as clickable in every
view (e.g. some clients only render Markdown once a task is opened, not in
list/kanban previews).

Thunderbird has been able to open `mid:<Message-ID>` links directly since
v91 (e.g. running `thunderbird mid:1234abcd@mail.example.com` from a
terminal opens that exact email). Whether *clicking* the link from inside
TickTick launches Thunderbird automatically depends on your OS knowing that
Thunderbird handles `mid:` links:

- **Linux**: not registered by default in most distros. One-time fix —
  register the association (adjust for your `.desktop` file if it's not the
  default one):

  ```sh
  # Find your Thunderbird .desktop file, commonly one of:
  #   thunderbird.desktop | net.thunderbird.Thunderbird.desktop | org.mozilla.thunderbird.desktop
  xdg-mime default net.thunderbird.Thunderbird.desktop x-scheme-handler/mid
  ```

  If clicking still doesn't work, some distro `.desktop` files don't list
  `x-scheme-handler/mid` in their `MimeType` field at all — you may need to
  add it yourself (`MimeType=...;x-scheme-handler/mid;`) to the `.desktop`
  file (system one is usually read-only; copy it to
  `~/.local/share/applications/` first, edit the copy, then run
  `update-desktop-database ~/.local/share/applications` and repeat the
  `xdg-mime default` command above).
- **Windows / macOS**: test it first (click the link, or paste it into Run/
  Terminal as `start mid:...` / `open mid:...`). If nothing happens, set
  Thunderbird as the default app for `mid` links in your OS's default-apps
  settings, or fall back to copying the `Message-ID` and searching for it
  in Thunderbird manually.

If OS-level association isn't possible/desired, the Message-ID text itself
is still useful — you can paste it into Thunderbird's search (Ctrl/Cmd+K,
or the global "quick filter") to find the email by hand.

## Permanent install (signed XPI)

Temporary add-ons disappear on restart. For a permanent local install you
need a signed `.xpi`, because Thunderbird (release channel) only runs
signed extensions by default. Options:

- **Self-distribute via AMO**: submit the extension as "unlisted" on
  <https://addons.thunderbird.net/developers/> (Thunderbird shares Mozilla's
  add-on signing service). Mozilla signs it automatically after an automated
  review; you then download and install the signed `.xpi` yourself. This is
  free and doesn't require public listing.
- **Thunderbird ESR / Developer edition**: these channels can toggle
  `xpinstall.signatures.required` to `false` in `about:config`, letting you
  install unsigned XPIs directly (not recommended for daily-driver profiles).

Run `npm run build` (see "Building" above) to produce the `.xpi`/`.zip` for
submission/signing.

## Known limitations / things to watch out for

- **No refresh token**: TickTick's Open API only documents the
  `authorization_code` grant — there's no `refresh_token` flow. When the
  access token eventually expires (reported to last several months), the
  extension detects the `401` and asks you to hit **Connect** again in
  Options. This is expected TickTick behavior, not a bug.
- **`projectId` and the Inbox**: TickTick's `GET /open/v1/project` endpoint
  returns your custom lists, but it's not clearly documented whether it
  includes a usable id for the default Inbox. If you leave "List" as the
  default in the popup and task creation fails, create (or pick) a real list
  instead — this is a TickTick API quirk, not something this extension can
  fully paper over.
- **OAuth redirect URL is tied to the extension ID**: `getRedirectURL()`
  derives its value from `browser_specific_settings.gecko.id` in
  `manifest.json`. Don't change that id after registering the redirect URL
  with TickTick, or you'll need to update it there too.
- **Manifest V3 background page**: it's an event page that can be killed and
  restarted by Thunderbird at any time. All state that must survive a
  restart (tokens, settings) lives in `browser.storage.local`, never in
  memory — keep this in mind if you extend `background.js`.
- **Client secret isn't truly secret**: like any local/unlisted browser
  extension, the Client Secret you paste in Options is stored unencrypted in
  the profile's extension storage. Fine for personal use; don't reuse a
  Client ID/Secret pair you care about protecting across many machines.
- **`mid:` links aren't automatically clickable everywhere**: Thunderbird
  itself supports opening them since v91, but whether the *OS* routes a
  click from another app (TickTick) to Thunderbird depends on desktop/OS
  file-association setup this extension can't configure for you — see
  "Opening the link back in Thunderbird" above. This is inherent to how
  desktop mail clients work (no equivalent of a webmail permalink exists),
  not a bug in the extension.
- **Per-account list mapping needs `accountsRead`**: if you deny/revoke that
  permission, the popup silently falls back to the single global default
  list instead of an account-specific one (it doesn't error out).

## Difficulty assessment

This was scoped as a **3/10** (buildable in a weekend-to-two-weeks by
someone comfortable with REST/OAuth, no research problems, no missing
platform APIs) — the code above is a complete implementation of that scope:
message-toolbar button, popup form pre-filled from the open email, OAuth2
connect flow, and task creation against TickTick's Open API.

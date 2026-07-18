const els = {
  authNotice: document.getElementById("authNotice"),
  openOptionsBtn: document.getElementById("openOptionsBtn"),
  form: document.getElementById("taskForm"),
  title: document.getElementById("title"),
  project: document.getElementById("project"),
  dueDate: document.getElementById("dueDate"),
  priority: document.getElementById("priority"),
  content: document.getElementById("content"),
  statusMsg: document.getElementById("statusMsg"),
  saveBtn: document.getElementById("saveBtn"),
  cancelBtn: document.getElementById("cancelBtn"),
};

function setStatus(text, kind) {
  els.statusMsg.textContent = text || "";
  els.statusMsg.className = "status" + (kind ? ` ${kind}` : "");
}

function errorMessage(err) {
  return (err && err.message) || String(err);
}

/** Turns a Date into TickTick's expected "yyyy-MM-dd'T'HH:mm:ssZ" format. */
function toTickTickDate(date) {
  const pad = (n) => String(n).padStart(2, "0");
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const offset = `${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`;
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${offset}`
  );
}

/** Very small HTML -> plain text helper, using the popup's own DOM parser. */
function htmlToText(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style").forEach((el) => el.remove());
  return doc.body ? doc.body.textContent : "";
}

/** Best-effort plain-text snippet of the message body, capped in length. */
async function getMessageSnippet(messageId) {
  try {
    const parts = await messenger.messages.listInlineTextParts(messageId);
    const plain = parts.find((p) => p.contentType === "text/plain");
    let text = plain?.content;
    if (!text) {
      const html = parts.find((p) => p.contentType === "text/html");
      if (html?.content) {
        text = htmlToText(html.content);
      }
    }
    if (!text) return "";
    text = text.trim().replace(/\n{3,}/g, "\n\n");
    return text.length > 600 ? text.slice(0, 600) + "\u2026" : text;
  } catch (err) {
    console.warn("Could not read message body:", err);
    return "";
  }
}

function formatAuthor(message) {
  return message.author || "";
}

/**
 * Builds a Markdown link to a "mid:" URL (RFC 2392) for the message.
 * Thunderbird has natively opened mid: links (e.g. `thunderbird mid:<id>`
 * on the command line) since v91 - no custom protocol handler is needed on
 * our end. TickTick renders Markdown in task descriptions, so an explicit
 * `[text](mid:...)` link is used instead of relying on TickTick's plain-text
 * autolinker - most autolinkers only recognize schemes followed by "//"
 * (http://, https://) and never render bare "mid:xxx@yyy" as clickable at
 * all, which is why it showed up as inert text before.
 *
 * Whether *clicking* the rendered link launches Thunderbird still depends
 * on the OS having mid: registered as a Thunderbird URL handler - see the
 * README for the one-time setup (mainly needed on Linux). The raw mid: URL
 * is also included as plain text underneath so it can be copy-pasted (e.g.
 * into a terminal as `thunderbird mid:...`) if the link isn't clickable.
 */
function buildMidLink(headerMessageId) {
  if (!headerMessageId) return "";
  const clean = headerMessageId.replace(/^<|>$/g, "").trim();
  if (!clean) return "";
  const uri = `mid:${clean}`;
  return `[\ud83d\udce7 Open original email in Thunderbird](${uri})\n${uri}`;
}

async function loadCurrentMessage() {
  const { messages } = await messenger.messageDisplay.getDisplayedMessages();
  return messages[0] || null;
}

async function loadProjects(preferredProjectId) {
  els.project.innerHTML = "";
  let projects = [];
  try {
    projects = await messenger.runtime.sendMessage({ type: "GET_PROJECTS" });
  } catch (err) {
    throw err;
  }

  const inboxOption = document.createElement("option");
  inboxOption.value = "";
  inboxOption.textContent = "Inbox (default)";
  els.project.appendChild(inboxOption);

  for (const project of projects) {
    const opt = document.createElement("option");
    opt.value = project.id;
    opt.textContent = project.name;
    els.project.appendChild(opt);
  }

  if (preferredProjectId) {
    els.project.value = preferredProjectId;
  }
}

async function init() {
  setStatus("Loading\u2026");
  els.saveBtn.disabled = true;

  try {
    let message;
    try {
      message = await loadCurrentMessage();
    } catch (err) {
      setStatus("Could not read the open message: " + errorMessage(err), "error");
      return;
    }

    if (!message) {
      setStatus("Open an email first, then click this button again.", "error");
      return;
    }

    els.title.value = message.subject || "(no subject)";

    const snippet = await getMessageSnippet(message.id);
    const dateStr = message.date ? new Date(message.date).toLocaleString() : "";
    const midLink = buildMidLink(message.headerMessageId);

    const lines = [];
    if (midLink) lines.push(midLink, "");
    lines.push(`From: ${formatAuthor(message)}`);
    if (dateStr) lines.push(`Date: ${dateStr}`);
    if (snippet) lines.push("", snippet);
    els.content.value = lines.join("\n");

    const authed = await messenger.runtime.sendMessage({ type: "IS_AUTHENTICATED" });
    if (!authed) {
      els.authNotice.hidden = false;
      els.saveBtn.disabled = true;
      setStatus("");
      return;
    }

    try {
      // message.folder (and thus accountId) is only populated when the
      // accountsRead permission is granted; falls back to the global
      // default list when unavailable (e.g. external/attached messages).
      const accountId = message.folder?.accountId;
      const preferredProjectId = await messenger.runtime.sendMessage({
        type: "GET_PROJECT_FOR_ACCOUNT",
        accountId,
      });
      await loadProjects(preferredProjectId);
    } catch (err) {
      setStatus("Could not load your TickTick lists: " + errorMessage(err), "error");
    }

    els.saveBtn.disabled = false;
    setStatus("");
  } catch (err) {
    console.error("TickTick popup init failed:", err);
    setStatus("Unexpected error: " + errorMessage(err), "error");
  }
}

els.openOptionsBtn.addEventListener("click", () => {
  messenger.runtime.openOptionsPage();
  window.close();
});

els.cancelBtn.addEventListener("click", () => window.close());

els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.saveBtn.disabled = true;
  setStatus("Saving\u2026");

  const task = {
    title: els.title.value.trim() || "(no subject)",
    content: els.content.value,
    priority: Number(els.priority.value),
  };

  if (els.project.value) {
    task.projectId = els.project.value;
  }

  if (els.dueDate.value) {
    const date = new Date(els.dueDate.value);
    if (!Number.isNaN(date.getTime())) {
      task.dueDate = toTickTickDate(date);
      task.timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      task.isAllDay = false;
    }
  }

  try {
    await messenger.runtime.sendMessage({ type: "CREATE_TASK", task });
    setStatus("Added to TickTick \u2713", "success");
    setTimeout(() => window.close(), 900);
  } catch (err) {
    setStatus(errorMessage(err), "error");
    els.saveBtn.disabled = false;
  }
});

init().catch((err) => console.error("TickTick popup: unhandled init error", err));

const els = {
  redirectUrl: document.getElementById("redirectUrl"),
  copyRedirectBtn: document.getElementById("copyRedirectBtn"),
  form: document.getElementById("settingsForm"),
  clientId: document.getElementById("clientId"),
  clientSecret: document.getElementById("clientSecret"),
  saveBtn: document.getElementById("saveBtn"),
  saveStatus: document.getElementById("saveStatus"),
  authStatus: document.getElementById("authStatus"),
  connectBtn: document.getElementById("connectBtn"),
  disconnectBtn: document.getElementById("disconnectBtn"),
  defaultProjectSection: document.getElementById("defaultProjectSection"),
  defaultProject: document.getElementById("defaultProject"),
  saveDefaultProjectBtn: document.getElementById("saveDefaultProjectBtn"),
  projectStatus: document.getElementById("projectStatus"),
  accountProjectSection: document.getElementById("accountProjectSection"),
  accountProjectRows: document.getElementById("accountProjectRows"),
  accountProjectStatus: document.getElementById("accountProjectStatus"),
};

function errorMessage(err) {
  return (err && err.message) || String(err);
}

function setText(el, text, kind) {
  el.textContent = text || "";
  el.className = "status" + (kind ? ` ${kind}` : "");
}

async function refreshAuthUi() {
  const authed = await browser.runtime.sendMessage({ type: "IS_AUTHENTICATED" });
  if (authed) {
    els.authStatus.textContent = "\u2705 Connected to TickTick.";
    els.connectBtn.textContent = "Reconnect";
    els.disconnectBtn.hidden = false;
    els.defaultProjectSection.hidden = false;
    await populateProjects();
  } else {
    els.authStatus.textContent = "Not connected yet.";
    els.connectBtn.textContent = "Connect to TickTick";
    els.disconnectBtn.hidden = true;
    els.defaultProjectSection.hidden = true;
    els.accountProjectSection.hidden = true;
  }
}

function projectOptionsFragment(projects, fallbackLabel) {
  const fragment = document.createDocumentFragment();
  const fallbackOpt = document.createElement("option");
  fallbackOpt.value = "";
  fallbackOpt.textContent = fallbackLabel;
  fragment.appendChild(fallbackOpt);
  for (const project of projects) {
    const opt = document.createElement("option");
    opt.value = project.id;
    opt.textContent = project.name;
    fragment.appendChild(opt);
  }
  return fragment;
}

async function populateProjects() {
  try {
    const [projects, settings] = await Promise.all([
      browser.runtime.sendMessage({ type: "GET_PROJECTS" }),
      browser.runtime.sendMessage({ type: "GET_SETTINGS" }),
    ]);

    els.defaultProject.innerHTML = "";
    els.defaultProject.appendChild(projectOptionsFragment(projects, "Inbox (default)"));
    if (settings?.defaultProjectId) {
      els.defaultProject.value = settings.defaultProjectId;
    }

    await populateAccountProjectRows(projects, settings?.accountProjectMap || {});
  } catch (err) {
    setText(els.projectStatus, "Could not load lists: " + errorMessage(err), "error");
  }
}

async function populateAccountProjectRows(projects, accountProjectMap) {
  let accounts = [];
  try {
    accounts = await browser.accounts.list();
  } catch (err) {
    setText(
      els.accountProjectStatus,
      "Could not list mail accounts: " + errorMessage(err),
      "error"
    );
    return;
  }

  els.accountProjectRows.innerHTML = "";
  if (accounts.length === 0) {
    els.accountProjectSection.hidden = true;
    return;
  }
  els.accountProjectSection.hidden = false;

  for (const account of accounts) {
    const row = document.createElement("tr");

    const nameCell = document.createElement("td");
    nameCell.className = "accountName";
    nameCell.textContent = account.name;
    row.appendChild(nameCell);

    const selectCell = document.createElement("td");
    const select = document.createElement("select");
    select.appendChild(projectOptionsFragment(projects, "Use fallback"));
    if (accountProjectMap[account.id]) {
      select.value = accountProjectMap[account.id];
    }

    const rowStatus = document.createElement("span");
    rowStatus.className = "rowStatus";

    select.addEventListener("change", async () => {
      rowStatus.textContent = "Saving\u2026";
      try {
        await browser.runtime.sendMessage({
          type: "SET_ACCOUNT_PROJECT",
          accountId: account.id,
          projectId: select.value,
        });
        rowStatus.textContent = "Saved \u2713";
        setTimeout(() => (rowStatus.textContent = ""), 1500);
      } catch (err) {
        rowStatus.textContent = errorMessage(err);
      }
    });

    selectCell.appendChild(select);
    selectCell.appendChild(rowStatus);
    row.appendChild(selectCell);
    els.accountProjectRows.appendChild(row);
  }
}

async function init() {
  try {
    els.redirectUrl.textContent = await browser.identity.getRedirectURL();

    const settings = await browser.runtime.sendMessage({ type: "GET_SETTINGS" });
    els.clientId.value = settings?.clientId || "";
    els.clientSecret.value = settings?.clientSecret || "";

    await refreshAuthUi();
  } catch (err) {
    console.error("TickTick options init failed:", err);
    els.authStatus.textContent =
      "Something went wrong loading settings: " + errorMessage(err);
  }
}

els.copyRedirectBtn.addEventListener("click", async () => {
  await navigator.clipboard.writeText(els.redirectUrl.textContent);
  els.copyRedirectBtn.textContent = "Copied!";
  setTimeout(() => (els.copyRedirectBtn.textContent = "Copy"), 1500);
});

els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setText(els.saveStatus, "Saving\u2026");
  try {
    await browser.runtime.sendMessage({
      type: "SAVE_SETTINGS",
      settings: {
        clientId: els.clientId.value,
        clientSecret: els.clientSecret.value,
      },
    });
    setText(els.saveStatus, "Saved \u2713", "success");
  } catch (err) {
    setText(els.saveStatus, errorMessage(err), "error");
  }
});

els.connectBtn.addEventListener("click", async () => {
  els.connectBtn.disabled = true;
  els.authStatus.textContent = "Opening TickTick sign-in\u2026";
  try {
    await browser.runtime.sendMessage({
      type: "SAVE_SETTINGS",
      settings: {
        clientId: els.clientId.value,
        clientSecret: els.clientSecret.value,
      },
    });
    await browser.runtime.sendMessage({ type: "CONNECT" });
    await refreshAuthUi();
  } catch (err) {
    els.authStatus.textContent = errorMessage(err);
  } finally {
    els.connectBtn.disabled = false;
  }
});

els.disconnectBtn.addEventListener("click", async () => {
  await browser.runtime.sendMessage({ type: "DISCONNECT" });
  await refreshAuthUi();
});

els.saveDefaultProjectBtn.addEventListener("click", async () => {
  setText(els.projectStatus, "Saving\u2026");
  try {
    await browser.runtime.sendMessage({
      type: "SAVE_SETTINGS",
      settings: { defaultProjectId: els.defaultProject.value },
    });
    setText(els.projectStatus, "Saved \u2713", "success");
  } catch (err) {
    setText(els.projectStatus, errorMessage(err), "error");
  }
});

init().catch((err) => console.error("TickTick options: unhandled init error", err));

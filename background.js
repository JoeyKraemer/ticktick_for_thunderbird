import {
  getSettings,
  saveSettings,
  isAuthenticated,
  connect,
  disconnect,
  getProjects,
  createTask,
  setAccountProject,
  getProjectForAccount,
} from "./ticktick-api.js";

/**
 * Single message-passing entry point used by popup/popup.js and
 * options/options.js. Keeping all TickTick/auth logic in the background
 * page means there is exactly one place that touches storage/tokens,
 * which avoids races if the popup and options page are open at once.
 */
browser.runtime.onMessage.addListener((message) => {
  switch (message?.type) {
    case "GET_SETTINGS":
      return getSettings();

    case "SAVE_SETTINGS":
      return saveSettings(message.settings);

    case "IS_AUTHENTICATED":
      return isAuthenticated();

    case "CONNECT":
      return connect();

    case "DISCONNECT":
      return disconnect();

    case "GET_PROJECTS":
      return getProjects();

    case "SET_ACCOUNT_PROJECT":
      return setAccountProject(message.accountId, message.projectId);

    case "GET_PROJECT_FOR_ACCOUNT":
      return getProjectForAccount(message.accountId);

    case "CREATE_TASK":
      return createTask(message.task);

    default:
      return undefined;
  }
});

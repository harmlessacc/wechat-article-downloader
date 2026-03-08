import os from "node:os";
import path from "node:path";
import process from "node:process";

const APP_DATA_DIR = "wechat-article-downloader";
const PROFILE_DIR_NAME = "chrome-profile";

export function resolveUserDataRoot(): string {
  if (process.platform === "win32") {
    return process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support");
  }
  return process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share");
}

export function resolveWeChatChromeProfileDir(): string {
  const override = process.env.WECHAT_DL_CHROME_PROFILE_DIR?.trim();
  if (override) return path.resolve(override);
  return path.join(resolveUserDataRoot(), APP_DATA_DIR, PROFILE_DIR_NAME);
}

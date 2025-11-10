import * as fs from "fs";
import * as path from "path";

const LOG_DIR = path.resolve("D:\\fatigue-detection-data-collector\\logs");
if (!fs.existsSync(LOG_DIR)) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch (e) {
    // best-effort; swallowing since callers may handle errors
  }
}

const LOG_FILE = path.join(LOG_DIR, "extension.log");
const ERROR_LOG_FILE = path.join(LOG_DIR, "extension.log");

function formatArgs(args: any[]) {
  return args
    .map((a) => {
      if (a instanceof Error) {
        return a.stack ?? a.message;
      }
      if (typeof a === "string") {
        return a;
      }
      try {
        return JSON.stringify(a);
      } catch (e) {
        return String(a);
      }
    })
    .join(" ");
}

function line(...args: any[]) {
  return `[${new Date().toISOString()}] ${formatArgs(args)}\n`;
}

export function log(...args: any[]) {
  try {
    fs.appendFileSync(LOG_FILE, line(...args), "utf8");
  } catch (e) {
    // swallow to avoid breaking extension runtime
  }
}

export function error(...args: any[]) {
  try {
    fs.appendFileSync(ERROR_LOG_FILE, "ERROR: " + line(...args), "utf8");
  } catch (e) {
    try {
      // fallback to main log
      fs.appendFileSync(LOG_FILE, "ERROR: " + line(...args), "utf8");
    } catch (e) {
      // give up
    }
  }
}

export default { log, error };

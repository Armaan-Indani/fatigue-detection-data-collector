import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import axios from "axios";
import { execSync } from "child_process";
import { log, error as logError } from "./logger";
import * as dotenv from "dotenv";

dotenv.config();

const USER_ID = process.env.USER_ID ?? "e4669eb0-ef12-4be8-81ac-60d14cf3a718";
const BACKEND_URL =
  process.env.BACKEND_URL ??
  "https://webserver-21719250255.asia-south1.run.app";

if (!process.env.USER_ID || !process.env.BACKEND_URL) {
  log(
    "Using default USER_ID/BACKEND_URL; set them in a .env file to override."
  );
}

let sessionStart: Date;
let fileSwitchCount: number;
let activeSeconds: number;
let idleSeconds: number;
let timer: NodeJS.Timeout;
let outFile: string;
let extensionContext: vscode.ExtensionContext;

let currentCommitHash: string | null = null;
let currentTaskId: string | null = null;

type SessionRecord = {
  session_start_time: string;
  session_end_time: string;
  active_minutes: number;
  idle_seconds: number;
  file_switches: number;
};

function getLatestCommitHash(): string | null {
  try {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return null;
    }

    const repoPath = workspaceFolders[0].uri.fsPath;
    const commitHash = execSync("git rev-parse HEAD", { cwd: repoPath })
      .toString()
      .trim();
    return commitHash;
  } catch {
    return null;
  }
}

async function createTaskForCommit(commitHash: string): Promise<string | null> {
  const baseUrl = `${BACKEND_URL}/api/v1/tasks`;
  const getTaskUrl = `${baseUrl}/getTaskID`;

  try {
    // Step 1: Check if task already exists
    const payload = { prev_commit_hash: commitHash };
    const existing = await axios.post(getTaskUrl, payload);

    log(existing.data);

    if (existing.data && existing.data.task_id) {
      log("Task already exists for commit:", commitHash);
      return existing.data.task_id;
    }
  } catch (err) {
    logError("Failed to check existing task for commit:", err);
  }

  const payload = {
    user_id: USER_ID,
    title: `Task for commit ${commitHash}`,
    description: "Auto-created from VS Code commit event",
    prev_commit_hash: commitHash,
  };

  try {
    // Step 2: Create new task
    const response = await axios.post(baseUrl, payload);
    log("Created new task for commit:", commitHash);
    return response.data.ID;
  } catch (err) {
    logError("Failed to create task for commit:", err);
    return null;
  }
}

export function activate(context: vscode.ExtensionContext) {
  log("Fatigue Detection Data Collector is now active!");

  extensionContext = context;
  sessionStart = new Date();
  fileSwitchCount = 0;
  activeSeconds = 0;
  idleSeconds = 0;

  let lastActivityAt = Date.now();
  const idleTimeoutMs = 15 * 1000; // 15 seconds
  let prevEditor =
    vscode.window.activeTextEditor?.document?.uri.toString() ?? "";

  // Ensure storage directory exists
  const outDir = "C:/fatigue-detection-data-collector";
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  outFile = path.join(outDir, "sessions.jsonl");

  // Timer: count active vs idle seconds
  timer = setInterval(() => {
    const now = Date.now();
    if (now - lastActivityAt <= idleTimeoutMs) {
      activeSeconds++;
    } else {
      idleSeconds++;
    }
  }, 1000);

  // Register events as "activity"
  const markActivity = () => {
    lastActivityAt = Date.now();
  };

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(markActivity),
    vscode.window.onDidChangeTextEditorSelection(markActivity),
    vscode.workspace.onDidOpenTextDocument(markActivity),
    vscode.workspace.onDidSaveTextDocument(markActivity),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      markActivity();
      const current = editor?.document?.uri.toString() ?? "";
      if (current && current !== prevEditor) {
        fileSwitchCount++;
        prevEditor = current;
      }
    })
  );

  // Command to show collected stats (for testing)
  const disposable = vscode.commands.registerCommand(
    "fatigueDetectionDataCollector.showStats",
    () => {
      const now = new Date();
      const duration = (
        (now.getTime() - sessionStart.getTime()) /
        1000 /
        60
      ).toFixed(1);

      vscode.window.showInformationMessage(
        `Session length: ${duration} min | Active: ${activeSeconds}s | Idle: ${idleSeconds}s | File switches: ${fileSwitchCount}`
      );
    }
  );
  context.subscriptions.push(disposable);

  // Watch for new commits and create tasks automatically
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders && workspaceFolders.length > 0) {
    const repoPath = workspaceFolders[0].uri.fsPath;
    const gitHeadPath = path.join(repoPath, ".git", "HEAD");

    if (fs.existsSync(gitHeadPath)) {
      // Get current commit hash at startup
      currentCommitHash = getLatestCommitHash();
      if (currentCommitHash) {
        log(`Initial commit detected.`);
        createTaskForCommit(currentCommitHash).then((taskId) => {
          currentTaskId = taskId;
        });
      }

      // Watch for commit changes
      fs.watchFile(gitHeadPath, async () => {
        const latestCommit = getLatestCommitHash();
        if (latestCommit && latestCommit !== currentCommitHash) {
          currentCommitHash = latestCommit;
          currentTaskId = await createTaskForCommit(latestCommit);
          log(`New commit detected.`);
        }
      });
    } else {
      logError("No .git/HEAD found. Git tracking disabled.");
    }
  }

  // Cleanup on deactivate
  context.subscriptions.push({
    dispose: () => {
      clearInterval(timer);
    },
  });
}

export async function deactivate(): Promise<void> {
  const sessionEnd = new Date();

  const record: SessionRecord = {
    session_start_time: sessionStart.toISOString(),
    session_end_time: sessionEnd.toISOString(),
    active_minutes: activeSeconds / 60,
    idle_seconds: idleSeconds,
    file_switches: fileSwitchCount,
  };

  fs.appendFileSync(outFile, JSON.stringify(record) + "\n", "utf8");
  log(`Session saved to ${outFile}`);

  const pluginVersion = extensionContext.extension.packageJSON.version;
  const taskId = currentTaskId || getLatestCommitHash() || "unknown-commit";
  const clientTs = new Date().toISOString();

  const payload = {
    client_ts: clientTs,
    plugin_version: pluginVersion,
    task_id: taskId,
    features: record,
  };

  const url = `${BACKEND_URL}/api/v1/events/`;

  try {
    const response = await axios.post(url, payload);
    log("Data sent successfully:", response.data);
  } catch (error: any) {
    logError("Error sending data:", error);
    const errorLogPath = path.join(
      "D:\\fatigue-detection-data-collector\\logs",
      "error.log"
    );
    try {
      fs.appendFileSync(
        errorLogPath,
        `[${new Date().toISOString()}] Error sending data: ${error}\n`,
        "utf8"
      );
    } catch (e) {
      logError(
        "Failed to write error log to disk. Original send error:",
        error
      );
      logError("Filesystem append error:", e);
      console.error(
        "Failed to write error log to disk:",
        e,
        "Original send error:",
        error
      );
    }
  }
}

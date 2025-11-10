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

let TASK_ID: string | null = null;

let sessionStart: Date;
let fileSwitchCount: number;
let activeSeconds: number;
let idleSeconds: number;
let timer: NodeJS.Timeout;
let outFile: string;
let extensionContext: vscode.ExtensionContext;

let currentCommitHash: string | null = null;

type SessionRecord = {
  session_start_time: string;
  session_end_time: string;
  active_minutes: number;
  idle_seconds: number;
  file_switches: number;
  prev_commit_hash: string;
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

async function fetchLatestTaskId(): Promise<string | null> {
  try {
    const url = `${BACKEND_URL}/api/v1/tasks/getLatestTask/${USER_ID}`;
    const response = await axios.get(url);
    if (response.data && response.data.task_id) {
      log(`Fetched latest task ID: ${response.data.task_id}`);
      return response.data.task_id;
    }
    log("No latest task found for this user.");
    return null;
  } catch (error) {
    logError("Failed to fetch latest task:", error);
    return null;
  }
}

async function createNewTask(title: string): Promise<string | null> {
  try {
    const url = `${BACKEND_URL}/api/v1/tasks`;
    const payload = {
      user_id: USER_ID,
      title,
      description: "Task created manually from VS Code",
    };
    const response = await axios.post(url, payload);
    if (response.data && response.data.ID) {
      log(`Created new task: ${response.data.ID}`);
      return response.data.ID;
    }
    return null;
  } catch (error) {
    logError("Failed to create new task:", error);
    return null;
  }
}

function startNewSession() {
  sessionStart = new Date();
  fileSwitchCount = 0;
  activeSeconds = 0;
  idleSeconds = 0;
  log(`New session started at ${sessionStart.toISOString()}`);
}

export async function activate(context: vscode.ExtensionContext) {
  log("Fatigue Detection Data Collector is now active!");

  extensionContext = context;

  TASK_ID = await fetchLatestTaskId();
  if (!TASK_ID) {
    log("No existing task found.");

    const create = await vscode.window.showInformationMessage(
      "No existing task found. Create one now?",
      "Yes",
      "No"
    );
    if (create === "Yes") {
      vscode.commands.executeCommand(
        "fatigueDetectionDataCollector.createNewTask"
      );
    }
  }

  startNewSession();

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

  // --- Command to create a new task manually ---
  const createTaskCommand = vscode.commands.registerCommand(
    "fatigueDetectionDataCollector.createNewTask",
    async () => {
      const title = await vscode.window.showInputBox({
        prompt: "Enter a name for the new task",
        placeHolder: "e.g. Refactor authentication module",
      });
      if (title) {
        const newTaskId = await createNewTask(title);
        if (newTaskId) {
          TASK_ID = newTaskId;
          vscode.window.showInformationMessage(
            `New task created. Active task ID: ${TASK_ID}`
          );
        } else {
          vscode.window.showErrorMessage("Failed to create new task.");
        }
      }
    }
  );
  context.subscriptions.push(createTaskCommand);

  // --- Git commit monitoring ---
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders && workspaceFolders.length > 0) {
    const repoPath = workspaceFolders[0].uri.fsPath;
    const gitHeadPath = path.join(repoPath, ".git", "HEAD");

    if (fs.existsSync(gitHeadPath)) {
      // Get current commit hash at startup
      currentCommitHash = getLatestCommitHash();
      log(`Session started with task_id: ${TASK_ID}`);

      fs.watchFile(gitHeadPath, async () => {
        const latestCommit = getLatestCommitHash();
        if (latestCommit && latestCommit !== currentCommitHash) {
          currentCommitHash = latestCommit;
          log(`Commit detected. Ending current session and starting new one.`);
          await endAndRestartSession();
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
    prev_commit_hash: getLatestCommitHash() || "N/A",
  };

  fs.appendFileSync(outFile, JSON.stringify(record) + "\n", "utf8");
  log(`Session saved to ${outFile}`);

  const pluginVersion = extensionContext.extension.packageJSON.version;
  const taskId = TASK_ID ?? "unknown-task";
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

async function endAndRestartSession(): Promise<void> {
  await deactivate();
  await new Promise((r) => setTimeout(r, 100));
  startNewSession();
}

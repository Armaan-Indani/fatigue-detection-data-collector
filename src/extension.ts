import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import axios from "axios";
import { execSync } from "child_process";
import { log, error as logError } from "./logger";
import * as dotenv from "dotenv";

dotenv.config();

const USER_ID = process.env.USER_ID ?? "d402ac71-9808-44ae-8fcc-8a1a4df8b1e5";
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
// let outFile: string;
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

async function processGitDiff(repoPath: string) {
  try {
    const diff = execSync("git diff HEAD~1 HEAD", { cwd: repoPath })
      .toString()
      .trim();
    if (!diff) {
      log("No diff found between last two commits.");
      return;
    }

    // Create folder for diffs
    const diffsDir = path.join(repoPath, "github-diffs");
    if (!fs.existsSync(diffsDir)) {
      fs.mkdirSync(diffsDir, { recursive: true });
    }

    // Split diff into per-file sections
    const diffBlocks = diff.split(/^diff --git /m).filter(Boolean);
    for (const block of diffBlocks) {
      const lines = block.split("\n");
      const firstLine = lines[0];
      const match = firstLine.match(/^a\/(.+?) b\/(.+)$/);
      const fileName = match ? match[2] : "unknown";

      // Keep only added/modified lines (those starting with '+', excluding headers)
      const addedLines = lines
        .filter(
          (line) =>
            line.startsWith("+") &&
            !line.startsWith("+++ ") && // skip metadata
            !line.startsWith("+++") // redundant guard
        )
        .map((line) => line.slice(1)) // remove '+'
        .join("\n");

      const safeName = fileName.replace(/[\\/:"*?<>|]+/g, "_");
      const diffFilePath = path.join(diffsDir, `${safeName}-diff.txt`);
      fs.writeFileSync(diffFilePath, addedLines, "utf8");
      log(`Saved added/modified lines for ${fileName} to ${diffFilePath}`);
    }

    // Still send full diff to API
    const apiUrl = `${BACKEND_URL}/api/v1/ai-detection`;
    const response = await axios.post(apiUrl, {
      user_id: USER_ID,
      commit_diff: diff,
    });

    log(`AI detection result: ${JSON.stringify(response.data)}`);
  } catch (err) {
    logError("Failed to process Git diff:", err);
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
    const gitDir = path.join(repoPath, ".git");
    const headFile = path.join(gitDir, "HEAD");

    if (fs.existsSync(headFile)) {
      const headContent = fs.readFileSync(headFile, "utf8").trim();

      // Example of headContent: "ref: refs/heads/main"
      let refPath: string;
      if (headContent.startsWith("ref:")) {
        refPath = path.join(gitDir, headContent.replace("ref: ", "").trim());
      } else {
        refPath = headFile;
      }

      currentCommitHash = getLatestCommitHash();
      log(`Session started with task_id: ${TASK_ID}`);

      fs.watch(refPath, async () => {
        const latestCommit = getLatestCommitHash();
        if (latestCommit && latestCommit !== currentCommitHash) {
          log(`New commit detected: ${latestCommit}`);
          currentCommitHash = latestCommit;

          await processGitDiff(repoPath);
          log(`Processed diff and restarting session...`);

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

  // fs.appendFileSync(outFile, JSON.stringify(record) + "\n", "utf8");
  // log(`Session saved to ${outFile}`);

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

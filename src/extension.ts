import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import axios from "axios";

let sessionStart: Date;
let fileSwitchCount: number;
let activeSeconds: number;
let idleSeconds: number;
let timer: NodeJS.Timeout;
let outFile: string;
let extensionContext: vscode.ExtensionContext;

type SessionRecord = {
  session_start_time: string;
  session_end_time: string;
  active_minutes: number;
  idle_seconds: number;
  file_switch_count: number;
};

export function activate(context: vscode.ExtensionContext) {
  console.log("Fatigue Detection Data Collector is now active!");

  extensionContext = context;
  sessionStart = new Date();
  fileSwitchCount = 0;
  activeSeconds = 0;
  idleSeconds = 0;

  let lastActivityAt = Date.now();
  const idleTimeoutMs = 60 * 1000; // 1 minute
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

  // Command to show collected stats (optional, for testing)
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
    active_minutes: Math.round(activeSeconds / 60),
    idle_seconds: idleSeconds,
    file_switch_count: fileSwitchCount,
  };

  fs.appendFileSync(outFile, JSON.stringify(record) + "\n", "utf8");
  console.log(`Session saved to ${outFile}`);

  const pluginVersion = extensionContext.extension.packageJSON.version;
  const taskId = "c85f41e4-7ce2-4027-aebf-92efdbf1e020";
  const clientTs = new Date().toISOString();

  const payload = {
    client_ts: clientTs,
    plugin_version: pluginVersion,
    task_id: taskId,
    features: record,
  };

  const url =
    "https://webserver-21719250255.asia-south1.run.app/api/v1/events/";

  try {
    const response = await axios.post(url, payload);
    console.log("Data sent successfully:", response.data);
  } catch (error: any) {
    console.error("Error sending data:", error);
    const errorLogPath = "C:/fatigue-detection-data-collector/error.log";
    fs.appendFileSync(
      errorLogPath,
      `[${new Date().toISOString()}] Error sending data: ${error}\n`,
      "utf8"
    );
  }
}

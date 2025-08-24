import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  console.log('Fatigue Detection Data Collector is now active!');

  let sessionStart = new Date();
  let fileSwitchCount = 0;
  let activeSeconds = 0;
  let idleSeconds = 0;

  let lastActivityAt = Date.now();
  const idleTimeoutMs = 60 * 1000; // 1 minute
  let prevEditor = vscode.window.activeTextEditor?.document?.uri.toString() ?? '';

  // Timer: count active vs idle seconds
  const timer = setInterval(() => {
    const now = Date.now();
    if (now - lastActivityAt <= idleTimeoutMs) {
      activeSeconds++;
    } else {
      idleSeconds++;
    }
  }, 1000);

  // Register events as "activity"
  const markActivity = () => { lastActivityAt = Date.now(); };

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(markActivity),
    vscode.window.onDidChangeTextEditorSelection(markActivity),
    vscode.workspace.onDidOpenTextDocument(markActivity),
    vscode.workspace.onDidSaveTextDocument(markActivity),
    vscode.window.onDidChangeActiveTextEditor(editor => {
      markActivity();
      const current = editor?.document?.uri.toString() ?? '';
      if (current && current !== prevEditor) {
        fileSwitchCount++;
        prevEditor = current;
      }
    })
  );

  // Command to show collected stats
  const disposable = vscode.commands.registerCommand('fatigueDetectionDataCollector.showStats', () => {
    const now = new Date();
    const duration = ((now.getTime() - sessionStart.getTime()) / 1000 / 60).toFixed(1);

    vscode.window.showInformationMessage(
      `Session length: ${duration} min | Active: ${activeSeconds}s | Idle: ${idleSeconds}s | File switches: ${fileSwitchCount}`
    );
  });

  context.subscriptions.push(disposable);

  // Cleanup on deactivate
  context.subscriptions.push({
    dispose: () => {
      clearInterval(timer);
      console.log('Fatigue Detection Data Collector session ended.');
    }
  });
}

export function deactivate() {}

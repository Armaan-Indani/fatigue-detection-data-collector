# Fatigue Detection Data Collector

This VS Code extension is designed to passively collect data on a user's coding activity to help researchers and developers better understand patterns of work and potential developer fatigue. It operates in the background, tracking key metrics during your coding sessions.

## Features

- **Automatic Data Collection**: The extension automatically starts collecting data when a VS Code window is opened.
- **Activity and Idle Time Tracking**: It distinguishes between active typing/editing time and periods of inactivity (idle time).
- **File Switch Counting**: The extension keeps a running count of how many times you switch between different files.
- **Session-Based Logging**: When the VS Code window is closed, it records the session's total active time, idle time, and file switches into a log file.
- **Data Location**: All data is saved locally to a `sessions.jsonl` file in the `C:\fatigue-detection-data-collector` directory. Each line in the file is a separate JSON object representing a single coding session.

### What is collected?
The extension collects and stores the following data for each session:
- `session_start_time`: The timestamp when the session began.
- `session_end_time`: The timestamp when the session ended.
- `active_seconds`: The total number of seconds the user was actively coding.
- `idle_seconds`: The total number of seconds the user was idle.
- `file_switch_count`: The number of times the user switched to a new file.

## Requirements

This extension has no external dependencies. It is built using the standard VS Code API and Node.js file system modules which are included with VS Code.

## Build and test

Each time you make changes, run:
```
npm run compile
```
Or enable auto-compile by running:
```
npm run watch
```
Then press F5 in VS Code to launch and test the extension.

## Extension Settings

This extension does not contribute any user-configurable settings through the `contributes.configuration` point. Its behavior is fixed and designed for automated data collection.

## Known Issues

Currently, there are no known issues. If you encounter any problems, please open an issue on the project's repository.

## Release Notes

### 1.0.0
Initial release of the Fatigue Detection Data Collector.
- Implemented core logic for tracking active time, idle time, and file switches.
- Added session-based data logging to a local JSON Lines file.
- Included a command `fatigueDetectionDataCollector.showStats` for viewing current session metrics.
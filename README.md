# Fatigue Detection Data Collector

A small VS Code extension that collects lightweight IDE activity signals (active vs idle time, file switches, and Git-related diffs) to help research and tooling for detecting developer fatigue or coding patterns.

This README documents how to build, run, and configure the extension. It also clarifies where data and logs are written and what is sent to the backend API.

## Key features

- Automatic session tracking on VS Code startup (activation event: `onStartupFinished`).
- Active vs idle time measurement (15s idle threshold by default).
- File switch counting.
- Detects new Git commits in the workspace, saves per-file added/modified lines under `github-diffs/` in the repository, and sends diffs to a configured backend API.
- Sends session-level events to a backend endpoint.

## What the extension collects

For each session the extension prepares a record including:

- `session_start_time` and `session_end_time`
- `active_minutes` and `idle_seconds`
- `file_switches`
- the latest commit hash when the session ended

In addition, when a new Git commit is detected, the extension will compute a diff (HEAD~1..HEAD), save added/modified lines to `github-diffs/<file>-diff.txt` inside the repo, and POST the full diff to the configured backend endpoint.

## Data storage and transmission (important)

- Runtime logs are written to a logs directory that is currently hard-coded to:

	D:\\fatigue-detection-data-collector\\logs

	(This path is used by `src/logger.ts` and `src/extension.ts` for error fallback logging.)

- Session data is POSTed to the backend URL defined by the `BACKEND_URL` environment variable (or the default if not provided). The extension constructs a payload and sends it to `${BACKEND_URL}/api/v1/events/` on deactivate.

- By default the code uses the following defaults if no `.env` is provided:

	- USER_ID: e4669eb0-ef12-4be8-81ac-60d14cf3a718
	- BACKEND_URL: https://webserver-21719250255.asia-south1.run.app

	You can override these by creating a `.env` file at the extension runtime working directory with keys `USER_ID` and `BACKEND_URL`.

Privacy note: session metrics and diffs may be sent to the configured backend. If you plan to run this extension, review the backend URL and USER_ID configuration and only use endpoints you trust.

## Prerequisites

- Node.js (LTS recommended)
- VS Code (for running and debugging the extension)

## Development: build and run

1. Install dependencies:

```bash
npm install
```

2. Compile once:

```bash
npm run compile
```

3. Or run the TypeScript watcher while developing:

```bash
npm run watch
```

4. Press F5 in VS Code to launch an Extension Development Host and test the extension.

## Useful commands contributed by the extension

- `Fatigue Detection: Show Stats` (`fatigueDetectionDataCollector.showStats`) — shows current session metrics in a VS Code info message.
- `Fatigue Detection: Create New Task` (`fatigueDetectionDataCollector.createNewTask`) — prompts for a task title and creates a task via the backend API.

## Configuration / .env

Create a `.env` file to override defaults (optional). Example:

```
USER_ID=your-user-id
BACKEND_URL=https://your-backend.example.com
```

Note: The current implementation reads environment variables via `dotenv` at runtime. When debugging from VS Code, ensure your environment or the debug launch configuration supplies these variables.

## Developer notes / TODOs

- The log directory path is currently hard-coded to `D:\\fatigue-detection-data-collector\\logs`. Consider making this path configurable or using the extension global storage path (via the `ExtensionContext`) for better portability.
- The extension attempts to call `git` in the workspace root; it will disable Git-related features if `.git/HEAD` is not present or if `git` is not available.

## Tests

Run tests (the project compiles first via `pretest`):

```bash
npm test
```

## Contributing

Contributions are welcome. Please open an issue or a PR on the repository: https://github.com/Armaan-Indani/fatigue-detection-data-collector

## License

MIT

## Contact

Project maintainer: Armaan Indani (see the GitHub repo for contact links)
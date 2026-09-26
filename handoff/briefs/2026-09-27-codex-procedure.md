# QA-0 — How Codex tests a DataPass VSIX on Windows (verified 2026-09-26)

Package QA-0 of `handoff/v3/12_CODEX_TEST_MODE.md` §8. It answers the §4.6 questions (Reach,
Host, Isolation, First run, Evidence), each with a source and, where possible, a real throwaway
try on Julian's PC. Written by TAMPON 19 (medium). The ARCHI corrects §4.3–4.5 of 12 from it, and
QA-3 corrects `common/testing/CODEX_PROCEDURE.md`.

## 0. Bottom line

1. **Only the Codex desktop app, in an interactive thread, can drive VS Code.** Computer Use is a
   feature of the ChatGPT/Codex desktop app (a plugin plus a per-app approval). Through the
   Codex CLI (`codex exec`), Computer Use saw **no apps at all** (`{"apps":[],"browsers":[]}`),
   even with a visible VS Code window in front of it. The terminal is not a host for the UI track.
2. **VS Code must be launched outside Codex's Windows sandbox.** Launched from the sandboxed shell
   (elevated sandbox: separate low-privilege user, private desktop), `Code.exe` installs
   extensions fine but cannot open a window: the GPU process dies and storage is read-only.
3. **The first run needs Julian once.** Computer Use asks for approval per app (Code.exe) in the
   app UI. Julian can choose **Always allow**, which lands in `config.toml`
   `[computer_use.windows] always_allowed_app_ids`. The model also asked for an explicit
   confirmation before installing a local VSIX ("run software from an unrecognized source").
4. **Windows Computer Use is foreground only.** It takes over the mouse and keyboard of the active
   desktop, which must stay visible and unlocked. It cannot run beside Julian's own work. Use a
   moment when he is away (with Remote Control from the phone), or a Windows VM.
5. **Isolation works for settings and extensions, but not for everything.** VS Code 1.139 still
   opens `%USERPROFILE%\.vscode-shared\sharedStorage\state.vscdb`, a shared store outside
   `--user-data-dir`.

## 1. What was run (this PC, 2026-09-26)

Environment: Windows 11 Pro 26200. Codex desktop app `OpenAI.Codex 26.924.2738.0` (MSIX), signed
in. Codex CLI `codex-cli 0.155.0-alpha.16.4` (bundled with the app at
`%LOCALAPPDATA%\OpenAI\Codex\bin\<hash>\codex.exe`, not on PATH). `config.toml`:
`[windows] sandbox = "elevated"`. Plugins `computer-use@openai-bundled` and
`unified-computer-use@openai-bundled` enabled; feature `computer_use` stable/true.
VS Code 1.139.1. DataPass 0.26.0 VSIX built from main (`npm run package`: there is no GitHub
release asset). Run root `%TEMP%\dp-qa0` with a copy of `examples/v3/doc-pipeline`.

| # | Who / how | Step | Result |
|---|---|---|---|
| A | Claude, plain shell | `code --user-data-dir "%TEMP%\dp-qa0\vscode-user" --extensions-dir "%TEMP%\dp-qa0\vscode-ext" --install-extension "%TEMP%\dp-qa0\datapass-vscode-0.26.0.vsix"` then the same flags + `--list-extensions --show-versions` | **Works**: `julian-passebecq.datapass-vscode@0.26.0` |
| B | `codex exec -C %TEMP%\dp-qa0 -s workspace-write --skip-git-repo-check --json -` (prompt: install, launch, click, screenshot) | first command | The elevated sandbox setup (`codex-windows-sandbox-setup`) took **about 10 min** before the first command ran. The model then **stopped and asked for confirmation** before installing a local VSIX. Nothing was installed. |
| C | `codex exec resume --last` with the confirmation | install + list in `codex-user` / `codex-ext` | **Works**, the same command as A, from Codex's sandbox (plus a harmless Crashpad `CreateFile: Access is denied`). |
| C | same | launch: `code --user-data-dir … --extensions-dir … --new-window "%TEMP%\dp-qa0\doc-pipeline"` | **Fails**. Exit 0 but no window. A retry via `Code.exe` logged `GPU process exited unexpectedly: exit_code=-1073741515`, `CodeWindow: renderer process gone (reason: launch-failed, code: 49)`, `GPU process isn't usable. Goodbye.`, `SQLITE_READONLY`, and `EPERM … .vscode-shared\sharedStorage\state.vscdb`. Computer Use: `{"apps":[],"browsers":[]}`. |
| D | Claude, plain shell | `Code.exe --user-data-dir "%TEMP%\dp-qa0\vscode-user" --extensions-dir "%TEMP%\dp-qa0\vscode-ext" --new-window "%TEMP%\dp-qa0\doc-pipeline"` | **Works**: window *Welcome - doc-pipeline - Visual Studio Code* (the VS Code Welcome page opens on a fresh profile). |
| E | `codex exec … -s workspace-write` (prompt: operate only that window, trust, DataPass view, palette, screenshot) | Computer Use | **Fails**: `cua.getState()` → `{"apps":[],"browsers":[]}`, "window-listing method unavailable". Nothing clicked, no screenshot. |
| F | `codex exec … -c windows.sandbox_private_desktop=false` (prompt: only list apps) | Computer Use | **Fails**: "No visible apps or windows." So the private desktop is not the cause: from the CLI, Computer Use sees nothing. |

Not run: the same flow from an interactive thread of the Codex desktop app. It needs Julian at the
PC to approve Code.exe in the app, and it takes over his mouse and keyboard (see §3, "À faire par
toi").

## 2. The §4.6 questions

### Reach — what can Codex's desktop control reach? Does it need a visible, unlocked desktop?

- Computer Use "can see and operate graphical user interfaces on macOS or Windows". It can view
  screen content, take screenshots, and interact with windows, menus, keyboard input and
  clipboard state in the target app. Sources:
  [Computer Use](https://developers.openai.com/codex/app/computer-use) (checked 2026-09-26),
  sections "Computer Use" and "Safety guidance".
- It works on screenshots and input, not on an accessibility API for webviews. The docs name no
  per-widget limit, so the VS Code window, webviews (Architecture, Workbench), the command
  palette, quick picks and notifications are all pixels to it. **Not verified here**: Computer
  Use never saw a window from the CLI (runs C, E). Verify in the app (§3).
- **Visible and unlocked: yes.** "On Windows, keep the target app visible on the active desktop
  while the task runs." "On Windows, Computer Use runs on the active desktop. It can't operate in
  the background while you keep using the same Windows session." "Locked use is for macOS. On
  Windows, Computer Use works in the foreground." For unattended runs: "keep the Windows device
  unlocked", use Remote Control from the phone, "or run the ChatGPT desktop app inside a Windows
  virtual machine". Same page, sections "Windows foreground use" and "Locked use".
- Limits: it "can't automate terminal apps or ChatGPT itself", and it "can't authenticate as an
  administrator or approve security and privacy permission prompts". Same page, "Safety guidance".

### Host — app, terminal, or app with Computer Use? What do sandbox and approvals allow for `code` and `npm`?

- **Host: the Codex desktop app, interactive thread, Computer Use plugin enabled.** Setup is
  **Plugins > Computer Use > Install plugin**, then turn on the server and skill toggles
  ([Computer Use](https://developers.openai.com/codex/app/computer-use), "Set up Computer Use").
  Already done on this PC.
- **Not the terminal.** Verified in runs C and E: `codex exec` has the plugin but Computer Use
  returns no apps. The docs describe Computer Use as a desktop-app feature only, and
  `codex exec` is "for scripted or CI-style runs that should finish without human interaction"
  ([CLI reference](https://developers.openai.com/codex/cli/reference), `codex exec`), while Computer
  Use needs per-app approvals in the app UI.
- **Sandbox.** On Windows the native sandbox "block[s] filesystem writes outside the working folder
  and prevent[s] network access without your explicit approval". `elevated` "uses dedicated
  lower-privilege sandbox users, filesystem permission boundaries, firewall rules", and "by
  default, both sandbox modes also use a private desktop for stronger UI isolation"
  ([Windows sandbox](https://developers.openai.com/codex/windows), "Configure the Windows sandbox").
  Consequences, verified:
  - `code --install-extension` and `--list-extensions` **work in the sandbox** when both dirs are
    inside the workspace (run C).
  - **Launching the VS Code window from the sandbox fails** (run C: GPU process dies, read-only
    storage). A window launched by a sandbox user on a private desktop would not be on Julian's
    active desktop anyway.
  - So the **launch must run outside the sandbox**. In the app, Codex requests an escalated
    (unsandboxed) run and Julian approves it once, or a `rules` entry allows `Code.exe`
    ([Rules](https://developers.openai.com/codex/rules)). Alternatively, the prepare helper (§4.3)
    is run by Julian or by Claude. **Not verified**: needs the app (§3).
  - `npm ci` / `npm run package` need network: with `workspace-write` plus on-request approval,
    Codex asks for network ([Approvals and security](https://developers.openai.com/codex/agent-approvals-security),
    table "Common sandbox and approval combinations": Auto = "requires approval to edit outside the
    workspace or to access network"). **Not verified** with Codex; I built the VSIX myself.
- **Approvals.** Presets are Ask for approval / Approve for me / Full access. The CLI equivalent is
  `--sandbox workspace-write --ask-for-approval on-request`; "Auto-review" routes eligible requests
  to a reviewer (`-c approvals_reviewer=auto_review`) (same page). Computer Use adds **a separate
  per-app approval**: "ChatGPT asks for your permission before it can use an app on your
  computer. You can choose Always allow". This is stored as
  `[computer_use.windows] always_allowed_app_ids = […]` in `$CODEX_HOME/config.toml`, using the
  executable name for a desktop app ([Computer Use](https://developers.openai.com/codex/app/computer-use),
  "Configure Windows app policy"). For VS Code that is presumably `Code.exe`. **Not verified**:
  take the exact id from the first approval prompt.
- **Model-level confirmation (verified, run B).** Before installing a local VSIX the model
  stopped: "installing a locally supplied VSIX is a consequential 'run software from an
  unrecognized source' action under the Computer Use policy, I need your confirmation". The
  `qa-run` prompt must state up front that the VSIX is the user's own build and that installing
  it into the isolated dirs is authorized. Even then, expect one confirmation turn.
- **Slow first command (verified, run B).** The elevated sandbox setup took about 10 minutes on
  `%TEMP%\dp-qa0` before the first command. A run root under a small, dedicated folder (not
  `%TEMP%`) is likely faster. **Not measured.**

### Isolation — do `--user-data-dir` and `--extensions-dir` isolate completely? Can it run beside Julian's VS Code?

- VS Code docs: `--user-data-dir` "can be used to run multiple isolated instances of VS Code with
  separate environments, settings, and extensions". Extensions must be installed per directory
  ([Command line](https://code.visualstudio.com/docs/configure/command-line), checked 2026-09-26).
  Verified: the extension list of the isolated profile shows only DataPass; Julian's profile was
  not touched.
- **Not complete (verified in the logs):** VS Code 1.139 still opens a machine-wide shared store,
  `[shared storage] Creating shared storage database at 'c:\Users\julia\.vscode-shared\sharedStorage\state.vscdb'`,
  from both isolated profiles. This file lies outside the run root and may be read by Julian's
  VS Code too. The Codex sandbox cannot write it (`EPERM`), which adds to the failed launch.
  Deleting `<run root>/vscode-user` does not clean it. Low risk (UI state, not settings or
  extensions), but the procedure must say so and must not delete it.
- **Beside Julian's VS Code:** a different `--user-data-dir` is a separate instance, so both
  windows can be open (VS Code docs above). But Computer Use on Windows takes over the whole
  foreground, so Julian cannot use his VS Code (or anything else) during the run. Side by side on
  screen: yes. At the same time for Julian: no.

### First run — workspace trust and the DataPass walkthrough

- On a fresh profile, VS Code opened its **Welcome** page (run D, window title
  *Welcome - doc-pipeline*).
- Workspace trust: `--disable-workspace-trust` ("only affects the current session"),
  `security.workspace.trust.startupPrompt: "never"`, or `security.workspace.trust.enabled: false`
  ([Workspace Trust](https://code.visualstudio.com/docs/editing/workspaces/workspace-trust),
  checked 2026-09-26). DataPass declares `untrustedWorkspaces: limited`. In Restricted Mode it
  reads files but never runs Git or commands (`package.json` `capabilities`). A client journey
  must therefore run **trusted**, or it tests the restricted mode by mistake.
- **Recommendation:** the prepare helper writes `<run root>/vscode-user/User/settings.json` with
  `"security.workspace.trust.startupPrompt": "never"` and `"workbench.startupEditor": "none"`, and
  launches with `--disable-workspace-trust`. The DataPass walkthrough (`datapass.getStarted`) is
  then part of a journey ("Help: Welcome" → DataPass), not an obstacle. If a journey tests
  first-run itself, drop these and let Codex click the trust dialog. **Not verified** (no
  Computer Use session reached the window).

### Evidence — where does Codex save screenshots, and can it attach them?

- The docs say Computer Use takes screenshots. They are session context ("Your ChatGPT data
  controls apply to content processed through ChatGPT, including screenshots taken by Computer
  Use"), and the docs say nothing about saving them to disk
  ([Computer Use](https://developers.openai.com/codex/app/computer-use), "Safety guidance").
  In run E the Computer Use interface exposed **no file-writing capability** ("the permitted
  Computer Use interface exposed no file-writing capability").
- **So a screenshot file must come from a shell command.** Codex runs a small PowerShell capture
  (`System.Drawing` `CopyFromScreen`, verified working on this PC outside the sandbox) or a
  helper script into `reports/<run-id>/screens/`. From the sandbox this may fail like the launch
  (the private desktop sees no screen). It must then run escalated. **Not verified.** The report
  links the PNG paths.

## 3. Working procedure (what CODEX_PROCEDURE.md should say today)

Verified lines are marked ✔; the rest are the best reading of the docs, to confirm in the first
real app run.

```powershell
# ✔ install into an isolated profile (works from Codex's sandbox too)
code --user-data-dir "<root>\vscode-user" --extensions-dir "<root>\vscode-ext" --install-extension "<root>\datapass-vscode-<version>.vsix"
# ✔ check
code --user-data-dir "<root>\vscode-user" --extensions-dir "<root>\vscode-ext" --list-extensions --show-versions
# ✔ launch — OUTSIDE the Codex sandbox (escalated run approved in the app, or run by the helper)
& "$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe" --user-data-dir "<root>\vscode-user" --extensions-dir "<root>\vscode-ext" --new-window --disable-workspace-trust "<root>\<client>.code-workspace"
```

Then, in the **Codex desktop app** (not `codex exec`), in a thread whose prompt says the VSIX is
the user's own build: `@Computer` (or "use Computer Use") on the window "… - Visual Studio Code",
walk the journeys, save screenshots with a shell capture (escalated), and write the report. At the
end close the window and delete `<root>\vscode-user` and `<root>\vscode-ext` (not
`%USERPROFILE%\.vscode-shared`).

## 4. For Julian (also in effort-board/todo.md)

| What | Why | How long |
|---|---|---|
| In the Codex desktop app, run the QA-0 app check: a new thread on `%TEMP%\dp-qa0` with the prompt in `%TEMP%\dp-qa0\prompt-app.txt`, approve Code.exe ("Always allow") and the one escalated launch, then leave the PC alone while it clicks | The only unverified part (Reach, Evidence, first run in the app) needs your approvals and your foreground | 10 min |

## 5. Sources (all checked 2026-09-26)

- Computer Use — https://developers.openai.com/codex/app/computer-use
- Windows sandbox — https://developers.openai.com/codex/windows
- ChatGPT/Codex desktop app for Windows — https://developers.openai.com/codex/app/windows
- CLI reference (`codex exec`, flags) — https://developers.openai.com/codex/cli/reference
- Approvals and security — https://developers.openai.com/codex/agent-approvals-security
- Rules — https://developers.openai.com/codex/rules
- VS Code command line — https://code.visualstudio.com/docs/configure/command-line
- VS Code Workspace Trust — https://code.visualstudio.com/docs/editing/workspaces/workspace-trust
- Local: `codex --version`, `codex features list`, `codex plugin list`, `codex exec --help`,
  `%USERPROFILE%\.codex\config.toml`, VS Code logs `<root>\codex-user\logs\*\main.log`.

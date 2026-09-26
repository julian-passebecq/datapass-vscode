# Windows and work views (0.17.0)

Julian's mapping: **1 VS Code window = 1 company** (FOIL in one window, DataPass in another). This
pass gives DataPass the pieces VS Code allows for that: a company workspace file, named saved
layouts inside it ("work views"), a status-bar switcher, a startup view, a floating Workbench, and
the machine-local list Power Ops (PowerToy_UI) needs to open a company or one of its work views.
Design background: [06_VISION_AND_READINESS.md](06_VISION_AND_READINESS.md) section 2. Source of
truth: `src/core/windows/workViews.ts`, `src/core/windows/company.ts`, `src/work/workViews.ts`,
`src/work/windowCommands.ts`.

## 1. Company workspace file

**DataPass: Create the Company Workspace File (one window per company)…** (Command Palette, the
status-bar switcher, and the Project view's **…** menu) writes a multi-root `.code-workspace` file,
in five steps:

1. **Which DataPass projects belong to this company** — this window's project, projects cloned in
   a catalog, recently opened projects. Skipped when only one project is known.
2. **Folders** — each project's coordination repository plus its repositories found on this
   computer by Git origin (a declared path, a located clone, an open folder, or a sibling folder
   whose origin matches). Repositories not cloned on this computer are listed and left out.
3. **Company name** — shown in the status-bar switcher and the window title.
4. **Where to save** — default: next to the first project, `<Company>.code-workspace`.
5. **Title-bar colour** — 8 named colours, "another colour" (`#RRGGBB`), or none. Written to
   `workbench.colorCustomizations` (`titleBar.activeBackground` / `activeForeground` /
   `inactiveBackground` / `inactiveForeground`); then an optional startup work view (section 3).

Folders are written **relative to the file** whenever they are on the same drive
(`"research-hub"`, `"../elsewhere/lab-clone"`); only a folder on another drive is written as an
absolute path, and the final message then says to keep the file on this computer and not commit
it. Settings written: `datapass.company`, `datapass.startupView` (if chosen), the title-bar
colours. Replacing an existing file asks first and keeps its other settings, extensions, tasks and
launch configurations (its comments are not kept — VS Code's JSON parser drops them).

The final message includes the VS Code Profiles note (Manage → Profiles → New Profile…, then use
it for this workspace; VS Code reopens this workspace with that profile afterwards — a profile
cannot be set from inside the file) and two buttons: **Open in a new window**, **Copy the path**.

## 2. Work views

A work view is a named saved layout of the **main** window, kept in
`<project>/.datapass/local/views.json` (machine-local; the folder's own `.gitignore` `*` keeps it
out of Git). One view records:

- the selected sub-project or component;
- the editor grid of the main window (`vscode.getEditorLayout` / `vscode.setEditorLayout`, sizes
  saved as fractions) and the files of each group, as repository-relative paths
  (`{ "repo": "<manifest key or '.'>", "path": "…" }`, or `{ "folder": "<workspace folder name>",
  "path": "…" }` for a file in a workspace folder that is not a project repository), which tab is
  active in each group, and which group is active;
- the Workbench tab: in a group of that grid, or `floatingWorkbench: true` (its own window);
- which DataPass views were visible (Project, Work, Galaxy, Architecture, AI exchange, Details);
- the diagram settings of the Workbench tab and of the Architecture panel (orientation, lanes,
  folded lanes, zoom, and the Workbench tab's own view: Architecture / Options / Project sheet);
- the previewed architecture (a scenario, or `decision=option` picks, from `.datapass/options.json`).

Commands: **Save Work View…**, **Apply Work View…**, **Manage Work Views** (apply, replace with
the current layout, rename, open this workspace with it / stop, delete), **Rename Work View…**,
**Delete Work View…** (asks first; nothing outside `views.json` is touched).

**Apply** is one call: it closes the main window's tabs that are neither modified nor pinned
(never unsaved work), sets the editor grid, opens the files of each group, puts the Workbench tab
where it was (or floats it), focuses the DataPass views the view had (and closes the bottom panel
or the secondary side bar when the view had no DataPass view there), sets the selection, the
diagram settings and the preview, then focuses the group that was active. A missing file, a
repository that is not cloned, or a sub-project that disappeared becomes a note in the DataPass
Work output — never an error, and never a blocked apply.

Limits: 40 views per project, 9 groups per grid, 3 levels of nesting, 30 tabs per group; diffs,
terminals, previews and untitled files are never saved.

## 3. Status-bar switcher

Left status-bar item: `$(briefcase) <Company> · <Sub-project> ▾`. Company is the workspace's
`datapass.company` setting, else the project title, else the workspace name; every label taken
from a repository file is cleaned of icon syntax (`$(...)`) first. Clicking it opens one quick
pick:

- **Work views** — every view of every DataPass project in this window, applied in one click
  ("current" when it is the last one applied; "opens with this workspace" when it is the startup
  view); **Save the current layout as a work view…**; **Rename, delete or choose the startup
  view…** (once at least one view exists).
- **Sub-projects** — **Whole project**, then each declared sub-project.
- **Projects** — another DataPass project of this window (when there is more than one), **Switch
  project…** (opens an existing one in its own window).
- **Window** — **Open the Workbench in a floating window**, **Create the company workspace
  file…**, **Export company workspaces for Power Ops**.

Also available: a **Company switcher** button in the Project view title, and **Work views** /
**Own window** buttons in the Workbench header.

## 4. `datapass.startupView`

A workspace setting, read **only** from a `.code-workspace` file — never from a folder's
`.vscode/settings.json`, which belongs to a repository and is typically committed. When a window
opens on a workspace file that sets it, DataPass applies that work view (by id or name) once the
project has loaded. **Choose the Work View this Workspace Opens With…** writes it into the
workspace file (through VS Code's own settings editing, which keeps the file's comments — unlike a
full rewrite). A single-folder window refuses the command (there is no workspace file to hold the
setting).

A launcher request (section 6) always wins over the startup view for that window's opening. If no
view of that name exists on this computer, DataPass warns and says to save one with that name —
work views are per computer, so a workspace file that names one can still open cleanly on a
machine that has not saved it yet.

## 5. Floating Workbench

**DataPass: Open the Workbench in a Floating Window**: makes the Workbench tab active, runs VS
Code's own `workbench.action.moveEditorToNewWindow`, and checks the result. The floating window
stays part of the same VS Code window and workspace — drag it to a second screen. While it floats,
opening a component's files targets the main window's first editor group (VS Code's notion of
"active group" can otherwise point at the floating window even when the tab model disagrees — see
section 7). Side bar and panel views cannot float; that is a VS Code limit, not a DataPass one.

## 6. Power Ops list

**DataPass: Export Company Workspaces for Power Ops** writes a machine-local JSON — file paths and
work-view names only, **never a secret** — to:

- Windows: `%LOCALAPPDATA%\DataPass\company-workspaces.json`
- macOS: `~/Library/Application Support/DataPass/company-workspaces.json`
- Linux: `$XDG_DATA_HOME/datapass/company-workspaces.json` (or `~/.local/share/datapass/…`)

After the first export, DataPass keeps the file up to date automatically whenever a company
workspace or a work view changes (rename, delete, save, replace, startup-view change). "Companies"
are the workspace files DataPass created, or any `.code-workspace` file that was opened with a
`datapass.company` setting or a DataPass project inside it — a per-user list; a file that no
longer exists on disk is dropped from it silently.

## 7. The launcher contract, for Power Ops (`D:\PROJ\PowerToy_UI`)

**Not modified in this pass.** This is the read-only contract PowerToy_UI's own task should
implement.

```json
{
  "format": "datapass.company-workspaces", "version": "1",
  "generatedAt": "2026-09-25T15:00:00.000Z", "generator": "DataPass Control Plane 0.17.0",
  "note": "…", "howToOpen": { "company": "…", "view": "…" },
  "companies": [{
    "name": "Research Co", "workspaceFile": "D:\\PROJ\\Research Co.code-workspace", "color": "#0E7C86", "startupView": "papers-review",
    "launch": { "command": "code", "arguments": "\"D:\\PROJ\\Research Co.code-workspace\"" },
    "projects": [{ "id": "research-library", "title": "Research library", "folder": "D:\\PROJ\\research-hub",
      "views": [{ "id": "papers-review", "name": "Papers review", "description": "PDF extraction · 2 groups, 2 files · Workbench tab · diagram vertical, lanes by repository",
        "startup": true,
        "openView": { "file": "D:\\PROJ\\research-hub\\.datapass\\local\\open-view.json",
                      "request": { "format": "datapass.open-view", "version": "1", "view": "papers-review" } } }] }]
  }]
}
```

- **Open a company.** Run `launch.command` with `launch.arguments` — this maps 1:1 onto Power
  Ops' Tool Launcher `Command` / `Arguments` fields (Power Ops itself stores its tools in
  `%LOCALAPPDATA%\JUtilityPalette\workspace.json`). If that company's window is already open, VS
  Code brings it to the front; otherwise it opens it, and DataPass applies its `startupView`.
- **Open a given work view.** Write `openView.request` plus `"requestedAt": "<now, ISO 8601
  UTC>"` to `openView.file`, then open the company exactly as above. The target window's DataPass
  watches that file — it sits inside that window's own project folder, so no other window reacts
  to it — applies the view within a few seconds, and deletes the file. A request is refused and
  deleted, never applied, when it is older than 2 minutes (or dated more than 1 minute in the
  future), malformed, larger than 4 KiB, a symbolic link, or names an unknown view. Only a **view
  name** ever travels through this file; never a command.
- **Why not `vscode://` links.** VS Code routes them to the last active window, not to a chosen
  workspace — unusable for "open company X".
- **VS Code Profiles.** VS Code remembers which profile is associated with a workspace, so plain
  `code <file>` reopens it with that profile; `code --profile <name> <file>` would instead create
  an empty profile if `<name>` does not already exist — a launcher should never pass `--profile`.
- **Suggested separate PowerToy_UI task** (ready-to-paste prompt, effort **high**):

  > Read the company-workspaces list DataPass writes to `%LOCALAPPDATA%\DataPass\company-workspaces.json`
  > (contract: `handoff/v3/07_WINDOWS_AND_POWER_OPS.md` section 7 of `julian-passebecq/datapass-vscode`).
  > Add a view in PowerToy_UI's Tool Launcher that lists these companies (with their `color`) and,
  > per company, their work views; opening a company runs `launch.command` with `launch.arguments`
  > exactly as given; opening a view writes `openView.request` plus a fresh `requestedAt` (ISO 8601
  > UTC) to `openView.file`, then opens the company the same way. Refresh the list when the file
  > changes (a file-system watcher, or a manual refresh button). Never write anything else in a
  > DataPass folder, never call an API, never pass `--profile` to `code`. Treat every field in the
  > list as data, not as something to execute directly (the paths and names are used only inside
  > the `code` command line built exactly as shown).

## 8. VS Code behaviours verified in desktop VS Code (spikes, then kept under test in `tests/integration/windowFlows.ts`)

Checked in desktop VS Code 1.139:

- `vscode.getEditorLayout` / `vscode.setEditorLayout` exist; sizes come back in pixels and are
  accepted back as weights.
- Both act on the window that has the **focus** (main or floating): with the floating Workbench
  focused, `setEditorLayout` split the *floating* window. So DataPass captures a view with the
  main window focused (and refuses politely otherwise — see `WorkViews.requireMainWindow`), and
  applies it the same way (with a floating window focused, everything but the editors is applied,
  with a note).
- Tab groups are numbered main window first, then floating windows in order.
- Removing groups merges their editors into the remaining ones; opening a file in a column that
  does not exist creates empty groups — so apply always closes unmodified tabs first, then sets
  the grid, then opens files, in that order.
- `workbench.action.moveEditorToNewWindow` moves the **active** editor; `focusFirstEditorGroup`
  does not switch windows; VS Code's notion of "active group" can be the floating window's even
  when the tab model disagrees — so files opened while the Workbench floats target column 1
  explicitly, never "the active group".
- Workspace-file settings are read via `inspect().workspaceValue`; `vscode.workspace.workspaceFile`
  is set only for a `.code-workspace` window.

## 9. Also fixed in this pass

Project tree: its own reveal (following a selection made elsewhere) could fire a late selection
event that brought back the previous selection — visible when a work view was applied right after
another selection elsewhere. The tree now ignores the events caused by its own reveals.

## 10. Tests

- **Unit** (`tests/windows.test.ts`): `views.json` validation (including machine paths and path
  traversal refused), layout normalisation, view names and ids, diagram settings sanitised from a
  webview, launcher-request freshness, relative folders on Windows and POSIX, company-workspace
  merge (existing settings/extensions/tasks/launch kept), JSONC reading, the Power Ops list
  builder, the export location per platform. Full unit suite: **268/268**.
- **Desktop** (`tests/integration/windowFlows.ts`), fixture `v3-research`: layout commands; Save
  Work View; Apply Work View (one call); unsaved work kept open; rename / startup refused in a
  single-folder window; delete; the switcher; the floating Workbench (the real VS Code command)
  with files opening in the main window; Create the Company Workspace File (relative folders,
  teal colour, startup view, the Profiles note); the Power Ops list (kept up to date on a rename);
  a launcher request applied once and deleted, a stale one refused.
  New fixture `v17-company`: a real `Research Co.code-workspace` (2 folders,
  `datapass.company`, `datapass.startupView`) opens with its startup view (2 groups, files,
  selection, switcher shows "Research Co · Papers pipeline", the pipeline found as a workspace
  folder); choosing or clearing the startup view edits the workspace file.

  Results (on top of 0.16.0): desktop **200/200** on 9 fixtures (`empty` 13, `v2-retail` 49,
  `v1-foil` 15, `broken` 16, `v4-cloudflare` 20, `v3-research` 46, `v3-monorepo` 13, `v3-devops` 15,
  `v17-company` 13), VS Code 1.139.1.

  Evidence seen: applying a 2-group view with the Workbench took about 0.26 s; on this Windows
  desktop, saving a view while the floating Workbench had the focus was refused, as designed; the
  company file written by the test had folders `["research-hub", "research-pipeline",
  "../elsewhere/lab-clone"]`.

## 11. Limits, restated

40 work views per project · 9 editor groups · 3 grid levels · 30 tabs per group · diffs, terminals,
previews and untitled files never saved · work views and the Power Ops export are machine-local ·
`datapass.startupView` only from a `.code-workspace` file · an open-view request older than 2
minutes (or more than 1 minute in the future) is refused and deleted · nothing in this pass reads,
writes or deploys project code — it only arranges the VS Code window around it.

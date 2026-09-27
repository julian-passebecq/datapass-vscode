# DataPass V3 — product vision (Julian, 2026-09-27)

> Recorded by the PM from Julian's review of 1.0.0-rc.3 on the Codex Wind Lab client (screenshots of the Workbench, the side tree and the bottom-panel diagram) and his answers the same evening. This is the product intent for V3; the technical architecture is requested from the tech lead (GPT 6 Pro) in `techleadclaudegpt6/datapass-vscode/00-report/2026-09-27-v3-request.md` and its addendum. Items marked *PM default* were chosen by the PM with Julian's standing permission to object.

Julian's summary: "we already do quite a lot well — what does not exist yet is a Hop-like view and a supercharged Git; the rest is ergonomics, navigation, UI/UX, colours, light and dark Microsoft themes." V3 is the next target, straight after 1.0.0.

## 1. Decisions already taken

- **No monitoring.** Only a *project links page*: the project's useful tools and pages (dashboards, Databricks/Fabric workspaces, portal pages, repositories, docs).
- **AI pilot: validate / plan only** (`bundle validate`, `tofu plan`…); deployment stays in the official tool, done by the person.
- **Apache Hop is only a visual reference.** DataPass renders what the bridge describes; it never runs Hop or anything else to draw it.

## 2. Five V3 workstreams

### 2.1 Navigation and shell (biggest gain, mostly reorganisation)
- **Home = module dashboard** (*PM default*): tiles for Architecture, Git, AI, Readiness, Board, Project links…, each usable on its own, plus a preview of the architecture diagram; a person can save their own layout. Today's "everything everywhere" flexible layout is hard to navigate.
- **DataPass split into modules** grouped by skill area, each with its sub-features; a closed module loads nothing.
- **One tree, on the left.** Buttons switch what the left side-bar tree lists (Project, Architecture, Git, AI, Files) and it adapts to the screen in use; a "natural tree" button returns to the Explorer. **No second tree inside the Workbench** — it takes too much width.
- **A thin right rail**: a vertical column of icon buttons (Details, AI, Git mode, Import/Export…) that expands into today's full right panel.
- **Close buttons live on the panel they close.** A second toolbar for navigation where it helps.
- **No "DataPass Architecture" tab in the bottom panel** next to the terminal.
- When a file's code is shown, DataPass shows the file's visual explanation (2.2), not the big architecture diagram.

### 2.2 DataPass Hop — understand a file (the new part)
- Double-click a pipeline block: the file's **code opens on the right**, and the **figure on the left zooms into a narrow, vertical visual explanation of that file** (left pane = visual, right pane = code). No separate view.
- **Synchronised both ways**: clicking a milestone in the code advances the visual; scrolling the visual highlights the matching code lines.
- File types, in order (*PM default*): **PySpark and SQL** (joins drawn on the left of the SQL file), then **Airflow DAGs**, then **ADF / Fabric pipeline JSON**, then **Dockerfile / Bicep / OpenTofu**.
- A **DataPass visual grammar** (blocks, links, milestones, provenance), described as **JSON in the bridge**. It is written **in advance by the client AI** together with the code, and DataPass flags it as stale when the code changed; an **"Explain this file" button** prepares a work order for Claude or Codex when it is missing (*PM default*).
- Pipelines look realistic: cloud-provider icons, shapes inspired by Data Factory / Fabric.

### 2.3 Supercharged Git (*PM default*)
- **Git on the diagram**: a change set (pull request, commits) is drawn on the blocks it modifies, with its state.
- **Visual history of a file** beside its code, with a readable, easy-to-find diff view.
- Later candidates: one-click actions across all of a client's repositories; variants tied to Git references.
- The Git view can be collapsed; with a single architecture selected it is no longer in the way.

### 2.4 Appearance
- **Light and dark Microsoft-style themes**; official provider icons and VS Code's file-type colours.
- The **DataPass overlay is lighter, smaller and switchable** (validated / not validated can be hidden), in its own colours distinct from VS Code's (fluorescent blue, violet, plus green and orange), everything customisable.
- **Fewer icon colours in the Project tree**, so what matters stands out.
- Code font size adjustable from DataPass presets.

### 2.5 Project links page
As decided in §1.

## 3. What 1.0 already provides (keep)
Project model, bridge, variants, readiness, toolchain and connections, work orders, AI exchange, the Git view, the diagram with provider colours and three reading levels, the qa:ui gate. V3 reorganises and completes; it does not restart.

## 4. PM additions
- A **realistic demo client** (a real Airflow DAG, a PySpark job, SQL joins) to exercise DataPass Hop end to end, like Codex Wind Lab for 1.0.
- Module split doubles as a **performance** measure (a closed module loads nothing).

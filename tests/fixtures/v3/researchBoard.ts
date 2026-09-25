/**
 * Synthetic board for project A (research library): no FOIL or client content. Shared by the unit
 * tests, the public example, the Workbench preview and the desktop fixture.
 */
import type { Board } from "../../../src/core/project/board";

export function boardAJson(): Record<string, unknown> {
  return {
    format: "datapass.board",
    version: "1",
    title: "Research library — work",
    description: "Tasks, bugs and decisions of the papers pipeline and the lab. The AI keeps this file up to date in its pull requests; cards are moved in DataPass.",
    updated: "2026-09-25",
    columns: [
      { id: "backlog", title: "Backlog" },
      { id: "todo", title: "To do" },
      { id: "doing", title: "Doing", limit: 2 },
      { id: "review", title: "Review", description: "A pull request is open, or a decision waits for you." },
      { id: "done", title: "Done", done: true }
    ],
    sprints: [
      { id: "s1", title: "First batch", start: "2026-09-21", end: "2026-10-04", goal: "100 PDFs extracted with their page numbers" },
      { id: "s2", title: "Review loop", start: "2026-10-05", end: "2026-10-18", goal: "Reviewed claims published to MongoDB" }
    ],
    milestones: [{ id: "pilot", title: "Pilot batch reviewed", due: "2026-10-31" }],
    items: [
      { id: "bug-3", type: "bug", title: "Large PDFs time out when Data Factory calls the extraction", status: "doing", priority: "P1",
        description: "Scanned PDFs of more than about 200 pages take longer than the Azure Function activity allows over HTTP (about 230 s). Seen in dev with the 2019 annual reports.",
        subproject: "papers", components: ["extract", "adf"],
        files: [{ repoRef: "pipeline", path: "functions/extract/function_app.py" }, { repoRef: "pipeline", path: "adf/pipeline/build_candidates.json" }],
        environment: "dev", sprint: "s1", due: "2026-10-02", created: "2026-09-23",
        links: ["https://github.com/example-org/research-pipeline/issues/3"] },
      { id: "task-requirements", type: "task", title: "Add requirements.txt for the extraction function", status: "todo", priority: "P1",
        components: ["extract"], files: [{ repoRef: "pipeline", path: "functions/extract/requirements.txt" }], sprint: "s1" },
      { id: "decision-staging", type: "decision", title: "Stage pages in Cosmos DB or in MongoDB Atlas?", status: "review", priority: "P2",
        components: ["cosmos"], decisionRef: "staging", sprint: "s1" },
      { id: "question-rights", type: "question", title: "Which publishers allow text extraction?", status: "todo", priority: "P2",
        subproject: "papers", components: ["pdf-archive"], due: "2026-09-30" },
      { id: "task-review-guide", type: "task", title: "Write the reviewer's checklist", status: "backlog", priority: "P3",
        components: ["review"], files: [{ path: "docs/REVIEW.md" }], milestone: "pilot" },
      { id: "feature-coverage", type: "feature", title: "Report page coverage per PDF", status: "backlog", priority: "P2",
        description: "Use the page-coverage formula of the project sheet and list the PDFs under 95 %.",
        components: ["extract", "review"], milestone: "pilot", labels: ["quality"] },
      { id: "task-lab-clone", type: "task", title: "Clone the simulation lab and validate its bundle", status: "backlog", priority: "P3",
        subproject: "lab", components: ["lab-bundle"], sprint: "s2", labels: ["lab"] },
      { id: "task-inventory", type: "task", title: "Inventory the PDFs and their reading rights", status: "done", priority: "P2",
        subproject: "papers", sprint: "s1", created: "2026-09-21", closed: "2026-09-24" }
    ]
  };
}

export function boardA(): Board {
  return boardAJson() as unknown as Board;
}

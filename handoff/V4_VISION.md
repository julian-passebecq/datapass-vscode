# DataPass V4 — vision (Julian, 2026-09-28)

> Fixed by the global PM (PM DataPass 1) from Julian's answers of 2026-09-28 evening, after his test of 1.1.0-rc.1. Product background: GPT-5.6 Sol's constellation proposal in `julian-passebecq/dataprojects`, branch `plan/datapass-v4-factory-constellation` (`handoff/2026-09-28_DATAPASS_V4_FACTORY_MASTER.md`); PM answers for the tech lead in `handoff/2026-09-28_PM_ANSWERS_FOR_CODEX.md` there. The technical architecture comes from the tech lead (**Codex**); this page only fixes the intent.

## 1. Decisions
- **First V4 product: DataPass V4 — understand a real project.** Each file's role and layer, its milestones, static data lineage (inputs → outputs), findings, and optional AI questions only where the analysis is uncertain. SQL analysis first, then Python/PySpark, then notebooks. It extends the Hop view (V3), which Julian found "makes much more sense".
- **Prototype Cloud** (compare 2–3 architectures, no provisioning) and **Factory** (a local prototype that really runs) come after DataPass V4. They are not built in parallel with it.
- **V4 starts now.** `1.1.0-rc.1` stays the working version, and the rc.1 fixes ship alongside V4.
- **The tech lead is Codex.** Coders start V4 architecture work only after its first decision records (ADRs).
- **Organisation (Claude Control V2.3):** one global PM, plus one light coordinator per active app. A sub-PM is used only for an app with more than about 3 coders at once.
- **Test gate:** before any test session Julian gets a guided tutorial with screenshots, covering where everything is and all shortcuts. It is a standing step of every release candidate.

## 2. Unchanged boundaries
Discovery never executes client code. No cloud provisioning. There is no mandatory AI, Docker or Airflow. Native provider tools are reused, not rebuilt. Private FOIL data never goes into public repositories.

## 3. Julian's V4 ideas (details in `handoff/ROADMAP.md`, "Idées de Julian")
- Preset window layouts per project step, opened from a task in Home.
- A thin icon bar on the left too, and a rethought right rail (or a top button that opens the AI menu); all configurable.
- Airflow DAG view: a shape and icon per task type, an optional horizontal layout, and a choice of where it opens. Its current UX is "pas très pratique".
- Ergonomics: a visible DataPass icon, easy code zoom, a findable theme setting, and a Home button that restores the project layout.

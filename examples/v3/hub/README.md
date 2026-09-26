# Project hub (example)

A small repository that holds, for several projects:

- `.datapass/catalog.json`: the list of projects and where their coordination repositories live. Add
  its path to the `datapass.catalogs` setting (or open it) and use *DataPass: Switch Project*.
- `.datapass/toolkit/tools.json` and `.datapass/toolkit/recipes/*.json` (DataPass 0.23, guide page 9): the toolkit
  catalogue. Tools the hub adds or corrects (links, status, when to use them, free tier and prices with
  the date they were read), recipes (step-by-step routes that name their tools), and
  `datapassRequests`: what the format cannot say yet, listed in DataPass as "Needs a newer DataPass".
  DataPass reads them after *Get updates* and layers them over its built-in baseline; nothing in
  them is run. ChatGPT updates `tools.json` through *Copy a DataPass File for the AI* → toolkit; an
  agent updates any of them through a pull request.

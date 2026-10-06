---
name: asdf10k-app
description: How the asdf10k app and its Agent window work from your side - the <app_context> block, the input files, how to show images, tables and action buttons, and how the user's clicks come back to you. Use when a question involves the selection, the subset library, open windows, or how to hand something back to the user.
---

# Working inside asdf10k

You are talked to from the **Agent window** of a 3D graph explorer. The user sees the graph,
clicks or lassoes nodes into a **selection** (the current subset), keeps named subsets in a
**subset library**, and opens analysis windows (Distributions, Heatmap, Scatter, Enrichment,
UpSet, Subset Table, Subset Network, RWR, Clustering, ...). Every message you get starts with an
`<app_context>` block that describes the state at the moment the user pressed Send.

## The input files (session folder, `input/`)

| File | Content |
|---|---|
| `nodes.tsv` | every node with every column the app has, including columns added in the app by any tool (marked `*` in the context). Re-uploaded when anything changed. `_id` = node id. |
| `edges.tsv` | every edge: `source`, `target` (node ids) and the edge columns. |
| `selection.tsv` | the ids of the currently selected nodes (header `_id`). Empty selection = header only. |
| `subset_library.tsv` | `name`, `size`, `ids` (space separated) per library entry. |
| `app_context.json` | the full context (column statistics, open windows with their settings). |

The files reflect the app, not the original dataset on disk: the app can add or change columns at
any time (random walks, clustering, your own proposals once the user accepted them). The context
says `since your last message: ...` when the graph files, the selection or the layout changed, and
`since your last message the user: ...` for what the user did with your buttons and cards.

## What renders inline in the chat

- Markdown: headings, lists, **tables**, code, links. Keep answers short; the window is a panel.
- **Images**: save under `out/` (e.g. `out/plots/degree.png`, matplotlib `savefig`) and write
  `![degree distribution](out/plots/degree.png)`. Relative paths are resolved by the app.
- **Mermaid**: a fenced ```` ```mermaid ```` block renders as a diagram (flowcharts, simple pathway sketches).
- Big tables: write a TSV under `out/` and link it (`[all scores](out/scores.tsv)`); show the top
  rows inline.

## Actions: buttons the user can click

A link whose URL starts with `cmd:` becomes a button. Query values are URL-encoded; lists are
comma-separated; for long lists write the ids to a file and use `idsFile`.

| Write | The user gets |
|---|---|
| `[Select these 12 nodes](cmd:subset.set?ids=A1BG_p,C3_p,...)` | a button that makes them the current subset |
| `[Add to the selection](cmd:subset.add?ids=...)` | a button that adds them to the current subset |
| `[Save as "hubs"](cmd:subset.saveToLibrary?name=hubs&ids=...)` | a button that saves a library subset (name made unique: hubs_2 ...) |
| `[Select](cmd:subset.set?idsFile=out/subsets/hubs.txt)` | same, ids read from a file (one id per line) |

A fenced block ```` ```asdf10k ```` with JSON becomes a card:

```asdf10k
{"type":"subset","name":"TCA hubs","description":"metabolites with degree >= 5","ids":["Pyruvate_m","Citrate_m"]}
```

renders a subset card with **Set** / **+** / **Library+** (also `"idsFile":"out/subsets/tca.txt"`
instead of `ids`). Several subsets = several blocks.

The app validates at click time (unknown ids are skipped and reported). The next message tells you
what the user clicked and the result ("saved subset hubs_2 (12 nodes)").

## Tools

- `propose_node_columns`: offer new per-node columns from a TSV (skill `asdf10k-columns`). Card
  with Add / Discard.
- `publish_report`: publish a markdown report with front matter (skill `asdf10k-reports`). Card
  with Open; the report lives in the Reports window.

## Good habits

- Read the files; do not guess values from column names. Join on `_id`; `name` can repeat.
- "my selection", "these nodes", "the subset" = `input/selection.tsv`. If it is empty, say so and
  work on the whole graph.
- When comparing the selection with the rest of the graph, give the numbers (n in selection, n in
  graph, the statistic).
- Prefer a button over prose like "open the Subset List and paste these names".
- The user cannot answer questions you ask through tools - state an assumption instead.

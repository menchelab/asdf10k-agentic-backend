---
name: asdf10k-app
description: How the asdf10k app and its Agent window work from your side - the <app_context> block, the input files, what the user sees of your work, and what happens with results. Use when a question involves the selection, the subset library, open windows, or how to hand something back to the user.
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
says `since your last message: ...` when the graph files, the selection or the layout changed.

## What the user sees

- Your text, streamed, as markdown. Tool calls appear as collapsible steps; a to-do list (task
  tools) is shown while you work. Keep answers short; the window is a panel, not a document.
- Files you write under `out/` can be downloaded later; images and tables get cards once the
  `show_image` / `show_table` tools exist. Mention the path until then.
- The user cannot answer questions you ask through tools - state an assumption instead.

## Selection and subsets

- "my selection", "these nodes", "the subset" = `input/selection.tsv`. If it is empty, say so and
  work on the whole graph or ask the user to select something (in text).
- Library subsets are named node lists; refer to them by name.
- When you find a set of nodes worth looking at (a cluster, the top hits, nodes matching a
  finding), say which ids they are; later a `propose_subsets` tool will show them as a card with
  buttons.

## Good habits

- Read the files; do not guess values from column names.
- Join on `_id`; `name` can repeat.
- When comparing the selection with the rest of the graph, say the numbers (n in selection, n in
  graph, the statistic).
- Prefer pandas one-liners over long scripts; write scripts to `out/` only when the user wants to
  rerun them.

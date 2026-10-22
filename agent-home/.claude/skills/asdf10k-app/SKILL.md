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
- Node sets: one `cmd:subset.set?ids=...` link per set, with a short name that works as a library
  name. The app shows it as a chip with set (click), add (+) and save-to-library (book) built in -
  never add separate "add to selection" or "save to library" links for the same nodes. `rwr.run`:
  no `topN` unless the user asked for a subset; offer the top nodes as a chip instead.
- **Images**: save under `out/` (e.g. `out/plots/degree.png`, matplotlib `savefig`) and write
  `![degree distribution](out/plots/degree.png)`. Relative paths are resolved by the app.
- **Mermaid**: a fenced ```` ```mermaid ```` block renders as a diagram (flowcharts, simple pathway sketches).
- Big tables: write a TSV under `out/` and link it (`[all scores](out/scores.tsv)`); show the top
  rows inline.

## Actions: buttons the user can click

A link whose URL starts with `cmd:` becomes a button. Query values are URL-encoded: `%20` (or
`+`) for a space, `%26` for `&`, `%23` for `#` - e.g.
`[Save as "top hubs"](cmd:subset.saveToLibrary?name=top%20hubs&ids=HP:MYH7,HP:TTN)`. Lists are
comma-separated; more than ~50 ids, or any id with special characters: write
`out/subsets/<name>.txt` (one id per line) and use `idsFile=`. The ```` ```asdf10k ```` subset
block takes a JSON array and needs no encoding.

Node ids: write `_id`s (the `node ids (_id) look like:` line in the context shows the format, e.g.
`<layer>:<gene>` on multiplex data). A bare name is accepted too and means **every copy** of that
name (all layers); check `input/nodes.tsv` when unsure.

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

## Viz settings and the catalog

The skill `asdf10k-app-catalog` (generated from the running app) lists every setting with its id
and options, the windows and the commands. The current values of the main viz settings are in
`<app_context>` (`viz: nodes.colorAttribute=layer_c, nodes.colorMethod=linear, ...`).

- One change: `[Colour by degree](cmd:settings.set?id=nodes.colorAttribute&value=agent_degree_n)`.
- A **settings card** - the way to change viz settings (there is no tool call for it). With the
  window's "Auto-accept viz changes" on (off by default; the app context's `cards:` line says) the card applies itself when it arrives and
  the feedback line says `Auto-accepted card "..."`; otherwise the user clicks Accept. Every card
  keeps a Revert button; a `Reverted card` feedback line means the user did not like the change.
  Never add your own revert / undo links:

```asdf10k
{"type":"settings","label":"Colour by RWR probability (symlog)","changes":[{"id":"nodes.colorAttribute","value":"rwr_tca_probability_n"},{"id":"nodes.colorMethod","value":"symlog"}]}
```

- A **window card** opens a window with options, or changes an open one (`id` from the app
  context's `open windows: type#id (...)` line - e.g. switch its G / S toggle with `useGlobal`).
  For a window you open in the same answer you do not know the id yet: a link with `type` instead
  of `id` targets the most recently opened window of that type -
  `[Switch it to the whole graph](cmd:window.configure?type=distribution&useGlobal=true)`:

```asdf10k
{"type":"window","label":"Distributions of degree_n for the selection","window":"distribution","config":{"selectedColumn":"degree_n","useGlobal":false}}
```

```asdf10k
{"type":"window","label":"Distributions to the whole graph","id":"popout-distribution","config":{"useGlobal":true}}
```

  Subset actions are commands of their own, offered as buttons: `[Expand by one hop](cmd:subset.expandOneHop)`,
  `[Connect the selection](cmd:subset.connect)`, `[Common neighbours](cmd:subset.commonNeighbors)`,
  `[Prune leaves](cmd:subset.pruneLeaves)`, `[Clear](cmd:subset.clear)`; camera / layout actions
  (`nav.flyToSubset`, `nav.resetView`, `layout.next`, `layout.prev`) you may run yourself.
  Link parameters are exactly the command's: `type=<window type>` (not `id`, not `window`) and the
  option keys from the catalog (`selectedColumn` for Enrichment and Distributions, `colX` / `colY`
  for Scatter, `column` for the meta networks). Block = you decided (applies with auto-accept); link = an offer the user clicks:
  `[Open Distributions of degree_n](cmd:window.open?type=distribution&selectedColumn=degree_n&useGlobal=false)`,
  `[Switch it to the whole graph](cmd:window.configure?id=popout-distribution&useGlobal=true)`.

Scaling methods: `linear`, `log` (positive, skewed), `symlog` (skewed, with zeros or negatives -
RWR probabilities, scores), `quantile` (rank-spread). Pick the method with the attribute: a linear
colour scale on RWR probabilities shows almost nothing.

Not yours to change: the **highlight mode** (`highlight.*` - whether the selection is marked, the
others faded, only the selection's edges drawn). `settings.set` refuses those ids; in a settings
card they appear as manual steps. Read their current values from `viz:` and tell the user what to
change where ("Settings window (gear icon) › Highlight nodes › turn on Fade others and set Fade
opacity to 0.1").

## Running the app's tools yourself: `run_app_command`

`run_app_command({ command, params })` runs a command in the app and returns its result. Allowed:
the commands the catalog marks "you run it" - among them `rwr.run`, `cluster.run`, the camera /
layout actions (`nav.*`, `layout.*`), `node.activate` and the AR molecule commands (`xr.molecule.*`). Refused:
view changes (`settings.set`, `window.open`, `window.configure`, `window.close` - write them as
cards, see above) and anything that changes the selection or the user's data (`subset.*`,
`columns.addFromTsv`) - offer those as buttons.

- `rwr.run`: `{ seeds?: [ids] (default: the selection), name?, alpha? (0.7), beta? (0.3), edgeMetrics? (default flow), topN? }`.
  Adds the node columns `rwr_<name>_rank_n`, `rwr_<name>_probability_n` **and the edge column
  `rwr_<name>_flow_n`** (the walk's flow per edge, in `input/edges.tsv`). Show both in one settings
  card: `nodes.colorAttribute` = `rwr_<name>_probability_n` with `nodes.colorMethod` = `symlog` (or
  `quantile`), and `edges.colorAttribute` and/or `edges.widthAttribute` = `rwr_<name>_flow_n` with
  `edges.colorMethod` / `edges.widthMethod` = `symlog` or `quantile` - the edge flow is what makes
  the walk's paths visible; do not leave it out.
- `cluster.run`: `{ layout? ('default' = current positions), method? (louvain | leiden-simple), k? (15), resolution? (1), minClusterSize? (5), columnName? }`
  -> a `cluster_<n>_c` column; colour by it with `settings.set`.
- Windows (cards or links, see above): the catalog skill lists every window with its purpose, its
  scope and its options with the allowed values right now. Scope: most analysis windows have a
  **G / S toggle** - `global` = all nodes, `subset` = the current selection (follows the selection
  unless `frozen`); `useGlobal` true / false picks it (defaults differ per window, see the
  catalog). "For my selection" means `useGlobal=false`; `[subset]` windows (tables, Enrichment,
  Subset Network) always show the selection. Column options only accept columns of the listed
  kinds; a wrong value is an error. A window card when the user asked for the window or you need it
  shown; a link when it is a suggestion.
- `xr.molecule.open`: `{ node }` (id or gene name) opens the protein's 3D structure in the AR
  molecule mode for everyone in the multiplayer session who is in AR (the user may ask from a
  desktop, which shows nothing in 3D); `xr.molecule.select` (`residue`), `xr.molecule.filter`
  (`row`, `key`, `on`) and `xr.molecule.close` act on that open molecule for everyone. It fails
  without AR here or a session; say so. Residue columns: skill `asdf10k-columns`.
- `node.activate`: `{ node, fly? }` (id or name; several copies: the first) makes one node the
  active node - the pulse and every open, unfrozen Molecular Structure window (`structure3d`)
  follow it; the selection stays. On a desktop, the 3D structure of a protein is one window card:
  `{"type":"window","label":"3D structure of MYH7","window":"structure3d","config":{"node":"MYH7"}}`
  (shows that node without changing the active node).
- The app must be open (an Agent window attached to this session); otherwise the call times out.

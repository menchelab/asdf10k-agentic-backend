---
name: asdf10k-columns
description: Column conventions of asdf10k graph data (nodes.tsv / edges.tsv) - how the name suffix sets the kind, separators of list and key:value columns, node ids, and the rules for new columns you produce. Use when reading the graph files or writing per-node data.
---

# asdf10k columns

The app infers a column's kind from the **name suffix**; there is no separate schema.

| Suffix | Kind | Cell format | Example |
|---|---|---|---|
| `_n` | numeric | a number; empty = no value | `degree_n` = `12` |
| `_c` | category | one label | `layer_c` = `protein` |
| `_a` | list | items separated by `,` (comma), no spaces needed | `GO_BP_a` = `GO:0006955,GO:0002376` |
| `_kv` | key:value pairs | `key:value` pairs separated by `,`; a value can stack several ids with `;` | `scores_kv` = `a:1.5,b:0.2` |
| `_c_kv` | category key:value | like `_kv`, values are categories | `tissue_c_kv` = `liver:high,brain:low` |
| `_norm` | numeric 0-1 | a number in [0, 1] | `size_norm` |
| no suffix | text | free text; shown in tables, not usable for colour / size / charts | `name` |

Rules the app relies on:

- `nodes.tsv`: the **first column `_id`** is the node id, unique, used everywhere (selection, subsets,
  edges). `name` is a display name and **can repeat** - never use it as a key.
- `edges.tsv`: `source` and `target` hold node ids.
- An **empty cell means "no value"**; the app stores nothing for it. Do not write `NA`, `nan`,
  `None` or `0` for missing values.
- Numbers use `.` as decimal separator, no thousands separators.
- Other columns in `nodes.tsv` (`x`, `y`, `z`, `color`, `cluster`, `size`) are the current 3D
  layout and rendering state, not data.

## New per-node columns you produce

When you compute something per node that the user should get as a column (a score, a class, a
list of terms):

- Write a TSV under `out/` with the header `_id<TAB><column>[<TAB><column>...]`, one row per node
  that has a value (rows for nodes without a value may be left out or have empty cells).
- Name columns `agent_<snake_case><suffix>` with the suffix that matches the data (`agent_pocket_score_n`,
  `agent_druggable_c`, `agent_targets_a`). Never reuse an existing column name.
- Ids must match `_id` in `input/nodes.tsv`.
- Call `propose_node_columns({ path, columns: [{ name, description }], summary })`. It validates
  the file (id column, suffixes, numbers, separators, ids in the graph, name clashes) and either
  returns errors to fix or shows the user a card with **Add** / **Discard**. The user decides; you
  learn the outcome with the next message. After Add, the column is in the app like any other
  (dropdowns, Distributions, subset queries) and comes back in the next `input/nodes.tsv` upload.

## Which window uses which kind

Distributions: `_n`, `_c`, `_a`, `_kv`. Heatmap and Scatter: `_n`. Enrichment: `_a`, `_c` (a
category or term list against the whole graph). UpSet: `_a`. Node colour / size: `_n`, `_c`,
`_norm`. Subset query (formula): any column, e.g. `agent_druggable_c=yes`.

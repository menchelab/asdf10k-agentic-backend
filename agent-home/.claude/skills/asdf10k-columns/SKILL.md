---
name: asdf10k-columns
description: Column conventions of asdf10k graph data (nodes.tsv / edges.tsv) - how the name suffix sets the kind, separators of list and key:value columns, node ids, columns with a special meaning (layouts, residue / ClinVar columns for the 3D structure), and the rules for new columns you produce. Use when reading the graph files or writing per-node data.
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

## Columns with a special meaning

Some columns are read by name, or by a name the dataset's `config.json` sets (the dataset author's
file; you do not change it):

| Column | Meaning |
|---|---|
| `x_<name>`, `y_<name>`, `z_<name>` | the extra layouts (`<name>` is the layout name), next to the base `x` / `y` / `z` |
| `subsets_a` | the subset list library's tags per node |
| `name` (usually) | the id the tooltips and the 3D structure look up at UniProt / AlphaFold (gene symbol or accession): `config.json` `tooltipFetchIdAttribute` and `window_molecular.fetchIdColumn` |
| `hl3d` (or `3dhl`, `phosphosites`) | residues to highlight on the protein's AlphaFold structure: `R403,G741` (letter + position on the UniProt canonical sequence) or plain positions `701,18`. `config.json` `window_molecular.highlightColumn` names another column |
| `clinvar_residue_types` | per residue the variant types, `K670:inversion,I716:SNV\|indel` (`\|` between several); other name via `window_molecular.residueTypesColumn` |
| `clinvar_residue_consequences` | per residue the consequences (missense, nonsense, frameshift, start-loss, in-frame ...), same format; other name via `window_molecular.residueConsequencesColumn` |
| `clinvar_pathogenic_residues_n`, `clinvar_structure_residues_n` | counts of those residues per gene |

The residue columns feed the 3D structure window (highlighted residues on the cartoon) and, in AR,
the molecule mode: the structure opens at the node with the residues as markers and a residue
list the user filters by consequence and variant type. Residue positions refer to the UniProt
canonical sequence, the one AlphaFold models; a residue beyond the model is listed but has no
marker. Very long proteins (TTN) have no single AlphaFold model. When you talk about residues, use
the same `R403` notation, and read these columns rather than guessing variants.

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

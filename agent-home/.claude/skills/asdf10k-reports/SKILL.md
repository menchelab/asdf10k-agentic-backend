---
name: asdf10k-reports
description: How to write and publish a report for asdf10k users - when a report instead of an inline answer, the front matter (title, summary, nodes with roles), the body template, images, actions, and the publish_report tool. Use when an answer grows beyond a screen, has several figures or tables, or the user asks for a report.
---

# Reports

A report is a markdown file in the session folder that you publish with `publish_report`. The
user sees a card (title, summary, node count, **Open**) in the chat; the report opens in its own
window, is listed in the Reports window, and can later be shown as a node in the 3D graph connected
to the nodes it is about.

## When a report, when inline

- **Inline** (plain chat answer): fits on one screen, at most one figure, no need to keep it.
- **Report**: longer than a screen, several figures or tables, a method worth keeping, or the user
  asks ("make this a report", "write up ..."). Then keep the chat answer to two or three lines
  plus the card.

## File

Write `out/reports/<slug>.md` (slug = short, lowercase, dashes). Images go to `out/plots/`;
reference them relative to the report file (`../plots/x.png`) or to the session root
(`out/plots/x.png`) - both work. Then call `publish_report` with the path. Publishing the same
file again replaces the report.

## Front matter (required)

```yaml
---
title: Metabolite cluster bridging into complement via CR1
summary: >
  25 differentially expressed TCA-cycle metabolites form one cluster; CR1 is the only bridge
  to the complement proteins. Degree is not different from the rest of the graph (p = 0.4).
nodes:
  - { id: CR1_p, role: subject }
  - { id: C3_p, role: evidence }
  - { id: Pyruvate_m, role: candidate }
  - { id: FCN3_p, role: context }
tags: [metabolism, complement]
---
```

- `title`: one line. `summary`: two or three sentences, the finding first - it is what the card
  shows.
- `nodes`: the nodes the report is about, by `_id`, each with exactly one role:
  - `subject` - what the report is about (the cluster, the hub, the candidate list),
  - `evidence` - supports the finding (the bridge node, the enriched members),
  - `candidate` - suggested follow-up (worth checking, not yet shown),
  - `context` - mentioned for orientation.
  List every node that matters, not every node in the graph; 3 to 50 is typical. These nodes
  place the report in the 3D graph later and colour its edges by role.
- `tags`: optional short words for the Reports list.

## Body template

```markdown
# <title>

## Summary
Two or three sentences (may repeat the front matter summary).

## Nodes
A short table: id, name, role, the key number. Or a subset card the user can select:
```asdf10k
{"type":"subset","name":"<short name>","description":"<what they are>","ids":["...","..."]}
```

## Method
What was computed on which files and columns, with the numbers (n, statistic, p).

## Figures
![caption](../plots/x.png) - one line of what to see in it.

## Reproduce
The script (short) or the commands; data files under out/ as links.
```

Keep it readable in a narrow panel: short paragraphs, small tables, no wide code. Buttons work in
reports like in the chat (`[Select the subject nodes](cmd:subset.set?ids=...)`); mermaid blocks
render as diagrams.

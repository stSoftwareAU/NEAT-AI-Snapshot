# Compaction audit (issue #56)

Stage 4L of the family-wide compaction migration
([NEAT-AI-core#775](https://github.com/stSoftwareAU/NEAT-AI-core/issues/775))
asks each repository to replace its own whole-creature compaction with the
shared Rust engine. Repositories that do not compact are audited only and must
not acquire new runtime compaction.

## Finding

NEAT-AI-Snapshot performs no compaction and has no snapshot, restore or
creature serialisation code to migrate. It owns no runtime at all: it stores
`docs/snapshot.json.gz` and publishes `docs/` to GitHub Pages unchanged.
Whatever compaction a creature has undergone happens in the producer,
NEAT-AI-Discovery, whose migration is stage 4F
([NEAT-AI-Discovery#2586](https://github.com/stSoftwareAU/NEAT-AI-Discovery/issues/2586)).

Do not add a compaction call, adapter or dependency pin here: there is no path
that compacts today, so any such call would be new compaction on a previously
uncompacted path.

## Evidence

Audited at `bf8eb54` on `Develop`.

- **No executable code.** `git ls-files` lists workflow YAML, Markdown,
  `docs/index.html`, `docs/Tooltips.json`, `docs/snapshot.json.gz`, `LICENSE`
  and lint/git config. There is no `.ts`, `.js`, `.rs`, `.py` or shell source,
  and no `deno.json`, `package.json` or `Cargo.toml`.
- **`docs/index.html`** has no script; it only links to `snapshot.json.gz`.
- **Workflows.** `pages.yml` uploads `docs/` unchanged with
  `actions/upload-pages-artifact`. `dependency-review`, `gitleaks`,
  `markdown-lint` and `semgrep` only scan or lint. None reads or rewrites a
  creature.
- **Search.** `grep -rniE 'compact|prun|simplif'` over `.github/`,
  `docs/*.html`, `docs/Tooltips.json` and `README.md` finds nothing.

## Serialised creature compatibility

The committed snapshot decompresses and parses as JSON with top-level sections
`meta`, `creature`, `recording`, `derived` and `tooltips`. At `bf8eb54` its
`creature` section held 10,490 neurons (10,486 hidden, 3 constant, 1 output)
and 67,408 synapses, with `input` 2,511 and `output` 1. Every neuron UUID was
unique, every synapse endpoint other than an `input-N` reference named a
neuron in the list, and no synapse targeted an input. This audit changes
neither the file nor the publishing workflow, so downstream readers such as
NEAT-AI-Explore receive the same bytes, and score semantics are untouched.

The snapshot is replaced by the Discovery job each day, so these counts
describe the audited commit, not every later snapshot.

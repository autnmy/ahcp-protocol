# Repository Audit — Protocol Rebrand & Documentation Maturation

**Date:** 2026-06-20 · **Scope (as run):** the original brand rebrand + docs maturation, with **zero
protocol/semantic change** (no version bump). This report enumerates everything that should be **removed,
rewritten, relocated, renamed, or frozen**, with `file:line` references and a disposition for each.

Legend: **RENAME** = brand prose → the new name · **REMOVE** = delete (internal/contradictory) ·
**RELOCATE** = move to a more appropriate doc · **REWRITE** = reshape tone/content · **FREEZE** = must not
change · **FLAG** = needs out-of-band action (e.g. binary asset).

> **Historical artifact — read the lineage first.** This audit was written for the **original** rebrand,
> **A2H → AHCP**, which deliberately *froze* the `a2h` wire/distribution slug (see §4). Two later decisions,
> both made because the protocol had **no external adopters**, superseded that: (1) the `a2h` identity was
> flipped in full to `ahcp` (wire identifiers, schema `$id` domain, distribution names; vectors re-signed),
> and then (2) the whole protocol was **renamed again to MA2H — Multi-agent to Human Protocol** when `AHCP`
> was found to collide with an existing protocol. The end state is uniformly **`ma2h`**. Token references in
> the body below have been mechanically updated to the `ma2h` end-state, but the dated specifics (the §4
> "frozen" table, the re-mint note, the §7 result) describe the **original** rebrand, not the final one. For
> the authoritative end-state and the full A2H → AHCP → MA2H identifier map, see
> [MIGRATION.md](../MIGRATION.md) and the `CHANGELOG`.

---

## 1. Internal-founder, commercial & brainstorming language

Content that reads as internal notes or product marketing rather than protocol documentation.

| Location | Content | Disposition |
|----------|---------|-------------|
| `README.md:94–103` | `## Name (locked)` — rejected-name brainstorming ("HAI / AHI 'oh hai'", Stanford HAI collision, "the meme framing undercuts the gravitas", "Loop collides with Microsoft Loop"). | **REMOVE.** Now self-contradictory after the rename. Replace with a 2–3 line neutral "Name" note. |
| `README.md:82` | "Autonomy authors the standard *and* sells the best implementation of it." | **REMOVE** from README (commercial voice). The governance/product split is already documented neutrally in `GOVERNANCE.md §2`. |
| `README.md:75–83` | "Protocol vs. product — a deliberate split" table + "the product is unambiguously commercial." | **REMOVE** from README; **already covered** by `GOVERNANCE.md §2` and `NOTICE`. Replace with a one-line stewardship pointer to `GOVERNANCE.md`. |
| `README.md:85–92` | "Path to 'official'" four-step go-to-market roadmap + "Adoption first, governance second — the proven order." | **REMOVE** from README (strategy/roadmap, not protocol doc). The donate-to-foundation intent is already in `GOVERNANCE.md §1` and `NOTICE`. |
| `README.md:22–26` | "As of mid-2026 there is **no open, adoptable protocol**…" naming competitors (PagerDuty SRE Agent, Salesforce Agent Fabric, HumanLayer, Microsoft Agent Framework). | **REWRITE** to neutral prior-art/"why this exists" framing. Keep the substantive gap analysis; drop the competitive tone and time-stamped "as of mid-2026". |
| `docs/plans/*.md` | Internal planning docs with first-person "Key finding" notes. | **KEEP.** These are legitimate, dated planning artifacts under `docs/plans/`, not public protocol docs. Out of rebrand scope except incidental brand mentions (low priority). |

---

## 2. Version drift (documentation accuracy)

| Location | Content | Disposition |
|----------|---------|-------------|
| `README.md:3` | `**Version:** 0.2` | **REWRITE → 0.3.** `CHANGELOG.md` shows `0.3 (2026-06-12) — Draft` is current (merges #7–#10). Status stays **Draft**. |
| `README.md:47,54` | "spec/v0.2.md … (current)" and provenance link to `spec/v0.2.md §11`. | **REWRITE → spec/v0.3.md.** v0.3 is the current draft; provenance moved to §11 of v0.3. |
| `index.html:258` | "the normative v0.2 specification" + link to `spec/v0.2.md`. | **REWRITE → v0.3.** |
| `README.md:56–61` | Repo-layout block points at `schema/v0.2/`. | **REWRITE → schema/v0.3/** (current), or list both with v0.3 marked current. |
| `reference/README.md:4` | Current-spec link targets `../spec/v0.2.md` while the reference implementation is `@a2h/reference@0.3.0` (v0.3 behavior). | **REWRITE → ../spec/v0.3.md.** The reference impl is v0.3, so this pointer was genuinely stale. |

**Plugin skill templates migrated v0.2 → v0.3 (scope expansion, approved during PR review).** The
plugin skill templates (`plugins/a2h-skills/skills/*/SKILL.md`) previously emitted `a2h_version: "0.2"`
and linked the v0.2 spec/schema. Because v0.3 is current **and** a v0.3 Hub rejects pre-0.3 **push**
callbacks (`version_not_supported`, §10), following these templates with a push callback against a
current Hub broke ask/task flows — a real functional issue (raised by Codex review on the PR, confirmed
against `version-negotiation.test.ts`). With explicit approval the templates were migrated to v0.3:
`a2h_version: "0.3"`, v0.3 spec/schema links, and the push verification guidance now recomputes
`payload_sha256` and reconstructs the 10-field `signed_context` per the v0.3 §9.2 payload-binding (the
breaking signature change). This is a **behavioral** change beyond the naming-only rebrand, made
deliberately to keep the tooling correct against the current protocol.

No `a2h_version` value, schema, or normative content is changed by these fixes — they correct stale
pointers only.

---

## 3. Brand-rename inventory (RENAME — by surface)

Apply the rename map from `MIGRATION.md`: `A2H` → `MA2H`, `Agent-to-Human Protocol` →
`Multi-agent to Human Protocol`. Counts are brand-token occurrences (excluding frozen identifiers).

| Surface | Files | Notes |
|---------|-------|-------|
| README | `README.md` | Title, pitch, family diagram line, prose. |
| Website | `index.html`, `favicon.svg` | Visible copy + `<title>`/meta/OG/Twitter/JSON-LD `name`/`description`. CLI demo tokens and URLs FROZEN (§4). |
| Spec | `spec/v0.3.md` (full), `spec/v0.2.md`, `spec/v0.1.md` (cosmetic) | Title/headings/prose only; all wire identifiers FROZEN. |
| Root docs | `CONTRIBUTING.md`, `GOVERNANCE.md`, `NOTICE`, `CHANGELOG.md` | Brand prose; keep legal/governance substance. |
| GitHub templates | `.github/PULL_REQUEST_TEMPLATE.md`, `.github/ISSUE_TEMPLATE/spec-change-proposal.md` | Brand prose. |
| Sub-READMEs | `conformance/README.md`, `reference/README.md`, `plugins/a2h-skills/README.md` | Brand prose; package/CLI/plugin tokens FROZEN. |
| Example prose | `examples/callback-anti-pattern.md`, `examples/response-signature-v0.3.md` | Markdown prose only; **no JSON example values change**. |
| Schemas | `schema/v0.1|v0.2|v0.3/*.json` | `title`/`description` string values only; `$id`/properties FROZEN. |
| Reference impl | `reference/src/*.ts`, `reference/bin/a2h.ts`, `reference/demo/playground.ts` | User-facing strings/comments only; identifiers/imports/CLI name FROZEN. |
| Plugin manifests | `plugins/a2h-skills/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `plugins/a2h-skills/skills/**/SKILL.md` | `description`/keywords prose; plugin `name`/marketplace/install tokens FROZEN. |

---

## 4. Frozen identifiers (FREEZE — must NOT change)

Changing any of these is a breaking change / version bump, forbidden by the rename's constraints.
Baseline counts captured 2026-06-20 (repo-wide, incl. docs/plans).

| Token | Kind | Baseline count |
|-------|------|---------------:|
| `a2h_version` | message field (wire) | 126 |
| `A2H-Signature` | HTTP header (§9.2) | 34 |
| `A2H_CALLBACK_SECRET` | env var (§8.3) | 15 |
| `/.well-known/a2h` | discovery path (§8.0) | 25 |
| `x-a2h-sensitive` | schema extension field | 22 |
| `a2hprotocol.org` → `ma2h.org` | schema `$id` domain + canonical URL (frozen during the rebrand; **re-minted post-rebrand** — see note) | 63 |
| `autnmy/a2h-protocol` | GitHub repo slug + URLs | 37 |
| `@a2h/reference` | npm package | 8 |
| `a2h-skills` | plugin name + path + namespace | 26 |
| `a2h` (CLI binary, `~/a2h` prompt) | reference CLI + website demo | n/a |

The website's terminal demo commands (`a2h about`, `a2h verbs`, `a2h docs`, `a2h rules`, `a2h skills`,
`a2h run-vectors`) mirror the real CLI and are **frozen** — the site is branded MA2H but demonstrates
the `a2h` CLI verbatim. This brand↔CLI split is intentional (see `MIGRATION.md`).

> **Domain re-mint (post-rebrand).** The naming rebrand froze the domain at `a2hprotocol.org` (the row
> above). It was later migrated in two hops — first to `ahcpprotocol.org`, then (with the MA2H rename) to
> the final **`ma2h.org`** — moving the website, the schema `$id`s, the reference `BASE`, and the
> spec/schema links together. Per `CONTRIBUTING.md` each is a breaking `$id` change, permitted pre-1.0 with
> no adopters and verified by the reference suite (56/0). The signature *algorithm* is unchanged, but the
> full identity flip renamed the wire tokens too (the version field `a2h_version` → … → `ma2h_version`, the
> header, env var, discovery path, sensitive-field extension, state-seal magic) and the distribution names
> (npm / CLI / plugin / repo) — so the conformance vectors were re-signed. See `MIGRATION.md` for the full
> A2H → AHCP → MA2H map and the `CHANGELOG`.

---

## 5. Assets requiring out-of-band action

| Asset | Issue | Disposition |
|-------|-------|-------------|
| `og.png` | Binary social-card image previously rendered with the "A2H" wordmark. | **REGENERATED.** Replaced (1200×630) with an MA2H card matching the original terminal design — wordmark "MA2H" (H accented), updated title bar/diagram; frozen tokens (`~/a2h`, `a2h about`, `ma2h.org`) preserved. Rendered from HTML for pixel-accurate text. |
| `favicon.svg` | Contains one `A2H` text token. | **RENAME** (text edit, in scope — U4). |

---

## 6. New deliverable documents created by this rebrand

| File | Deliverable |
|------|-------------|
| `MIGRATION.md` | (6) Migration guide + naming dictionary. |
| `docs/ma2h-rebrand-audit.md` | (1) This audit report. |
| `docs/documentation-structure.md` | (4) Suggested documentation structure. |
| `docs/spec-improvement-recommendations.md` | (5) Spec improvement recommendations (advisory). |

---

## 7. Verification result (filled at U9)

The rebrand is correct iff, after all edits:

1. **Frozen-token counts are invariant** vs. the §4 baseline.
2. **Reference test suite is green** (`cd reference && npm test`) — baseline: **56 pass / 0 fail**.
3. **`git diff` on `schema/` and `conformance/`** shows only `title`/`description` string changes
   (or empty for vectors) — no `$id`, property, field, header, or path change.
4. **Brand grep** (`grep -rnE 'A2H|Agent-to-Human'`) returns only frozen identifiers.

> **Result (2026-06-20):** PASS. Frozen-token counts unchanged vs. baseline; reference suite **56 pass /
> 0 fail**; `schema/` and `conformance/` diffs limited to `title`/`description` strings (vectors
> untouched); brand grep returns only frozen identifiers (`A2H-Signature`, `A2H_CALLBACK_SECRET`,
> `.well-known/a2h`, `a2h_version`, `@a2h`, `a2h-skills`, `ma2h.org`, `autnmy/a2h-protocol`).
> `og.png` was regenerated (1200×630 MA2H card, rendered from HTML) in response to PR review.

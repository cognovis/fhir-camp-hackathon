# 1. A chosen treatment alternative stays `draft`

Status: accepted (2026-11-06, issue #6)

## Context

A treatment and cost plan (HKP) has several alternatives, each a `CarePlan` with profile
`dental-care-plan`. The seed data marks the chosen alternative with `intent = plan` and the
others with `intent = option`; all of them have `status = draft`. Task 2 asks what happens to
the chosen plan's `status` when the user chooses one.

In the HKP workflow the choice comes before two further steps: the patient signs the plan,
and the insurer pre-authorizes it (task 6, `Claim` with `use = preauthorization`). Treatment
starts only after both.

## Decision

Choosing an alternative changes only `intent`: the chosen one gets `plan`, every other draft
alternative of the patient goes back to `option`. `status` stays `draft`.

`status` becomes `active` later, when the patient has agreed to the plan (and, where needed,
the insurer has approved it). That step is not part of the choice and not built yet. Plans that
are no longer `draft` (`active`, `completed`) cannot be chosen and are not changed by a choice.

All intent changes of one choice are written in one transaction, each with the version it was
read at (`If-Match`), so a choice either applies completely or not at all.

## Consequences

- The choice matches the seeded state (`intent = plan`, `status = draft`), so code that reads
  the seeded alternatives (planned charges, cost plans) treats a chosen new alternative the
  same way.
- "Chosen" and "agreed" stay distinguishable: a patient can change their mind until they sign.
- A later step that records consent must set `status = active` on the chosen plan.

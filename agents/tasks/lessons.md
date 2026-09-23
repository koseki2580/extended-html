# Lessons

## Validate destructive targets before mutating

- **What happened:** A staging safety test passed the repository root to a function that removed its destination before validating it.
- **Rule:** Validate every destructive target and its overlap with protected paths before the first filesystem mutation.
- **Why:** A guard tested through the unsafe implementation can destroy the data it is meant to protect.
- **Apply-when:** Implementing cleanup, staging, replacement, or recursive removal helpers.

## Escape script text, not HTML closing tags

- **What happened:** A generated review page wrote `<\\/script>` as the external script element's closing tag, causing the browser to parse the following HTML as JavaScript text.
- **Rule:** Escape closing-script sequences only inside inlined JavaScript content; emit literal `</script>` for actual HTML element boundaries.
- **Why:** HTML parsers do not recognize `<\\/script>` as an end tag.
- **Apply-when:** Generating self-contained HTML that combines external scripts with inlined JavaScript.

## Keep planning artifacts out of product history when requested

- **What happened:** The initial workflow assumed the approved design specification should be committed.
- **Rule:** When the user says design specifications need not be committed, keep plans in ignored task paths and commit only product documentation.
- **Why:** Internal workflow artifacts should not become repository deliverables without the maintainer's intent.
- **Apply-when:** Starting a new repository or preparing design and implementation plans.

## Preserve event-handler attribute names when bridging to properties

- **What happened:** `onopen` was initially mapped to `element.open`, replacing the public method instead of the `onopen` property.
- **Rule:** Map an `on<event>` attribute to the full `on<event>` property; derive the bare event name only for dispatch and listener registration.
- **Why:** Attribute names and method names can collide even when their underlying event names appear related.
- **Apply-when:** Implementing declarative event handlers on custom elements.

## Check idempotent state before unrelated validation

- **What happened:** A repeated `open()` validated newly invalid retry configuration before noticing an already active socket.
- **Rule:** When a public operation promises to be idempotent in the current state, return for that state before validating inputs that will not be used.
- **Why:** Otherwise irrelevant configuration changes can turn a documented no-op into an exception.
- **Apply-when:** Designing lifecycle methods such as open, start, mount, or connect.

## Batch design questions when requested

- **What happened:** Audio API brainstorming continued with one decision per turn after the user preferred grouped questions.
- **Rule:** When the user asks for consolidated questions, present the remaining related decisions together with concise recommended defaults.
- **Why:** Excessive turn-by-turn questioning slows review without improving clarity.
- **Apply-when:** Refining a feature design after its core direction is already understood.

## Let the declared owner orchestrate child resources

- **What happened:** Audio context startup was split between `context.resume()` and an individual file `play()` call despite the context owning the graph.
- **Rule:** When a parent custom element owns a declarative graph, its lifecycle method must coordinate every declared child resource unless explicitly excluded.
- **Why:** Requiring per-child startup undermines the HTML hierarchy and makes orchestration leak into consumer JavaScript.
- **Apply-when:** Designing lifecycle APIs for nested custom elements or resource graphs.

## Replacement resources inherit the owner's lifecycle state

- **What happened:** A microphone selected while its graph was suspended initially produced enabled replacement tracks.
- **Rule:** Prepare replacements in the owner's current running or suspended state before committing them.
- **Why:** Atomic resource replacement must preserve lifecycle state as well as graph connectivity.
- **Apply-when:** Swapping streams, transports, workers, or other live child resources.

## Scope semantic locators by meaning

- **What happened:** Adding a second accessible note made an existing role-only Playwright locator ambiguous.
- **Rule:** When a role can legitimately repeat, scope its locator by accessible name or distinctive user-visible text.
- **Why:** Semantic roles describe a category, not uniqueness, and pages naturally gain more elements in that category.
- **Apply-when:** Writing E2E assertions for notes, status regions, buttons, links, or other repeated roles.

## Treat samples as runnable destinations

- **What happened:** Static recipe snippets were added, but the user expected new samples in the examples navigation.
- **Rule:** In a sample site, “add samples” means independently discoverable and runnable pages unless the user explicitly asks only for snippets.
- **Why:** Code shown inside an existing page does not expand the navigable sample collection.
- **Apply-when:** Adding demos, recipes, examples, galleries, or documentation playgrounds.

## Avoid shell-reserved variable names

- **What happened:** A zsh polling loop assigned to the read-only `status` parameter and stopped before checking CI.
- **Rule:** Prefix shell variables with a task-specific name instead of generic shell terms such as `status`.
- **Why:** Shell-reserved parameters vary by shell and can turn an otherwise portable command into an immediate failure.
- **Apply-when:** Writing shell loops, polling commands, or inline automation.

## Separate drag handles from activation controls

- **What happened:** Pointer-up redrew a draggable node before its nested selection button could receive click.
- **Rule:** Give dragging a dedicated handle and keep the primary button free of pointer-move side effects.
- **Why:** Removing a click target between pointer-up and click makes real-browser behavior diverge from programmatic unit clicks.
- **Apply-when:** Building draggable cards that also contain buttons, links, or editable controls.

## Test inherited color schemes inside shadow DOM

- **What happened:** Semantic visibility checks passed while white controls rendered white text after inheriting a dark page color scheme.
- **Rule:** Audit computed foreground/background contrast for native controls inside shadow roots under both host color schemes.
- **Why:** `toBeVisible()` proves geometry, not readable pixels, and user-agent control colors can ignore assumed inheritance.
- **Apply-when:** Styling reusable custom elements with buttons, inputs, or selects.

## Make the whole spatial model discoverable

- **What happened:** Relationship highlighting clarified selected cards, but off-screen nodes still required blind canvas exploration.
- **Rule:** Give spatial editors an always-visible model navigator, and reveal newly selected or created items inside the canvas viewport.
- **Why:** Selection clarity cannot help users discover content they cannot see or reach predictably.
- **Apply-when:** Building graph, canvas, workflow, timeline, or other spatial editors.

## Keep spatial nodes stable when an edge is removed

- **What happened:** Disconnecting an action recomputed its layout at the first column, leaving its former source too far away for a pointer reconnection.
- **Rule:** Preserve an editor node's current coordinates when removing its edge; let users move it explicitly afterward.
- **Why:** A topology edit should not unexpectedly move the target or make the next edit harder.
- **Apply-when:** Implementing connection removal in auto-laid-out graph or workflow editors.

## Preserve editor focus across queued renders

- **What happened:** An invalid Inspector edit focused its replacement input, then a queued MutationObserver render removed that focused element.
- **Rule:** When replacing a shadow tree, restore the active field after every render that can follow a mutation, and test focus after the queued task.
- **Why:** Immediate focus assertions miss a later redraw that silently drops keyboard users into the page.
- **Apply-when:** Rebuilding interactive Shadow DOM after attribute changes or validation rollback.

## Run CI test commands locally without extra flags

- **What happened:** Focused serial browser tests passed, but the unchanged `npm test` command ran files concurrently and timed out in CI.
- **Rule:** Before pushing, run the exact CI aggregate command; encode required concurrency limits in package scripts instead of local-only flags.
- **Why:** Faster focused runs can hide resource contention that the published workflow will encounter.
- **Apply-when:** Adding browser, Worker, media, or timing-sensitive tests to a CI suite.

## Count only completed independent UX audits

- **What happened:** The user requested five distinct UX agents; several initial agents hit a usage limit before returning findings.
- **Rule:** Count only completed, evidence-backed audits and retry failed contexts before claiming the requested coverage.
- **Why:** Agent launches are not equivalent to independent validation.
- **Apply-when:** Coordinating parallel UX, accessibility, or cross-device review.

## Validate touch gestures in a real browser

- **What happened:** Synthetic pointer tests passed while touch pointer capture retargeted release events and a canvas trapped page scrolling.
- **Rule:** Exercise touch drags and scroll chaining at mobile widths in a browser, then keep their reproductions as E2E tests.
- **Why:** Programmatic events do not model pointer capture or native scrolling accurately.
- **Apply-when:** Shipping drag, pan, port, or nested scrolling interactions.

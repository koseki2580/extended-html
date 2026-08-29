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

# RedlinePDF Unit Test Plan

## What's testable vs what isn't (right now)

**Pure logic — 100% testable, no DOM needed:**
- `src/geometry/transform.ts` — konvaToPdf, distance, polygonArea, polygonPerimeter
- `src/state/mutationTypes.ts` — type system completeness (compile-only; types can't fail at runtime)
- `src/state/appState.ts` — mutation pipeline (pre-hooks → handler → diff → post-hooks), state management methods

**Pure logic — testable with mocking:**
- `src/tools/toolProtocol.ts` — interface shape compliance of all 12 tools
- `src/tools/toolRunner.ts` — singleton behavior, protocol dispatching, lifecycle hooks

**Not testable without browser/DOM (skip for now):**
- All tool draw phases (`startDraw`, `midDraw`, `endDraw`) — create Konva shapes on actual stage layers
- `src/canvas/stage.ts` — StageManager, Konva stage orchestration
- `src/pdf/renderer.ts` — PDF rendering pipeline
- `src/state/canvasSync.ts` — diff-based canvas sync (requires live state + stage)
- `src/measure/scale.ts`, `src/measure/units.ts` — calibration math (check if pure or DOM-dependent first)

## Recommended approach: Vite + Vitest (no Jest setup cost)

Already using Vite → zero new config, native ES modules support. Vitest is ~50% faster than Jest for TS projects. No extra dev dependency pain.

```
npm i -D vitest @types/node jsdom --force
```

## Priority tiers

### Tier 1: Pure geometry math (fastest feedback loop)
**File:** `src/geometry/transform.test.ts`

| Test | What it proves |
|------|----------------|
| konvaToPdf with known input → expected output | Y-flip coordinate conversion works correctly across page sizes |
| distance() returns correct Euclidean distances | Math is right for markup rendering and measurements |
| polygonArea() returns positive area for CCW, negative for CW | Signed-area formula correct (critical for mm² display) |
| polygonPerimeter() sums edge lengths exactly | Measure tools show correct values |
| konvaToPdf round-trip: konva→pdf→konva preserves position | No precision drift during conversion |

**Estimated tests:** 5-8, execution <1s

### Tier 2: State management (mutation pipeline)
**File:** `src/state/appState.test.ts`

| Test | What it proves |
|------|----------------|
| update() merges partial state + notifies listeners | Core reactivity works |
| subscribe/unsubscribe lifecycle | No memory leaks from dangling listeners |
| on/emit custom events | Cross-module communication (tool-change, page-change, etc.) |
| setTool clears selection + emits event | State consistency across tool switches |
| mutate() runs pre-hooks → handler → diff → post-hooks in order | Pipeline ordering correct (Phase 2 core) |
| mutate ADD_MARKUP returns add DiffResult | Diff computation works for state changes |
| mutate UPDATE_STYLE skips canvas update when unchanged keys only | Performance optimization verified — no redundant Konva redraws during slider drags |
| REMOVE_MARKUPS returns remove diff with all IDs | Bulk operations compute correctly |

**Estimated tests:** 8-10, execution <2s

### Tier 3: Tool protocol compliance
**File:** `src/tools/toolProtocol.test.ts`

| Test | What it proves |
|------|----------------|
| Each of the 12 tools exports a const with required fields (id, name, draw or onClick) | No accidental breakage during refactoring |
| DrawPhase has startDraw/midDraw/endDraw signatures matching interface | Contract compliance verified at build time + runtime check |
| Tools that should use onClick (select/pan/count/scaleSet) don't have unnecessary draw phases | Interface design intent preserved |

**Estimated tests:** ~30 assertions across all 12 tools, execution <2s

### Tier 4: Measure math (if pure functions exist)
**File:** `src/measure/scale.test.ts` + `src/measure/units.test.ts`

If these files contain pure math (no DOM access), they're prime for tests. Check first — if they call Konva stage or require live geometry data, skip.

## What NOT to test yet (deferred)

- **Tool draw phases** — need jsdom + Konva mocks which add significant setup cost (~30 min). These are the hardest 60% of code to test. Defer until Tier 1-3 pass.
- **canvasSync.ts** — depends on live state diffing with Konva layer, impossible without browser mocking
- **PDF rendering/export** — requires pdfjs-dist + PDF files; integration territory

## Suggested implementation order

```
Week 1: Tier 1 (geometry) → immediate value, catches math bugs before they propagate
         Tier 2 (state) → validates the event-driven architecture core
         
Week 2: Tier 3 (tool protocols) → ensures refactoring didn't break tool contracts
         Tier 4 (measure math) → if pure functions exist there

Month 2-3: Tool draw phases with jsdom Konva mocks (biggest payoff, highest cost)
```

## Quick setup commands

```bash
npm install -D vitest @types/node jsdom --force

# Add to package.json scripts:
"test": "vitest run",
"test:watch": "vitest"

# Create test file pattern: src/**/*.test.ts (Vitest auto-discovers)
```

## Key design decision

**Keep tests in `src/` with `.test.ts` extension, NOT a separate `tests/` folder.** Why?
- Vitest finds them automatically
- Easier to import internal modules without path manipulation
- Test files live next to the code they test → clearer relationship
- User can `find src -name "*.test.ts"` and see coverage at a glance

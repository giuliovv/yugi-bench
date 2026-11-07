# GOAT Agent

Training-first foundation for a Yu-Gi-Oh! GOAT-format agent. The Python API and the local two-player browser game both use the pinned GOAT-mode ocgcore engine. The training action space is not yet complete.

The landing page's workbench is a scripted design prototype. `web/play.html` is the full rules-validating board for human-vs-model, human-vs-LLM, or local two-player duels; `web/bot.html` is a compact model-duel board.

## Why this shape

- **Rules engine:** a pinned [GOAT simulator](https://github.com/circlenline/goat-format-simulator) submodule supplies ocgcore, period card scripts, the card pool, and banlist. Our bridge runs it in `MODE_GOAT`; we do not reimplement card effects.
- **Agent view:** each decision exposes only information that player may know, plus an explicit list of legal choices. Hidden opponent hand, deck order, and face-down identities never appear in observations or training logs.
- **Replay:** seed, deck IDs, engine version, and chosen action IDs should reproduce a duel exactly. This supports debugging, regression tests, and offline training.
- **Human UI:** a hot-seat browser client presents the GOAT simulator's legal prompts to both players. The same ocgcore mode validates card effects, chains, combat, and wins. We do not copy DuelingBook assets or code.

## GOAT scope

Use the [GOAT Format historical card pool and April 2005 TCG banlist](https://beta.goatformat.com/learn/goat-format-history) and its [2005 rulings](https://beta.goatformat.com/learn/rulings). In particular, the first player draws on turn one and 2005 priority matters. A modern Yu-Gi-Oh! engine is **not** automatically GOAT-correct.

## Rules engine

`OcgcoreGoatEngine` starts a fresh Node worker for each duel. It validates 40-60 card main decks against the bundled GOAT pool and April 2005 copy limits, accepts an unrestricted-size Fusion deck, seeds ocgcore, then returns immutable observations and legal action IDs. The core handles card effects, chains, priority, combat, and victory. The worker returns only the acting player's hand and private set-card identities; the opponent's hidden cards are masked from public views.

High-level summon, set, activate, battle, chain, yes/no, and small card-selection prompts are enumerated. More complex prompts, such as multi-place selection and large card combinations, currently expose one `automatic_choice` backed by a deterministic baseline. **Do not train a final policy or claim full action coverage until these are enumerated.** The underlying duel still uses ocgcore's rules.

The dependency is pinned as a Git submodule and is AGPL-3.0-or-later. This repository uses the same license; see `LICENSE`. Card names/data come from the upstream dependency; card artwork is not included in the Git repository and remains subject to its owners' rights.

## Roadmap

1. Expand `automatic_choice` prompts into complete, bounded legal-action representations and add action-space tests.
2. Validate more period rulings and expose match play (best of three with side decking) beyond single duels.
3. Add remote two-device multiplayer and match play; the current game is local hot-seat only.
4. Collect expert games only with permission; train an imitation baseline, then self-play. Evaluate against fixed decks/seeds and held-out opponents, not just self-play win rate.

## Development

```sh
git submodule update --init --recursive
python3 -m venv .venv
. .venv/bin/activate
pip install -e '.[dev]'
bash infra/check-rules.sh
python examples/smoke_duel.py --seed 42
```

Requires Node 20+ for the bundled WASM core. The conformance script runs our Python tests and the pinned upstream historical-ruling, card, and mirror-sync checks. A small smoke-test checkpoint is included; it is not a validated competitive model.

Minimal API:

```python
from goat_agent import OcgcoreGoatEngine

with OcgcoreGoatEngine() as engine:
    observation = engine.reset(seed=42, decks=(deck_a, deck_b), extras=(fusion_a, fusion_b))
    while observation.legal_actions:
        action = observation.legal_actions[0]
        result = engine.step(action.id)
        observation = result.observation
        if result.terminated:
            break
```

## Web game

Build the self-contained game page from the pinned simulator and our hot-seat adapter:

```sh
git submodule update --init --recursive
node infra/prepare-card-assets.mjs
node infra/build-play.mjs
node infra/build-bot.mjs
node infra/build-pwa.mjs
python3 -m http.server 8000 -d web
```

Open `http://localhost:8000/play.html`. Choose **Play against the model**, **Play against an LLM**, or **Play two-player duel**, then select both decks. In model/LLM mode, you are Player 1 and the opponent controls Player 2 on the same full board; there is no handoff screen. In two-player mode, pass the device when the privacy screen appears. All card choices, phases, chains, and attacks are checked by ocgcore. The local model and hot-seat modes have no backend or account; LLM mode uses the relay described below. Opponent hands and face-down cards are hidden in the normal UI, but **hot-seat is not a security boundary**: someone with browser developer tools can inspect client memory. This is a single duel, not a best-of-three match. Artwork from the bundled decks is downloaded once to `web/cards/` and served from our CloudFront bucket; cards outside that set use YGOPRODeck as a fallback. The game has text fallbacks.

### Bring your own API key

On the full board, choose **Play against an LLM**, then OpenAI or Anthropic, a model from the dropdown (or **Other model ID**), and your provider API key. This mode requires a network connection and incurs charges on **your provider account** for each non-automatic opponent decision, up to 120 requests per duel. If the provider times out, rate-limits, truncates its answer, or proposes an illegal move, the duel pauses for **Retry LLM** or **Use local model for this move**. The engine validates every chosen action ID; the LLM cannot make up a move. Both provider requests ask for schema-constrained JSON; Claude uses low effort with output headroom so its thinking does not consume the whole answer budget.

The browser sends the key with each decision over HTTPS to a stateless AWS Lambda Function URL in `eu-west-1`; the relay sends it to the chosen provider. The key is kept only in browser memory, is not saved in localStorage, S3, or Lambda storage, and is not included in duel logs. The Lambda role has no data access and no CloudWatch write policy. The request includes the acting player's observation, visible card names, and legal actions, **not** the opponent's hidden cards. OpenAI responses set `store: false`. Use a scoped, low-limit key; this is still a third-party site handling your credential in transit, not a zero-trust client. If you do not accept that trust boundary, use the local model. The PWA remains playable offline in its other modes.

Deploy the LLM relay with `bash infra/deploy-llm-proxy.sh`; this records its public URL in `infra/llm-proxy-url.txt` for the static bundle. `infra/deploy-web.sh` deploys/updates the relay first, then builds and publishes CloudFront. The Lambda URL CORS policy allows only the Yugi Bench CloudFront origin. The deploy script tries to reserve concurrency at 3, but AWS accounts with the default 10-concurrency quota cannot reserve any; in that case the relay runs on the shared 10-concurrency pool. CORS is a browser control, **not** authentication; the public URL can still be called outside a browser with a caller-supplied API key. Rotate the key if you suspect exposure.

The site is installable as a PWA from its HTTPS CloudFront URL (or localhost). In Chrome/Edge, use **Install app** in the browser menu; on iPhone/iPad, use **Share → Add to Home Screen**. The game pages and service-worker precached assets work offline; card art is not precached and needs a connection unless already in the browser cache. Card text fallbacks remain available. The service worker fetches fresh same-origin files when online and uses its cache only when offline. Rebuild `web/sw.js` with `node infra/build-pwa.mjs` after changing any web asset.

`hotseat/` adapts the [AGPL-licensed upstream browser client](https://github.com/circlenline/goat-format-simulator); `infra/build-play.mjs` bundles it with the pinned core, the same policy weights as the compact board, and the training bridge's legal-action mapping. Do not hand-edit generated `web/play.html`.

## Small self-play baseline

The optional `train` extra adds NumPy, not a GPU framework. A 64-unit policy/value network scores each legal action from the acting player's observation; it cannot read hidden opponent cards. Variable action lists are handled by scoring candidates individually. Legal action card IDs are features; arbitrary action IDs are **not**. First it imitates a weak hand-written policy, then uses completed self-play duels and terminal win/loss rewards. Evaluation plays against that heuristic with alternating seats.

```sh
pip install -e '.[train]'
python examples/train_selfplay.py --warmup-games 4 --selfplay-games 20 --eval-games 4 --max-decisions 1500
# Continue with new seeds, appending metrics to the same run:
python examples/train_selfplay.py --resume --warmup-games 0 --selfplay-games 20 --eval-games 4 --max-decisions 1500
```

Checkpoints and per-game JSONL metrics go to `checkpoints/` by default and are not committed. The log reports `fallback_decisions`; these are choices the current Python action bridge did **not** expose to the model. Truncated games do not receive a fabricated win/loss reward or count toward the evaluation win rate. Expand the action bridge and run longer, held-out-deck evaluations before drawing strategy conclusions.

### Play against the smoke model

The repository includes `models/smoke_policy.npz`, trained on a temporary CPU Spot instance with 2 heuristic warmup games and 4 self-play games (seed 42, two bundled decks). It won 1 of 2 evaluation games against the weak heuristic; this is **not** evidence of competitive strength. Play against it locally in a terminal:

```sh
git submodule update --init --recursive
python3 -m venv .venv
. .venv/bin/activate
pip install -e '.[train]'
python examples/play_vs_model.py --list-decks
python examples/play_vs_model.py --human-deck 0 --bot-deck 1
```

Requires Node 20+ and Python 3.10+. Enter the number of a legal action; `q` quits. The terminal shows your hand and field, the opponent's public field and LP, and masks face-down opponent cards. `--human-seat 1` lets the bot start; `--checkpoint` selects another model. The bot takes deterministic highest-probability actions. Complex prompts marked `automatic_choice` are still resolved by the bridge's fixed policy, so the model does not control those choices.

The same checkpoint is exported to `models/smoke_policy.json` for both browser boards. Its feature hashes and chosen actions are tested against Python fixtures from real duels. The compact `web/bot.html` packages the **same** training bridge and GOAT rules core, runs locally with no backend, and offers deck and first-player selection. The full `web/play.html` now also uses that action mapping and model, but always starts the human as Player 1. To build both static pages locally:

```sh
node infra/build-play.mjs
node infra/build-bot.mjs
node infra/build-pwa.mjs
python3 -m http.server 8000 -d web
```

Open `http://localhost:8000/play.html` for the full board or `http://localhost:8000/bot.html` for the compact board. After retraining, run `python3 infra/export-policy.py` and rebuild before deploying. This model is a smoke-test opponent, not a competitive agent.

## Web prototype

Open `web/index.html` locally, or serve it with `python3 -m http.server 8000 -d web`. Select sample actions to inspect how a future engine's player observation, action list, and decision trace will fit together. Card panels are original placeholders, not Yu-Gi-Oh! artwork.

To deploy to AWS from an identity with S3, CloudFront, IAM, and Lambda permissions:

```sh
bash infra/deploy-web.sh
```

The script is idempotent: it uses a private account-scoped S3 bucket and an LLM relay Lambda in `eu-west-1`, a CloudFront distribution with Origin Access Control, and invalidates cached content after upload. Before building, it restores downloaded artwork from S3 and fetches only missing bundled-deck images. Generated images are ignored by Git. It publishes the new service worker only after the game assets are available at the edge. It prints the distribution URL. No public S3 access or custom domain is required.

## References and rights

GOAT rules: [GOAT Format](https://beta.goatformat.com/learn/goat-format-history). Engine dependency: [Goat Format Simulator](https://github.com/circlenline/goat-format-simulator), [Project Ignis ocgcore](https://github.com/edo9300/ygopro-core). UI inspiration: [DuelingBook](https://www.duelingbook.com/). [YGOPRODeck image guidance](https://ygoprodeck.com/api-guide/) asks consumers to download and re-host images rather than continually hotlink them. Our fallback for cards outside bundled decks still hotlinks, so broaden the local cache before promoting arbitrary deck imports. Card names, artwork, and game trademarks belong to their respective owners; this deployment does not grant rights to redistribute them elsewhere.

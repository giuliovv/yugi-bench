# GOAT Agent

Training-first foundation for a Yu-Gi-Oh! GOAT-format agent. The Python API now drives a real GOAT-mode ocgcore duel, but the training action space is not yet complete and the web UI is not yet connected to the engine.

The static UI in `web/` is a scripted, interactive design prototype. It does not enforce card rules, connect to an engine, or train a model.

## Why this shape

- **Rules engine:** a pinned [GOAT simulator](https://github.com/circlenline/goat-format-simulator) submodule supplies ocgcore, period card scripts, the card pool, and banlist. Our bridge runs it in `MODE_GOAT`; we do not reimplement card effects.
- **Agent view:** each decision exposes only information that player may know, plus an explicit list of legal choices. Hidden opponent hand, deck order, and face-down identities never appear in observations or training logs.
- **Replay:** seed, deck IDs, engine version, and chosen action IDs should reproduce a duel exactly. This supports debugging, regression tests, and offline training.
- **UI later:** a DuelingBook-like board can be a human-play/debugging client of the same API, not the rules engine. We will not copy DuelingBook assets or code.

## GOAT scope

Use the [GOAT Format historical card pool and April 2005 TCG banlist](https://beta.goatformat.com/learn/goat-format-history) and its [2005 rulings](https://beta.goatformat.com/learn/rulings). In particular, the first player draws on turn one and 2005 priority matters. A modern Yu-Gi-Oh! engine is **not** automatically GOAT-correct.

## Rules engine

`OcgcoreGoatEngine` starts a fresh Node worker for each duel. It validates 40-60 card main decks against the bundled GOAT pool and April 2005 copy limits, accepts an unrestricted-size Fusion deck, seeds ocgcore, then returns immutable observations and legal action IDs. The core handles card effects, chains, priority, combat, and victory. The worker returns only the acting player's hand and private set-card identities; the opponent's hidden cards are masked from public views.

High-level summon, set, activate, battle, chain, yes/no, and small card-selection prompts are enumerated. More complex prompts, such as multi-place selection and large card combinations, currently expose one `automatic_choice` backed by a deterministic baseline. **Do not train a final policy or claim full action coverage until these are enumerated.** The underlying duel still uses ocgcore's rules.

The dependency is pinned as a Git submodule and is AGPL-3.0-or-later. This repository uses the same license; see `LICENSE`. Card names/data come from the upstream dependency; do not redistribute card artwork.

## Roadmap

1. Expand `automatic_choice` prompts into complete, bounded legal-action representations and add action-space tests.
2. Validate more period rulings and expose match play (best of three with side decking) beyond single duels.
3. Connect the web board to a session API; remove its scripted trace once the live board works.
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

Requires Node 20+ for the bundled WASM core. The conformance script runs our Python tests and the pinned upstream historical-ruling, card, and mirror-sync checks. No pretrained model is included.

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

## Web prototype

Open `web/index.html` locally, or serve it with `python3 -m http.server 8000 -d web`. Select sample actions to inspect how a future engine's player observation, action list, and decision trace will fit together. Card panels are original placeholders, not Yu-Gi-Oh! artwork.

To deploy to AWS from an identity with S3 and CloudFront permissions:

```sh
bash infra/deploy-web.sh
```

The script is idempotent: it uses a private account-scoped S3 bucket in `eu-west-1`, a CloudFront distribution with Origin Access Control, and invalidates cached content after upload. It prints the distribution URL. No public S3 access or custom domain is required.

## References and rights

GOAT rules: [GOAT Format](https://beta.goatformat.com/learn/goat-format-history). Engine dependency: [Goat Format Simulator](https://github.com/circlenline/goat-format-simulator), [Project Ignis ocgcore](https://github.com/edo9300/ygopro-core). UI inspiration: [DuelingBook](https://www.duelingbook.com/). Card names, artwork, and game trademarks belong to their respective owners. Do not redistribute scraped card images or DuelingBook content.

# GOAT Agent

Training-first foundation for a Yu-Gi-Oh! GOAT-format agent. This repository is **not yet a playable simulator**. Its first milestone is a reliable, reproducible rules engine with an API suitable for self-play, imitation learning, and evaluation.

## Why this shape

- **Rules engine:** one authoritative implementation owns legality, card effects, chains, priority, victory, and randomness. Do not train on a manual UI's clicks as though they were legal game states.
- **Agent view:** each decision exposes only information that player may know, plus an explicit list of legal choices. Hidden opponent hand, deck order, and face-down identities never appear in observations or training logs.
- **Replay:** seed, deck IDs, engine version, and chosen action IDs should reproduce a duel exactly. This supports debugging, regression tests, and offline training.
- **UI later:** a DuelingBook-like board can be a human-play/debugging client of the same API, not the rules engine. We will not copy DuelingBook assets or code.

## GOAT scope

Use the [GOAT Format historical card pool and April 2005 TCG banlist](https://beta.goatformat.com/learn/goat-format-history) and its [2005 rulings](https://beta.goatformat.com/learn/rulings). In particular, the first player draws on turn one and 2005 priority matters. A modern Yu-Gi-Oh! engine is **not** automatically GOAT-correct.

## Engine decision

Before implementing hundreds of card effects, evaluate an existing engine such as [EDOPro's `ygopro-core`](https://github.com/edo9300/ygopro-core). Its AGPL-3.0-or-later license must be reviewed before integration or distribution. We currently vendor neither its code nor third-party card images/data. The adapter in `src/goat_agent/engine.py` is deliberately engine-agnostic.

## Roadmap

1. Select and license-check an engine and 2005 card scripts/database; pin exact versions.
2. Build a GOAT conformance suite: deck legality, opening draw, phase transitions, chain timing/priority, battle, common card interactions, and match rules.
3. Implement the adapter: legal action IDs, action masking, per-player observations, deterministic resets and replay; compare traces against known rulings.
4. Add a simple human board and scripted baseline agents for sanity checks.
5. Collect expert games only with permission; train an imitation baseline, then self-play. Evaluate against fixed decks/seeds and held-out opponents, not just self-play win rate.

## Development

```sh
python3 -m venv .venv
. .venv/bin/activate
pip install -e '.[dev]'
pytest
```

The tests currently cover the **interface contract**, not GOAT gameplay. No pretrained model or full card database is included.

## References and rights

GOAT rules: [GOAT Format](https://beta.goatformat.com/learn/goat-format-history). UI inspiration: [DuelingBook](https://www.duelingbook.com/). Card names, artwork, and game trademarks belong to their respective owners. Do not redistribute scraped card images or DuelingBook content.

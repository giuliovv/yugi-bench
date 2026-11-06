"""Run one real GOAT duel with a simple random-action baseline."""

import argparse
import json
import random
from pathlib import Path

from goat_agent import OcgcoreGoatEngine


ROOT = Path(__file__).resolve().parents[1]
DECKS = ROOT / "vendor/goat-format-simulator/engine/data/mazos.json"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--max-decisions", type=int, default=500)
    args = parser.parse_args()
    sample = json.loads(DECKS.read_text(encoding="utf-8"))[0]
    deck = tuple(sample["main"])
    extra = tuple(sample["extra"])
    rng = random.Random(args.seed)

    with OcgcoreGoatEngine() as engine:
        observation = engine.reset(args.seed, (deck, deck), (extra, extra))
        print(f"GOAT duel: {sample['nombre']} vs itself, seed={args.seed}")
        print(f"Opening hand: {len(observation.own_hand)} cards; {len(observation.legal_actions)} choices")
        for decision in range(args.max_decisions):
            if not observation.legal_actions:
                break
            action = rng.choice(observation.legal_actions)
            result = engine.step(action.id)
            observation = result.observation
            if decision < 10 or result.terminated:
                print(f"{decision + 1:03d} P{observation.player} {action.kind}: {action.label}")
            if result.terminated:
                print(f"Finished: winner={result.winner}, rewards={result.rewards}, turn={observation.public.turn}")
                return
        print(f"Stopped after {args.max_decisions} choices at turn {observation.public.turn}")


if __name__ == "__main__":
    main()

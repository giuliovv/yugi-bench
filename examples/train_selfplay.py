"""Train a compact GOAT policy/value baseline on player-safe observations."""

import argparse
import json
import random
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from goat_agent import OcgcoreGoatEngine
from goat_agent.learning import Example, TinyPolicyValue, action_features, state_features
from goat_agent.model import Observation


ROOT = Path(__file__).resolve().parents[1]
DECKS = ROOT / "vendor/goat-format-simulator/engine/data/mazos.json"
PRIORITY = {
    "normal_summon": 6, "special_summon": 5, "attack": 5,
    "activate": 4, "set_monster": 3, "set_spell_trap": 3,
    "battle_phase": 2, "main2": 2, "end_turn": 1,
    "chain": 1, "pass": 2, "yes": 1, "no": 1,
}


def heuristic_choice(obs: Observation, rng: random.Random) -> int:
    """Deliberately weak and slightly stochastic teacher, not an expert."""
    scores = [PRIORITY.get(action.kind, 1) + rng.random() * 0.5 for action in obs.legal_actions]
    return max(range(len(scores)), key=scores.__getitem__)


@dataclass
class Episode:
    examples: list[Example]
    winner: int | None
    rewards: tuple[float, float]
    complete: bool
    decisions: int
    fallback_decisions: int
    final_turn: int


def play(seed: int, pair: tuple[dict, dict], model: TinyPolicyValue,
         max_decisions: int, mode: str, model_seat: int | None = None) -> Episode:
    rng = random.Random(seed)
    np_rng = np.random.default_rng(seed)
    examples: list[Example] = []
    fallback = 0
    decks = (tuple(pair[0]["main"]), tuple(pair[1]["main"]))
    extras = (tuple(pair[0]["extra"]), tuple(pair[1]["extra"]))
    with OcgcoreGoatEngine() as engine:
        obs = engine.reset(seed, decks, extras)
        for decision in range(max_decisions):
            actions = obs.legal_actions
            if not actions:
                break
            fallback += int(any(action.kind == "automatic_choice" for action in actions))
            if len(actions) == 1:
                choice = 0
            elif mode == "heuristic" or (mode == "eval" and obs.player != model_seat):
                choice = heuristic_choice(obs, rng)
            else:
                choice = model.choose(obs, np_rng, sample=mode == "selfplay")
            if len(actions) > 1 and mode != "eval":
                examples.append(Example(state_features(obs), action_features(actions), choice, obs.player))
            result = engine.step(actions[choice].id)
            obs = result.observation
            if result.terminated:
                return Episode(examples, result.winner, result.rewards, True,
                               decision + 1, fallback, obs.public.turn)
        return Episode(examples, None, (0.0, 0.0), False,
                       min(max_decisions, decision + 1), fallback, obs.public.turn)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--warmup-games", type=int, default=4)
    parser.add_argument("--selfplay-games", type=int, default=20)
    parser.add_argument("--eval-games", type=int, default=4)
    parser.add_argument("--max-decisions", type=int, default=1000)
    parser.add_argument("--deck-limit", type=int, default=3)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--learning-rate", type=float, default=0.003)
    parser.add_argument("--checkpoint", type=Path, default=ROOT / "checkpoints/tiny_policy.npz")
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()
    if min(args.warmup_games, args.selfplay_games, args.eval_games) < 0 or args.max_decisions < 1:
        parser.error("game counts must be nonnegative and max-decisions positive")
    if args.deck_limit < 1 or args.learning_rate <= 0:
        parser.error("deck-limit and learning-rate must be positive")
    pool = [deck for deck in json.loads(DECKS.read_text(encoding="utf-8")) if not deck.get("aviso")]
    pool = pool[:args.deck_limit]
    if not pool:
        parser.error("no valid bundled decks found")
    model = TinyPolicyValue.load(args.checkpoint) if args.resume else TinyPolicyValue(seed=args.seed)
    metrics = args.checkpoint.with_suffix(".metrics.jsonl")
    metrics.parent.mkdir(parents=True, exist_ok=True)
    prior_counts = {"heuristic": 0, "selfplay": 0, "eval": 0}
    if args.resume and metrics.exists():
        for line in metrics.read_text(encoding="utf-8").splitlines():
            prior_counts[json.loads(line)["mode"]] += 1
    eval_results: list[tuple[int | None, bool, int]] = []
    with metrics.open("a" if args.resume else "w", encoding="utf-8") as log:
        for mode, count in (("heuristic", args.warmup_games),
                            ("selfplay", args.selfplay_games), ("eval", args.eval_games)):
            for game in range(prior_counts[mode], prior_counts[mode] + count):
                seed = args.seed + (0 if mode == "heuristic" else 100000 if mode == "selfplay" else 200000) + game
                deck_rng = random.Random(seed)
                pair = (deck_rng.choice(pool), deck_rng.choice(pool))
                seat = game % 2 if mode == "eval" else None
                episode = play(seed, pair, model, args.max_decisions, mode, seat)
                losses = []
                if mode == "heuristic":
                    for example in episode.examples:
                        losses.append(model.update(example, 0.0, args.learning_rate, imitation=True))
                elif mode == "selfplay" and episode.complete:
                    random.Random(seed + 777).shuffle(episode.examples)
                    for example in episode.examples:
                        losses.append(model.update(example, episode.rewards[example.player], args.learning_rate))
                if mode != "eval":
                    model.save(args.checkpoint)
                else:
                    eval_results.append((episode.winner, episode.complete, seat))
                row = {
                    "mode": mode, "game": game, "seed": seed,
                    "decks": [deck["nombre"] for deck in pair],
                    "winner": episode.winner, "complete": episode.complete,
                    "decisions": episode.decisions, "fallback_decisions": episode.fallback_decisions,
                    "turns": episode.final_turn, "examples": len(episode.examples),
                    "mean_loss": round(float(np.mean(losses)), 4) if losses else None,
                    "model_seat": seat,
                }
                log.write(json.dumps(row) + "\n")
                log.flush()
                print(json.dumps(row), flush=True)
    if args.eval_games:
        completed = sum(complete for _, complete, _ in eval_results)
        model_wins = sum(complete and winner == seat for winner, complete, seat in eval_results)
        print(f"Evaluation: {model_wins}/{completed} completed games won vs heuristic; "
              f"{args.eval_games - completed} truncated (excluded from win rate)", flush=True)
    print(f"Checkpoint: {args.checkpoint}")
    print(f"Metrics: {metrics}")


if __name__ == "__main__":
    main()

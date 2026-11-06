"""Play a terminal GOAT duel against the small trained policy."""

import argparse
import json
from pathlib import Path

import numpy as np

from goat_agent import OcgcoreGoatEngine
from goat_agent.learning import TinyPolicyValue
from goat_agent.model import CardView, Observation


ROOT = Path(__file__).resolve().parents[1]
DECKS = ROOT / "vendor/goat-format-simulator/engine/data/mazos.json"
CARD_TEXTS = ROOT / "vendor/goat-format-simulator/engine/data/pool_texts.json"
DEFAULT_MODEL = ROOT / "models/smoke_policy.npz"


def card_name(code: int | None, names: dict[str, list[str]]) -> str:
    if code is None:
        return "face-down card"
    entry = names.get(str(code))
    return entry[0] if entry else f"card #{code}"


def field(cards: tuple[CardView, ...], names: dict[str, list[str]],
          own_hidden: dict[str, int] | None = None) -> str:
    if not cards:
        return "empty"
    own_hidden = own_hidden or {}
    return ", ".join(
        f"{card_name(card.card_id if card.face_up else own_hidden.get(card.instance_id), names)}"
        f" ({card.position or 'set'})"
        for card in cards
    )


def render_observation(obs: Observation, names: dict[str, list[str]], human: int) -> str:
    own, other = obs.public.players[human], obs.public.players[1 - human]
    hidden = dict(obs.own_face_down)
    hand = ", ".join(card_name(code, names) for code in obs.own_hand) or "empty"
    return "\n".join((
        f"Turn {obs.public.turn} | {obs.public.phase} | Your LP {own.life_points} | Opponent LP {other.life_points}",
        f"Your hand: {hand}",
        f"Your monsters: {field(own.monsters, names, hidden)}",
        f"Your spells/traps: {field(own.spells_traps, names, hidden)}",
        f"Opponent monsters: {field(other.monsters, names)}",
        f"Opponent spells/traps: {field(other.spells_traps, names)}",
        f"Graveyards: you {len(own.graveyard)}, opponent {len(other.graveyard)}",
    ))


def ask_action(obs: Observation) -> int | None:
    for index, action in enumerate(obs.legal_actions, 1):
        print(f"  {index:2}. {action.label}")
    while True:
        try:
            response = input("Choose action number (q to quit): ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            print()
            return None
        if response in {"q", "quit"}:
            return None
        if response.isdecimal() and 1 <= int(response) <= len(obs.legal_actions):
            return int(response) - 1
        print(f"Enter 1-{len(obs.legal_actions)} or q.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", type=Path, default=DEFAULT_MODEL)
    parser.add_argument("--human-seat", type=int, choices=(0, 1), default=0)
    parser.add_argument("--human-deck", type=int, default=0)
    parser.add_argument("--bot-deck", type=int, default=1)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--max-decisions", type=int, default=2000)
    parser.add_argument("--list-decks", action="store_true")
    args = parser.parse_args()
    decks = [deck for deck in json.loads(DECKS.read_text(encoding="utf-8")) if not deck.get("aviso")]
    if args.list_decks:
        for index, deck in enumerate(decks):
            print(f"{index:2}: {deck['nombre']}")
        return
    if args.max_decisions < 1 or not (0 <= args.human_deck < len(decks)) or not (0 <= args.bot_deck < len(decks)):
        parser.error("deck indices must be from --list-decks and max-decisions must be positive")
    if not args.checkpoint.is_file():
        parser.error(f"checkpoint not found: {args.checkpoint}")
    names = json.loads(CARD_TEXTS.read_text(encoding="utf-8"))
    model = TinyPolicyValue.load(args.checkpoint)
    human_deck, bot_deck = decks[args.human_deck], decks[args.bot_deck]
    order = (human_deck, bot_deck) if args.human_seat == 0 else (bot_deck, human_deck)
    print(f"You: {human_deck['nombre']} | Opponent: {bot_deck['nombre']} | Seed: {args.seed}")
    print("Smoke-test model: some complex legal choices are resolved automatically, and playing strength is unproven.")
    rng = np.random.default_rng(args.seed)
    bot_decisions = 0
    with OcgcoreGoatEngine() as engine:
        obs = engine.reset(args.seed, tuple(tuple(deck["main"]) for deck in order),
                           tuple(tuple(deck["extra"]) for deck in order))
        for _ in range(args.max_decisions):
            if not obs.legal_actions:
                break
            if obs.player == args.human_seat:
                if bot_decisions:
                    print(f"\nOpponent made {bot_decisions} decisions.")
                    bot_decisions = 0
                print("\n" + render_observation(obs, names, args.human_seat))
                if len(obs.legal_actions) == 1 and obs.legal_actions[0].kind == "automatic_choice":
                    print("A complex engine choice was resolved automatically.")
                    choice = 0
                else:
                    choice = ask_action(obs)
                    if choice is None:
                        print("Duel ended without a result.")
                        return
            else:
                choice = model.choose(obs, rng, sample=False)
                bot_decisions += 1
            result = engine.step(obs.legal_actions[choice].id)
            obs = result.observation
            if result.terminated:
                print(f"\n{'You win!' if result.winner == args.human_seat else 'Opponent wins!' if result.winner is not None else 'Draw.'}")
                print(f"Finished on turn {obs.public.turn} after engine-validated play.")
                return
        print(f"Duel stopped at the {args.max_decisions}-decision cap without a result.")


if __name__ == "__main__":
    main()

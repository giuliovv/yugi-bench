"""Small, deterministic training-trajectory format."""

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable

from .engine import DuelEngine, require_legal_action
from .model import Observation


@dataclass(frozen=True)
class Decision:
    observation: Observation
    action_id: str


def write_jsonl(path: Path, decisions: Iterable[Decision]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as output:
        for decision in decisions:
            require_legal_action(decision.observation, decision.action_id)
            output.write(json.dumps(asdict(decision), separators=(",", ":")) + "\n")


def replay(engine: DuelEngine, seed: int, decks: tuple[tuple[int, ...], tuple[int, ...]], actions: Iterable[str]) -> None:
    observation = engine.reset(seed, decks)
    for action_id in actions:
        require_legal_action(observation, action_id)
        result = engine.step(action_id)
        observation = result.observation
        if result.terminated or result.truncated:
            break


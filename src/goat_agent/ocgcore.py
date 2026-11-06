"""Python adapter for the pinned GOAT-mode ocgcore worker.

The Node worker owns the native/WASM rules engine. Each Python reset starts a
fresh worker so engine state and random seeds cannot leak across duels.
"""

import json
import subprocess
from pathlib import Path
from typing import Any

from .engine import require_legal_action
from .model import Action, CardView, Observation, PlayerView, PublicState, StepResult


ROOT = Path(__file__).resolve().parents[2]
WORKER = ROOT / "runtime" / "goat-engine.mjs"


def _card(data: dict[str, Any]) -> CardView:
    return CardView(**data)


def _player(data: dict[str, Any]) -> PlayerView:
    return PlayerView(
        life_points=data["life_points"],
        deck_count=data["deck_count"],
        hand_count=data["hand_count"],
        graveyard=tuple(data["graveyard"]),
        banished=tuple(map(_card, data["banished"])),
        monsters=tuple(map(_card, data["monsters"])),
        spells_traps=tuple(map(_card, data["spells_traps"])),
    )


def _observation(data: dict[str, Any]) -> Observation:
    public = data["public"]
    return Observation(
        player=data["player"],
        public=PublicState(
            turn=public["turn"],
            turn_player=public["turn_player"],
            phase=public["phase"],
            priority_player=public["priority_player"],
            chain_length=public["chain_length"],
            players=tuple(map(_player, public["players"])),
        ),
        own_hand=tuple(data["own_hand"]),
        legal_actions=tuple(Action(**{**action, "card_ids": tuple(action.get("card_ids", ()))})
                            for action in data["legal_actions"]),
        own_face_down=tuple((uid, code) for uid, code in data["own_face_down"]),
        own_extra=tuple(data["own_extra"]),
    )


class OcgcoreGoatEngine:
    """GOAT rules core with a legal-action interface for two-player training.

    The current bridge presents every high-level duel choice but certain
    complex card-specific prompts use one explicit `automatic_choice` action.
    Those prompts must be expanded before claiming a full agent action space.
    """

    def __init__(self) -> None:
        self._worker: subprocess.Popen[str] | None = None
        self._observation: Observation | None = None

    def _request(self, command: dict[str, Any]) -> dict[str, Any]:
        if self._worker is None or self._worker.stdin is None or self._worker.stdout is None:
            raise RuntimeError("engine worker is not running")
        self._worker.stdin.write(json.dumps(command) + "\n")
        self._worker.stdin.flush()
        line = self._worker.stdout.readline()
        if not line:
            detail = self._worker.stderr.read() if self._worker.stderr else ""
            raise RuntimeError(f"GOAT engine worker exited: {detail[-2000:]}")
        response = json.loads(line)
        if not response["ok"]:
            raise ValueError(response["error"])
        if response["core_errors"]:
            raise RuntimeError(f"ocgcore reported errors: {response['core_errors'][:3]}")
        return response

    def reset(
        self, seed: int, decks: tuple[tuple[int, ...], tuple[int, ...]],
        extras: tuple[tuple[int, ...], tuple[int, ...]] | None = None,
    ) -> Observation:
        self.close()
        if not WORKER.is_file():
            raise RuntimeError("GOAT worker missing; run from the repository checkout")
        self._worker = subprocess.Popen(
            ["node", str(WORKER)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True, bufsize=1,
        )
        try:
            result = self._request({
                "op": "reset", "seed": seed, "decks": decks,
                "extras": extras if extras is not None else ((), ()),
            })
        except Exception:
            self.close()
            raise
        self._observation = _observation(result["observation"])
        return self._observation

    def step(self, action_id: str) -> StepResult:
        if self._observation is None:
            raise RuntimeError("call reset before step")
        require_legal_action(self._observation, action_id)
        result = self._request({"op": "step", "action_id": action_id})
        self._observation = _observation(result["observation"])
        return StepResult(
            observation=self._observation,
            rewards=tuple(result["rewards"]),
            terminated=result["terminated"],
            truncated=result["truncated"],
            winner=result["winner"],
        )

    def close(self) -> None:
        if self._worker is not None:
            self._worker.terminate()
            try:
                self._worker.communicate(timeout=3)
            except subprocess.TimeoutExpired:
                self._worker.kill()
                self._worker.communicate()
            self._worker = None
        self._observation = None

    def __enter__(self) -> "OcgcoreGoatEngine":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()


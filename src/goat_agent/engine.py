"""Boundary between a full duel engine and learning code."""

from typing import Protocol

from .model import Observation, StepResult


class DuelEngine(Protocol):
    def reset(self, seed: int, decks: tuple[tuple[int, ...], tuple[int, ...]]) -> Observation:
        """Start a duel; return the observation for the player with priority."""

    def step(self, action_id: str) -> StepResult:
        """Apply one legal choice and return the next decision point."""


def require_legal_action(observation: Observation, action_id: str) -> None:
    if action_id not in {action.id for action in observation.legal_actions}:
        raise ValueError(f"illegal action: {action_id}")


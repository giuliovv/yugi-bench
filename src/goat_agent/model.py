"""Immutable, serializable views exposed to agents.

Only the engine adapter may construct an Observation. Hidden information must
be removed before it reaches this module, not merely hidden by a UI.
"""

from dataclasses import dataclass
from typing import Literal


Phase = Literal["draw", "standby", "main1", "battle", "main2", "end"]


@dataclass(frozen=True)
class CardView:
    instance_id: str
    zone: str
    face_up: bool
    card_id: int | None = None
    position: str | None = None

    def __post_init__(self) -> None:
        if not self.face_up and self.card_id is not None:
            raise ValueError("face-down card identity must be hidden")


@dataclass(frozen=True)
class PlayerView:
    life_points: int
    deck_count: int
    hand_count: int
    graveyard: tuple[int, ...]
    banished: tuple[CardView, ...]
    monsters: tuple[CardView, ...]
    spells_traps: tuple[CardView, ...]


@dataclass(frozen=True)
class PublicState:
    turn: int
    turn_player: int
    phase: Phase
    priority_player: int
    chain_length: int
    players: tuple[PlayerView, PlayerView]


@dataclass(frozen=True)
class Action:
    """Engine-issued ID plus legal, player-visible action metadata.

    The agent selects by ID. card_ids describe cards named by this legal
    choice; they are not an opponent-state observation.
    """

    id: str
    kind: str
    label: str
    card_ids: tuple[int, ...] = ()


@dataclass(frozen=True)
class Observation:
    player: int
    public: PublicState
    own_hand: tuple[int, ...]
    legal_actions: tuple[Action, ...]
    own_face_down: tuple[tuple[str, int], ...] = ()
    own_extra: tuple[int, ...] = ()

    def __post_init__(self) -> None:
        if self.player not in (0, 1):
            raise ValueError("player must be 0 or 1")
        if len({action.id for action in self.legal_actions}) != len(self.legal_actions):
            raise ValueError("legal action IDs must be unique")


@dataclass(frozen=True)
class StepResult:
    observation: Observation
    rewards: tuple[float, float]
    terminated: bool
    truncated: bool
    winner: int | None


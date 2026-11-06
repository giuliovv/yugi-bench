"""Small player-safe policy/value model for variable legal-action sets."""

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .model import Action, Observation


FEATURE_VERSION = 2
CARD_BUCKETS = 32
LABEL_BUCKETS = 32
ACTION_KINDS = (
    "normal_summon", "special_summon", "set_monster", "set_spell_trap",
    "activate", "change_position", "battle_phase", "main2", "end_turn",
    "chain", "pass", "yes", "no", "option", "position", "select_cards",
    "cancel", "attack", "automatic_choice", "select_tribute", "other",
)
STATE_DIM = 21 + 9 * CARD_BUCKETS
ACTION_DIM = len(ACTION_KINDS) + LABEL_BUCKETS + CARD_BUCKETS
PHASES = ("draw", "standby", "main1", "battle", "main2", "end")


def _bucket(value: str, size: int) -> int:
    digest = hashlib.blake2b(value.encode("utf-8"), digest_size=8).digest()
    return int.from_bytes(digest, "little") % size


def _card_bag(codes: list[int] | tuple[int, ...]) -> np.ndarray:
    bag = np.zeros(CARD_BUCKETS, dtype=np.float32)
    for code in codes:
        bag[_bucket(str(code), CARD_BUCKETS)] += 1
    return bag / max(1, len(codes))


def state_features(obs: Observation) -> np.ndarray:
    """Use only the acting player's observation, never the engine's true state."""
    own = obs.public.players[obs.player]
    other = obs.public.players[1 - obs.player]
    scalars = [float(obs.public.phase == phase) for phase in PHASES] + [
        min(obs.public.turn, 40) / 40,
        float(obs.public.turn_player == obs.player),
        own.life_points / 8000, other.life_points / 8000,
        own.hand_count / 10, other.hand_count / 10,
        own.deck_count / 60, other.deck_count / 60,
        len(own.monsters) / 5, len(other.monsters) / 5,
        len(own.spells_traps) / 6, len(other.spells_traps) / 6,
        len(own.graveyard) / 40, len(other.graveyard) / 40,
        min(obs.public.chain_length, 10) / 10,
    ]
    def visible(cards: tuple) -> list[int]:
        return [card.card_id for card in cards if card.card_id is not None]

    bags = [
        obs.own_hand,
        tuple(code for _, code in obs.own_face_down),
        visible(own.monsters + own.spells_traps),
        visible(other.monsters + other.spells_traps),
        own.graveyard,
        other.graveyard,
        obs.own_extra,
        visible(own.banished),
        visible(other.banished),
    ]
    features = np.concatenate([np.asarray(scalars, dtype=np.float32)] + [_card_bag(bag) for bag in bags])
    if features.shape != (STATE_DIM,):
        raise RuntimeError(f"state feature shape changed: {features.shape}")
    return features


def action_features(actions: tuple[Action, ...]) -> np.ndarray:
    result = np.zeros((len(actions), ACTION_DIM), dtype=np.float32)
    for row, action in enumerate(actions):
        kind = ACTION_KINDS.index(action.kind) if action.kind in ACTION_KINDS else len(ACTION_KINDS) - 1
        result[row, kind] = 1
        tokens = re.findall(r"\w+", action.label.lower())
        for token in tokens:
            result[row, len(ACTION_KINDS) + _bucket(token, LABEL_BUCKETS)] += 1
        if tokens:
            result[row, len(ACTION_KINDS):len(ACTION_KINDS) + LABEL_BUCKETS] /= len(tokens)
        result[row, len(ACTION_KINDS) + LABEL_BUCKETS:] = _card_bag(action.card_ids)
    return result


@dataclass(frozen=True)
class Example:
    state: np.ndarray
    actions: np.ndarray
    chosen: int
    player: int


class TinyPolicyValue:
    """Shared state encoder, candidate-action scorer, and scalar value head."""

    def __init__(self, seed: int = 0, hidden: int = 64) -> None:
        rng = np.random.default_rng(seed)
        self.hidden = hidden
        self.w_state = rng.normal(0, 1 / np.sqrt(STATE_DIM), (STATE_DIM, hidden)).astype(np.float32)
        self.b_state = np.zeros(hidden, dtype=np.float32)
        self.w_policy = rng.normal(0, 1 / np.sqrt(hidden + ACTION_DIM), (hidden + ACTION_DIM, hidden)).astype(np.float32)
        self.b_policy = np.zeros(hidden, dtype=np.float32)
        self.w_logit = rng.normal(0, 1 / np.sqrt(hidden), hidden).astype(np.float32)
        self.b_logit = np.zeros(1, dtype=np.float32)
        self.w_value = rng.normal(0, 1 / np.sqrt(hidden), hidden).astype(np.float32)
        self.b_value = np.zeros(1, dtype=np.float32)

    def forward(self, state: np.ndarray, actions: np.ndarray) -> tuple[np.ndarray, float]:
        h = np.tanh(state @ self.w_state + self.b_state)
        inputs = np.concatenate([np.broadcast_to(h, (len(actions), self.hidden)), actions], axis=1)
        z = np.tanh(inputs @ self.w_policy + self.b_policy)
        logits = z @ self.w_logit + self.b_logit[0]
        shifted = logits - np.max(logits)
        probabilities = np.exp(shifted) / np.exp(shifted).sum()
        value = float(np.tanh(h @ self.w_value + self.b_value[0]))
        return probabilities, value

    def choose(self, obs: Observation, rng: np.random.Generator, sample: bool = True) -> int:
        if len(obs.legal_actions) == 1:
            return 0
        probs, _ = self.forward(state_features(obs), action_features(obs.legal_actions))
        return int(rng.choice(len(probs), p=probs)) if sample else int(np.argmax(probs))

    def update(self, example: Example, target: float, learning_rate: float = 0.003,
               imitation: bool = False) -> float:
        """One clipped SGD step; target is the final result from this player's view."""
        state, actions = example.state, example.actions
        h = np.tanh(state @ self.w_state + self.b_state)
        inputs = np.concatenate([np.broadcast_to(h, (len(actions), self.hidden)), actions], axis=1)
        z = np.tanh(inputs @ self.w_policy + self.b_policy)
        logits = z @ self.w_logit + self.b_logit[0]
        shifted = logits - np.max(logits)
        probs = np.exp(shifted) / np.exp(shifted).sum()
        value = float(np.tanh(h @ self.w_value + self.b_value[0]))
        advantage = 1.0 if imitation else target - value
        dlogits = advantage * probs
        dlogits[example.chosen] -= advantage
        dz = dlogits[:, None] * self.w_logit[None, :] * (1 - z * z)
        dpolicy = inputs.T @ dz
        dstate = (dz @ self.w_policy.T)[:, :self.hidden].sum(axis=0)
        dvalue = 0.0 if imitation else 0.5 * (value - target) * (1 - value * value)
        dstate += dvalue * self.w_value
        dh = dstate * (1 - h * h)
        grads = {
            "w_state": np.outer(state, dh), "b_state": dh,
            "w_policy": dpolicy, "b_policy": dz.sum(axis=0),
            "w_logit": z.T @ dlogits, "b_logit": np.array([dlogits.sum()]),
            "w_value": dvalue * h, "b_value": np.array([dvalue]),
        }
        norm = np.sqrt(sum(float(np.square(grad).sum()) for grad in grads.values()))
        scale = min(1.0, 5.0 / max(norm, 1e-8))
        for name, grad in grads.items():
            setattr(self, name, getattr(self, name) - learning_rate * scale * grad.astype(np.float32))
        return -float(np.log(max(probs[example.chosen], 1e-8)))

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        arrays = {name: getattr(self, name) for name in (
            "w_state", "b_state", "w_policy", "b_policy", "w_logit", "b_logit", "w_value", "b_value")}
        np.savez_compressed(path, feature_version=np.array([FEATURE_VERSION]), hidden=np.array([self.hidden]), **arrays)

    @classmethod
    def load(cls, path: Path) -> "TinyPolicyValue":
        with np.load(path, allow_pickle=False) as saved:
            if int(saved["feature_version"][0]) != FEATURE_VERSION:
                raise ValueError("checkpoint feature version mismatch")
            model = cls(hidden=int(saved["hidden"][0]))
            for name in ("w_state", "b_state", "w_policy", "b_policy", "w_logit", "b_logit", "w_value", "b_value"):
                current = getattr(model, name)
                if saved[name].shape != current.shape:
                    raise ValueError(f"checkpoint shape mismatch: {name}")
                setattr(model, name, saved[name].copy())
        return model

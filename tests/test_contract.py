from dataclasses import replace

import pytest

from goat_agent.engine import require_legal_action
from goat_agent.model import Action, CardView, Observation, PlayerView, PublicState
from goat_agent.replay import Decision, write_jsonl


def make_observation() -> Observation:
    empty = PlayerView(8000, 35, 5, (), (), (), ())
    state = PublicState(1, 0, "draw", 0, 0, (empty, empty))
    return Observation(0, state, (1, 2, 3, 4, 5), (Action("draw", "draw", "Draw"),))


def test_face_down_identity_cannot_leak() -> None:
    with pytest.raises(ValueError, match="hidden"):
        CardView("c1", "monster", False, 123)


def test_action_ids_are_unique() -> None:
    observation = make_observation()
    with pytest.raises(ValueError, match="unique"):
        replace(observation, legal_actions=observation.legal_actions * 2)


def test_illegal_action_is_rejected() -> None:
    with pytest.raises(ValueError, match="illegal action"):
        require_legal_action(make_observation(), "summon")


def test_replay_output_contains_only_observation(tmp_path) -> None:
    path = tmp_path / "duel.jsonl"
    write_jsonl(path, [Decision(make_observation(), "draw")])
    data = path.read_text()
    assert '"own_hand":[1,2,3,4,5]' in data
    assert '"action_id":"draw"' in data


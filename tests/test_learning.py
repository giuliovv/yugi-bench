from dataclasses import replace

import numpy as np

from goat_agent.learning import Example, TinyPolicyValue, action_features, state_features
from goat_agent.model import Action, CardView, Observation, PlayerView, PublicState


def observation() -> Observation:
    own = PlayerView(8000, 35, 5, (), (), (), ())
    opponent = PlayerView(8000, 35, 5, (), (), (CardView("hidden", "monster:0", False),), ())
    public = PublicState(1, 0, "main1", 0, 0, (own, opponent))
    actions = (Action("0", "normal_summon", "Summon Magician of Faith", (123,)),
               Action("1", "end_turn", "End turn"))
    return Observation(0, public, (123, 456), actions, (("mine", 789),))


def test_features_ignore_legal_action_ids_and_hidden_card_identity() -> None:
    obs = observation()
    changed = replace(obs, legal_actions=tuple(replace(a, id="different" + a.id)
                                               for a in obs.legal_actions))
    np.testing.assert_array_equal(state_features(obs), state_features(changed))
    np.testing.assert_array_equal(action_features(obs.legal_actions), action_features(changed.legal_actions))
    assert not np.array_equal(action_features(obs.legal_actions)[0],
                              action_features((replace(obs.legal_actions[0], card_ids=(456,)),))[0])
    assert state_features(obs).dtype == np.float32


def test_policy_value_update_and_checkpoint(tmp_path) -> None:
    obs = observation()
    state = state_features(obs)
    actions = action_features(obs.legal_actions)
    model = TinyPolicyValue(seed=3, hidden=16)
    before, value = model.forward(state, actions)
    assert np.isclose(before.sum(), 1)
    assert -1 <= value <= 1
    example = Example(state, actions, 0, 0)
    for _ in range(20):
        model.update(example, 1.0, imitation=True)
    after, _ = model.forward(state, actions)
    assert after[0] > before[0]
    _, before_value = model.forward(state, actions)
    for _ in range(20):
        model.update(example, 1.0)
    _, after_value = model.forward(state, actions)
    assert after_value > before_value
    model.update(example, -1.0)
    path = tmp_path / "model.npz"
    model.save(path)
    loaded = TinyPolicyValue.load(path)
    np.testing.assert_allclose(loaded.forward(state, actions)[0], model.forward(state, actions)[0])
    assert loaded.choose(obs, np.random.default_rng(1), sample=False) in (0, 1)

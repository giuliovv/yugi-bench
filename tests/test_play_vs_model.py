from examples.play_vs_model import card_name, render_observation
from goat_agent.model import Action, CardView, Observation, PlayerView, PublicState


def test_human_view_masks_opponent_sets_but_names_own_cards() -> None:
    names = {"101": ["Own card", ""], "202": ["Opponent secret", ""]}
    own = PlayerView(8000, 35, 1, (), (), (), (CardView("ours", "spell:0", False),))
    other = PlayerView(7000, 34, 1, (), (), (), (CardView("theirs", "spell:0", False),))
    obs = Observation(0, PublicState(2, 0, "main1", 0, 0, (own, other)),
                      (101,), (Action("a", "end_turn", "End turn"),), (("ours", 101),))
    rendered = render_observation(obs, names, 0)
    assert "Your hand: Own card" in rendered
    assert "Your spells/traps: Own card" in rendered
    assert "Opponent spells/traps: face-down card" in rendered
    assert "Opponent secret" not in rendered
    assert card_name(999, names) == "card #999"

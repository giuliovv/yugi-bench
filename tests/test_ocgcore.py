import json
from pathlib import Path

import pytest

from goat_agent.ocgcore import OcgcoreGoatEngine


ROOT = Path(__file__).resolve().parents[1]
VENDOR = ROOT / "vendor" / "goat-format-simulator" / "engine"
DECK = tuple(json.loads((VENDOR / "browser/out/deck.json").read_text())["deck"])
TOURNAMENT = json.loads((VENDOR / "data/mazos.json").read_text())[0]


def test_goat_opening_draw_and_hidden_hand() -> None:
    with OcgcoreGoatEngine() as engine:
        observation = engine.reset(42, (DECK, DECK))
        assert observation.public.turn == 1
        assert observation.public.phase == "main1"
        assert len(observation.own_hand) == 6
        assert observation.public.players[0].hand_count == 6
        assert observation.public.players[1].hand_count == 5
        assert not hasattr(observation.public.players[1], "hand")
        assert observation.legal_actions
        assert any(action.card_ids and action.card_ids[0] in DECK
                   for action in observation.legal_actions)


def test_deterministic_reset_and_legal_action() -> None:
    with OcgcoreGoatEngine() as engine:
        first = engine.reset(5, (DECK, DECK))
        second = engine.reset(5, (DECK, DECK))
        assert first == second
        with pytest.raises(ValueError, match="illegal action"):
            engine.step("not-an-action")
        action = next(a for a in second.legal_actions if a.kind == "end_turn")
        result = engine.step(action.id)
        assert result.observation.public.turn >= 1


def test_goat_deck_limits_rejected() -> None:
    with OcgcoreGoatEngine() as engine:
        with pytest.raises(ValueError, match="too many copies"):
            engine.reset(1, ((DECK[0],) * 40, DECK))
        with pytest.raises(ValueError, match="40-60"):
            engine.reset(1, (DECK[:39], DECK))


def test_goat_tournament_fusion_deck() -> None:
    main = tuple(TOURNAMENT["main"])
    extra = tuple(TOURNAMENT["extra"])
    with OcgcoreGoatEngine() as engine:
        observation = engine.reset(8, (main, main), (extra, extra))
        assert observation.own_extra == extra
        assert len(observation.own_hand) == 6


def test_set_card_is_private_to_owner() -> None:
    with OcgcoreGoatEngine() as engine:
        observation = engine.reset(42, (DECK, DECK))
        set_action = next(a for a in observation.legal_actions if a.kind == "set_spell_trap")
        result = engine.step(set_action.id)
        assert result.observation.legal_actions[0].kind == "automatic_choice"
        result = engine.step(result.observation.legal_actions[0].id)
        observation = result.observation
        assert observation.own_face_down
        uid, code = observation.own_face_down[0]
        visible = [card for card in observation.public.players[0].spells_traps if card.instance_id == uid]
        assert len(visible) == 1
        assert visible[0].card_id is None
        assert code in DECK

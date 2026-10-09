import json

import pytest

from touchline_analytics.physics.build import LITERATURE_E, MIN_BOUNCES, GuardError, check_guards, engine_block, restitution_or_fallback, sync_params, write
from touchline_analytics.physics.stats import Constant


def _fit(**over) -> dict:
    c = lambda v, n=500: {"value": v, "ci95": [v * 0.9, v * 1.1], "unit": "", "n": n, "source": "idsse"}  # noqa: E731
    pct = lambda m: {"p10": m * 0.9, "p25": m * 0.95, "p50": m, "p75": m * 1.05, "p90": m * 1.1, "n": 10}  # noqa: E731
    fit = {
        "ball": {"drag": c(0.015), "restitution": c(0.74), "bounce_friction": c(0.23), "skid_friction": c(0.37), "roll_c0": c(0.48), "roll_c1": c(0.13), "ramp_m": 6.4},
        "players": {
            "a0": {g: pct(8.4) for g in ("GK", "DEF", "MID", "FWD")},
            "s0": {g: pct(9.0) for g in ("GK", "DEF", "MID", "FWD")},
            "braking": c(6.0),
            "lateral": c(3.8),
            "reaction": c(0.2),
        },
    }
    for path, v in over.items():
        sec, key = path.split(".")
        fit[sec][key] = v
    return fit


def test_guards_pass_for_physical_values():
    check_guards(_fit())


@pytest.mark.parametrize(
    "path,value,needle",
    [
        ("ball.restitution", {"value": 0.95, "ci95": [0.9, 1.0], "n": 300}, "restitution"),
        ("ball.bounce_friction", {"value": 0.05, "ci95": [0.04, 0.06], "n": 300}, "bounce_friction"),
        ("ball.ramp_m", 1.7, "ramp"),
        ("players.braking", {"value": 15.0, "ci95": [14, 16], "n": 40}, "braking"),
        ("players.reaction", {"value": 0.8, "ci95": [0.7, 0.9], "n": 600}, "reaction"),
    ],
)
def test_guards_name_every_constant_out_of_its_physical_range(path, value, needle):
    with pytest.raises(GuardError, match=needle):
        check_guards(_fit(**{path: value}))


def test_guard_on_player_profiles_checks_every_group():
    fit = _fit()
    fit["players"]["s0"]["GK"]["p50"] = 12.5
    with pytest.raises(GuardError, match="s0.GK"):
        check_guards(fit)


def test_restitution_falls_back_to_the_certified_value_with_too_few_bounces_or_a_wide_interval():
    few = Constant(0.71, 0.6, 0.8, MIN_BOUNCES - 1)
    out = restitution_or_fallback(few)
    assert out.value == LITERATURE_E and out.source == "literature" and out.n == MIN_BOUNCES - 1
    many = Constant(0.71, 0.7, 0.72, MIN_BOUNCES)
    assert restitution_or_fallback(many) is many
    vague = Constant(0.71, 0.6, 0.85, 5 * MIN_BOUNCES)
    assert restitution_or_fallback(vague).source == "literature"


def test_keepers_may_be_slower_than_outfielders():
    fit = _fit()
    fit["players"]["s0"]["GK"]["p50"] = 7.3
    check_guards(fit)


def test_engine_block_holds_what_the_engine_reads():
    e = engine_block(_fit())
    assert e["ball"] == {"drag": 0.015, "restitution": 0.74, "bounceFriction": 0.23, "skidFriction": 0.37, "rollC0": 0.48, "rollC1": 0.13}
    assert e["players"]["a0"]["MID"] == [7.56, 7.98, 8.4, 8.82, 9.24]
    assert e["players"]["brake"] == 6.0 and e["players"]["lateral"] == 3.8 and e["players"]["reactionS"] == 0.2


def test_sync_params_replaces_only_the_physics_block(tmp_path):
    params = tmp_path / "touchline-params.json"
    params.write_text(json.dumps({"provenance": {"version": "x"}, "ball": {"drag": 0.013}, "physics": {"old": 1}}, indent=1) + "\n")
    sync_params(params, {"ball": {"drag": 0.015}})
    got = json.loads(params.read_text())
    assert got == {"provenance": {"version": "x"}, "ball": {"drag": 0.013}, "physics": {"ball": {"drag": 0.015}}}


def test_nothing_is_written_when_a_guard_fails(tmp_path):
    out = tmp_path / "physics.json"
    params = tmp_path / "touchline-params.json"
    params.write_text("{}\n")
    with pytest.raises(GuardError):
        write({"fit": _fit(**{"ball.ramp_m": 1.7})}, out, params)
    assert not out.exists() and params.read_text() == "{}\n"
    write({"fit": _fit()}, out, params)
    assert json.loads(out.read_text())["engine"] == engine_block(_fit())
    assert json.loads(params.read_text())["physics"] == engine_block(_fit())

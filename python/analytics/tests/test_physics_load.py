import math

import numpy as np

from touchline_analytics.physics.load import FPS, kick_events, load_match, parse_positions, smooth

POSITIONS = """<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<PutDataRequest>
<Positions EventTime="2022-10-15T11:01:29.320+00:00">
<FrameSet GameSection="firstHalf" MatchId="DFL-MAT-X" TeamId="DFL-CLU-A" PersonId="DFL-OBJ-P1">
<Frame N="10000" T="2022-10-15T11:01:29.320+00:00" X="1.00" Y="2.00" D="0.00" S="0.00" A="0.00" M="1"/>
<Frame N="10001" T="2022-10-15T11:01:29.360+00:00" X="1.20" Y="2.00" D="0.00" S="0.00" A="0.00" M="1"/>
<Frame N="10002" T="2022-10-15T11:01:29.400+00:00" X="1.40" Y="2.00" D="0.00" S="0.00" A="0.00" M="1"/>
</FrameSet>
<FrameSet GameSection="firstHalf" MatchId="DFL-MAT-X" TeamId="DFL-CLU-B" PersonId="DFL-OBJ-P2">
<Frame N="10001" T="2022-10-15T11:01:29.360+00:00" X="-5.00" Y="0.00" D="0.00" S="0.00" A="0.00" M="1"/>
<Frame N="10002" T="2022-10-15T11:01:29.400+00:00" X="-5.00" Y="0.50" D="0.00" S="0.00" A="0.00" M="1"/>
</FrameSet>
<FrameSet GameSection="firstHalf" MatchId="DFL-MAT-X" TeamId="BALL" PersonId="DFL-OBJ-B">
<Frame N="10000" T="2022-10-15T11:01:29.320+00:00" X="0.00" Y="0.00" Z="0.11" D="0.00" S="0.00" A="0.00" M="1" BallPossession="1" BallStatus="0"/>
<Frame N="10001" T="2022-10-15T11:01:29.360+00:00" X="0.40" Y="0.00" Z="0.30" D="0.00" S="0.00" A="0.00" M="1" BallPossession="1" BallStatus="1"/>
<Frame N="10002" T="2022-10-15T11:01:29.400+00:00" X="0.80" Y="0.00" Z="0.50" D="0.00" S="0.00" A="0.00" M="1" BallPossession="2" BallStatus="1"/>
</FrameSet>
<FrameSet GameSection="secondHalf" MatchId="DFL-MAT-X" TeamId="DFL-CLU-A" PersonId="DFL-OBJ-P1">
<Frame N="100000" T="2022-10-15T12:05:00.000+00:00" X="3.00" Y="4.00" D="0.00" S="0.00" A="0.00" M="1"/>
</FrameSet>
<FrameSet GameSection="secondHalf" MatchId="DFL-MAT-X" TeamId="BALL" PersonId="DFL-OBJ-B">
<Frame N="100000" T="2022-10-15T12:05:00.000+00:00" X="0.00" Y="0.00" Z="0.11" D="0.00" S="0.00" A="0.00" M="1" BallPossession="1" BallStatus="1"/>
</FrameSet>
</Positions>
</PutDataRequest>
"""

EVENTS = """<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<PutDataRequest>
<Event EventId="1" X-Position="52.50" EventTime="2022-10-15T13:01:29.400+02:00" Y-Position="34.00" MatchId="DFL-MAT-X">
 <KickOff GameSection="firstHalf">
  <Play Team="DFL-CLU-A" Evaluation="successfullyCompleted" Player="DFL-OBJ-P1">
   <Pass/>
  </Play>
 </KickOff>
</Event>
<Event EventId="2" EventTime="2022-10-15T13:01:30.000+02:00" MatchId="DFL-MAT-X">
 <ShotAtGoal Team="DFL-CLU-B" Player="DFL-OBJ-P2">
  <ShotWide/>
 </ShotAtGoal>
</Event>
<Event EventId="3" EventTime="2022-10-15T13:01:31.000+02:00" MatchId="DFL-MAT-X">
 <Foul Fouler="DFL-OBJ-P2"/>
</Event>
</PutDataRequest>
"""


def test_parse_positions_aligns_players_and_ball_by_frame(tmp_path):
    f = tmp_path / "pos.xml"
    f.write_text(POSITIONS)
    halves = parse_positions(f)
    assert [h.period for h in halves] == [1, 2]
    first = halves[0]
    assert first.n0 == 10000 and len(first.ball) == 3
    assert np.allclose(first.ball[:, 2], [0.11, 0.30, 0.50])
    assert first.live.tolist() == [False, True, True]
    assert first.teams == {"DFL-OBJ-P1": "DFL-CLU-A", "DFL-OBJ-P2": "DFL-CLU-B"}
    p2 = first.players["DFL-OBJ-P2"]
    assert math.isnan(p2[0, 0]) and p2[2].tolist() == [-5.0, 0.5]
    assert first.t0 == 1665831689.32
    assert halves[1].players["DFL-OBJ-P1"].tolist() == [[3.0, 4.0]]


def test_load_match_caches_parsed_halves(tmp_path):
    f = tmp_path / "pos.xml"
    f.write_text(POSITIONS)
    cache = tmp_path / "cache"
    a = load_match(f, cache / "X.npz")
    assert (cache / "X.npz").exists()
    f.write_text("not xml any more")  # a second load must come from the cache
    b = load_match(f, cache / "X.npz")
    assert [h.period for h in b] == [1, 2]
    assert np.allclose(b[0].ball, a[0].ball) and b[0].teams == a[0].teams and b[0].t0 == a[0].t0
    assert np.array_equal(np.isnan(b[0].players["DFL-OBJ-P2"]), np.isnan(a[0].players["DFL-OBJ-P2"]))


def test_kick_events_reads_plays_and_shots_with_utc_times(tmp_path):
    f = tmp_path / "ev.xml"
    f.write_text(EVENTS)
    ev = kick_events(f)
    assert [(e.kind, e.player) for e in ev] == [("pass", "DFL-OBJ-P1"), ("shot", "DFL-OBJ-P2")]
    assert ev[0].time == 1665831689.4  # 13:01:29.4 at +02:00 is 11:01:29.4 UTC


def test_smooth_recovers_velocity_and_acceleration_of_a_parabola():
    t = np.arange(100) / FPS
    x = 2.0 * t + 1.5 * t * t
    pos, vel, acc = smooth(np.stack([x, np.zeros_like(x)], axis=1))
    assert np.allclose(pos[:, 0], x, atol=1e-9)
    assert np.allclose(vel[10:-10, 0], 2.0 + 3.0 * t[10:-10], atol=1e-6)
    assert np.allclose(acc[10:-10, 0], 3.0, atol=1e-6)


def test_smooth_keeps_gaps_and_skips_runs_shorter_than_the_window():
    x = np.arange(40, dtype=float)
    x[10] = np.nan  # one missing frame splits the series
    x[30:] = np.nan
    pos, vel, _ = smooth(np.stack([x, x], axis=1))
    assert np.isnan(pos[10, 0]) and np.isnan(vel[30:, 0]).all()
    assert not np.isnan(vel[:10]).any()  # the 10-frame run is long enough for the 7-frame window
    assert np.allclose(vel[12:28, 0], FPS)

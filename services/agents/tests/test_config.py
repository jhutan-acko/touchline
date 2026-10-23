import pytest

from touchline_agents.config import DEFAULT_MODEL, SettingsError, load_settings, read_env_file


def test_defaults_to_the_stub_with_one_model_for_both_tiers():
    s = load_settings({}, env_file=None)
    assert s.provider == "stub"
    assert s.model("small") == s.model("large") == DEFAULT_MODEL == "gpt-6.1-sol"
    assert s.model_label == "stub"
    assert s.mcp_allowed_hosts == {"127.0.0.1", "localhost", "::1"}


def test_fast_tier_model():
    assert load_settings({}, env_file=None).model("fast") == "gpt-5.4-mini"
    assert load_settings({"TOUCHLINE_MODEL_FAST": "tiny-1"}, env_file=None).model("fast") == "tiny-1"


def test_openai_needs_a_key():
    with pytest.raises(SettingsError, match="OPENAI_API_KEY"):
        load_settings({"TOUCHLINE_LLM": "openai"}, env_file=None)


def test_key_from_env_file_never_shows_in_repr(tmp_path):
    f = tmp_path / ".env.local"
    f.write_text("# local secrets\nexport OPENAI_API_KEY='sk-test-123'\n\nTOUCHLINE_LLM=openai\n")
    s = load_settings({}, env_file=f)
    assert s.provider == "openai" and s.openai_api_key == "sk-test-123"
    assert "sk-test" not in repr(s)
    assert s.model_label == "openai:gpt-6.1-sol"


def test_environment_wins_over_env_file(tmp_path):
    f = tmp_path / ".env.local"
    f.write_text("TOUCHLINE_MODEL_LARGE=from-file\nTOUCHLINE_MODEL_SMALL=small-file\n")
    s = load_settings({"TOUCHLINE_MODEL_LARGE": "from-env"}, env_file=f)
    assert (s.small_model, s.large_model) == ("small-file", "from-env")
    assert s.model_label == "stub"


def test_rejects_unknown_provider_and_bad_scale():
    with pytest.raises(SettingsError, match="stub"):
        load_settings({"TOUCHLINE_LLM": "llama"}, env_file=None)
    with pytest.raises(SettingsError, match="positive"):
        load_settings({"TOUCHLINE_TIMEOUT_SCALE": "0"}, env_file=None)
    with pytest.raises(SettingsError, match="number"):
        load_settings({"TOUCHLINE_TIMEOUT_SCALE": "fast"}, env_file=None)


def test_reasoning_effort():
    assert load_settings({}, env_file=None).reasoning_effort == "low"
    assert load_settings({"TOUCHLINE_REASONING": "high"}, env_file=None).reasoning_effort == "high"
    with pytest.raises(SettingsError, match="low, medium or high"):
        load_settings({"TOUCHLINE_REASONING": "none"}, env_file=None)


def test_timeouts_scale():
    s = load_settings({"TOUCHLINE_TIMEOUT_SCALE": "2.5"}, env_file=None)
    assert s.timeout("narrator") == 7.5


def test_missing_env_file_is_empty(tmp_path):
    assert read_env_file(tmp_path / "nope") == {}

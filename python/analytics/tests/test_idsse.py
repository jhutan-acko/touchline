import hashlib
import io

import pytest

from touchline_analytics import idsse


def _serve(monkeypatch, payload: bytes):
    monkeypatch.setattr(idsse.urllib.request, "urlopen", lambda url, timeout=0: io.BytesIO(payload))


def _one_file(monkeypatch, name: str, payload: bytes):
    monkeypatch.setattr(idsse, "filenames", lambda match_id: {"meta": name})
    monkeypatch.setitem(idsse.SHA256, name, hashlib.sha256(payload).hexdigest())


def test_download_replaces_a_corrupt_file(tmp_path, monkeypatch):
    _one_file(monkeypatch, "m.xml", b"good")
    (tmp_path / "m.xml").write_bytes(b"truncated")
    _serve(monkeypatch, b"good")
    idsse.download("J03WMX", tmp_path)
    assert (tmp_path / "m.xml").read_bytes() == b"good"


def test_download_keeps_a_verified_file_without_fetching(tmp_path, monkeypatch):
    _one_file(monkeypatch, "m.xml", b"good")
    (tmp_path / "m.xml").write_bytes(b"good")
    monkeypatch.setattr(idsse.urllib.request, "urlopen", lambda *a, **k: pytest.fail("should not fetch"))
    idsse.download("J03WMX", tmp_path)


def test_download_rejects_a_payload_that_does_not_match_its_checksum(tmp_path, monkeypatch):
    _one_file(monkeypatch, "m.xml", b"good")
    _serve(monkeypatch, b"tampered")
    with pytest.raises(ValueError, match="checksum"):
        idsse.download("J03WMX", tmp_path)
    assert not (tmp_path / "m.xml").exists()
    assert not (tmp_path / "m.part").exists()


def test_every_file_has_a_checksum():
    # The stats models (stats_models.py) are fitted on every match's tracking.
    for match_id in idsse.MATCHES:
        for name in idsse.filenames(match_id).values():
            assert name in idsse.SHA256, name

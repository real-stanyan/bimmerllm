"""Sanity checks on CHASSIS_MAP — wrong values silently corrupt every uploaded record."""
import re

import pytest

from ingest.config import CHASSIS_MAP, USER_AGENT, VALID_SERIES


VALID_CHASSIS_KEYS = {"g80", "f80", "g87", "f87", "g90", "f90", "f92"}


def test_all_expected_chassis_present():
    assert set(CHASSIS_MAP.keys()) == VALID_CHASSIS_KEYS


@pytest.mark.parametrize("chassis", sorted(VALID_CHASSIS_KEYS))
def test_chassis_entry_well_formed(chassis: str):
    cfg = CHASSIS_MAP[chassis]
    assert set(cfg.keys()) == {"subdomain", "models", "engines", "series"}
    assert isinstance(cfg["subdomain"], str)
    assert cfg["subdomain"] == f"{chassis}.bimmerpost.com"
    assert isinstance(cfg["models"], list) and cfg["models"]
    assert all(re.fullmatch(r"[A-Z]\d{2,3}", m) for m in cfg["models"])
    assert isinstance(cfg["engines"], list) and cfg["engines"]
    assert all(re.fullmatch(r"[A-Z]\d{2,3}", e) for e in cfg["engines"])
    assert cfg["series"] in VALID_SERIES


def test_user_agent_is_real_chrome_ua():
    assert "Chrome/" in USER_AGENT
    assert "Mozilla/5.0" in USER_AGENT


def test_no_duplicate_subdomains():
    subdomains = [c["subdomain"] for c in CHASSIS_MAP.values()]
    assert len(subdomains) == len(set(subdomains))

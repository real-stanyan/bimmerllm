"""Discover stage: crawl chassis subdomain root, populate forums table."""
from __future__ import annotations

import logging
import re
import sqlite3
from typing import Iterable, Protocol

from ..config import CHASSIS_MAP, CHASSIS_RELATIVE_CATEGORIES
from ..db import insert_forum
from ..parse import parse_forum_index


logger = logging.getLogger(__name__)


# Every BMW chassis code that might appear as a category marker — used to detect
# foreign-chassis bleed (e.g. G42 / G20 forums embedded in g87 subdomain index).
# When a category contains a foreign chassis code that is NOT in our cfg["models"],
# we treat it as a non-relevant section.
_KNOWN_CHASSIS_CODES = {
    "E30", "E36", "E46", "E60", "E61", "E63", "E64", "E70", "E71", "E81", "E82", "E83",
    "E84", "E85", "E86", "E88", "E89", "E90", "E91", "E92", "E93",
    "F01", "F02", "F06", "F07", "F10", "F11", "F12", "F13", "F15", "F16", "F20", "F21",
    "F22", "F23", "F25", "F26", "F30", "F31", "F32", "F33", "F34", "F35", "F36", "F39",
    "F40", "F44", "F45", "F46", "F48", "F49", "F52",
    "F80", "F82", "F83", "F87", "F90", "F91", "F92", "F93", "F95", "F96", "F97", "F98",
    "G01", "G02", "G05", "G06", "G07", "G08", "G09",
    "G11", "G12", "G14", "G15", "G16", "G20", "G21", "G22", "G23", "G24", "G26", "G28",
    "G29", "G30", "G31", "G32", "G38", "G42", "G43", "G45",
    "G60", "G61", "G68", "G70",
    "G80", "G81", "G82", "G83", "G87", "G88", "G90", "G91", "G99",
}

_CHASSIS_CODE_RE = re.compile(r"\b([EFG]\d{2,3})\b", re.IGNORECASE)


class FetcherProto(Protocol):
    def get(self, url: str) -> str: ...


def is_chassis_relevant(parent_category: str, name: str, cfg: dict) -> bool:
    """Decide whether a discovered forum belongs to this chassis.

    Rules (default-deny):
      1. If the category itself names one of our model codes (e.g. 'G80 BMW M3...'),
         keep — those are the chassis-specific top sections.
      2. If the category names a foreign chassis (e.g. 'G42 2-Series General Topics'
         while we're crawling g87), drop — that's a neighbor-chassis bleed.
      3. If the category is in the chassis-relative shared set
         ('Technical Sections', 'Classifieds'), keep — those are chassis-specific
         under the local subdomain even though their names don't carry chassis tags.
      4. If the forum name itself contains a model code or M-letter (e.g.
         'BMW M2 Forums 2023+ (G87)'), keep — handles index-page top-level
         chassis-specific link nodes that have no enclosing category sibling.
      5. Otherwise drop. This catches 'BIMMERPOST Universal Forums' children,
         'Off-Topic Discussions Board', 'Watches', 'Sim Racing', etc.
    """
    own_models = set(cfg["models"])
    own_letters = set(cfg["m_letter"])
    own_markers = own_models | own_letters

    cat = parent_category or ""
    nm = name or ""

    cat_codes = {c.upper() for c in _CHASSIS_CODE_RE.findall(cat)}
    nm_codes = {c.upper() for c in _CHASSIS_CODE_RE.findall(nm)}

    foreign_codes_in_cat = (cat_codes & _KNOWN_CHASSIS_CODES) - own_models
    foreign_codes_in_name = (nm_codes & _KNOWN_CHASSIS_CODES) - own_models

    # Drop on any foreign-chassis bleed first — even chassis-relative categories
    # don't override an explicit foreign chassis tag in the forum name.
    if foreign_codes_in_cat or foreign_codes_in_name:
        return False

    # Keep on own chassis match in category or name
    if (cat_codes | nm_codes) & own_models:
        return True

    # Keep chassis-relative shared sections (Technical Sections, Classifieds)
    if cat in CHASSIS_RELATIVE_CATEGORIES:
        return True

    # Fallback: name carries our M-letter token (M2/M3/...) — covers names like
    # 'BMW M2 Forums 2023+' where the model code wasn't matched but the M-letter is
    nm_tokens = set(re.split(r"[\s/(),]+", nm.upper()))
    if nm_tokens & {l.upper() for l in own_letters}:
        return True

    return False


def run(conn: sqlite3.Connection, chassis_keys: Iterable[str], fetcher: FetcherProto) -> None:
    """For each chassis, fetch index.php and insert chassis-relevant sub-forums."""
    for chassis in chassis_keys:
        if chassis not in CHASSIS_MAP:
            raise KeyError(f"unknown chassis '{chassis}' (not in CHASSIS_MAP)")
        cfg = CHASSIS_MAP[chassis]
        url = f"https://{cfg['subdomain']}/forums/index.php"
        logger.info("[discover] fetching %s", url)
        html = fetcher.get(url)
        nodes = parse_forum_index(html, chassis=chassis)

        kept = []
        skipped = []
        for n in nodes:
            if is_chassis_relevant(n["parent_category"], n["name"], cfg):
                kept.append(n)
            else:
                skipped.append(n)

        logger.info("[discover] %s — parsed=%d kept=%d skipped=%d",
                    chassis, len(nodes), len(kept), len(skipped))
        if skipped:
            sample = ", ".join(f"{n['name']!r}<{n['parent_category']!r}>" for n in skipped[:5])
            logger.debug("[discover] %s skipped sample: %s", chassis, sample)

        for n in kept:
            insert_forum(
                conn,
                chassis=chassis,
                forum_id=n["forum_id"],
                name=n["name"],
                parent_forum_id=n["parent_forum_id"],
                url=n["url"],
                threads_total=None,
            )

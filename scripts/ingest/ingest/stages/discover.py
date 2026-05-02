"""Discover stage: crawl chassis subdomain root, populate forums table."""
from __future__ import annotations

import logging
import sqlite3
from typing import Iterable, Protocol

from ..config import CHASSIS_MAP
from ..db import insert_forum
from ..parse import parse_forum_index


logger = logging.getLogger(__name__)


class FetcherProto(Protocol):
    def get(self, url: str) -> str: ...


def run(conn: sqlite3.Connection, chassis_keys: Iterable[str], fetcher: FetcherProto) -> None:
    """For each chassis, fetch index.php and insert all sub-forums into the forums table."""
    for chassis in chassis_keys:
        if chassis not in CHASSIS_MAP:
            raise KeyError(f"unknown chassis '{chassis}' (not in CHASSIS_MAP)")
        cfg = CHASSIS_MAP[chassis]
        url = f"https://{cfg['subdomain']}/forums/index.php"
        logger.info("[discover] fetching %s", url)
        html = fetcher.get(url)
        nodes = parse_forum_index(html, chassis=chassis)
        logger.info("[discover] %s — %d sub-forums", chassis, len(nodes))
        for n in nodes:
            insert_forum(
                conn,
                chassis=chassis,
                forum_id=n["forum_id"],
                name=n["name"],
                parent_forum_id=n["parent_forum_id"],
                url=n["url"],
                threads_total=None,
            )

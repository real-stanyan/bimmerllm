"""bs4 parsers for vBulletin 3.8.11 (bimmerpost.com).

All parsers are pure functions of (html: str) → structured dict/list.
No IO, no network — fixture-testable.
"""
from __future__ import annotations

import re
from typing import TypedDict
from urllib.parse import urljoin

from bs4 import BeautifulSoup


class ForumNode(TypedDict):
    forum_id: int
    name: str
    parent_forum_id: int | None
    url: str


_FORUM_HREF_RE = re.compile(r"forumdisplay\.php\?(?:[^\"']*&)?f=(\d+)")


def parse_forum_index(html: str, chassis: str) -> list[ForumNode]:
    """Walk a chassis subdomain root index.php, extract every sub-forum link.

    Returns a flat list of forum nodes. Parent-child nesting is left as None
    in V1; the listing/fetch stages don't need it. Only the forum_id and
    URL are load-bearing for downstream stages.
    """
    soup = BeautifulSoup(html, "lxml")
    base_url = f"https://{chassis}.bimmerpost.com/forums/"

    seen: dict[int, ForumNode] = {}
    for a in soup.find_all("a", href=True):
        href = a["href"]
        m = _FORUM_HREF_RE.search(href)
        if not m:
            continue
        forum_id = int(m.group(1))
        name = a.get_text(strip=True)
        if not name:
            continue
        if forum_id in seen:
            # keep the first occurrence; later ones are usually breadcrumbs
            continue
        absolute = urljoin(base_url, href) if not href.startswith("http") else href
        seen[forum_id] = ForumNode(
            forum_id=forum_id,
            name=name,
            parent_forum_id=None,
            url=absolute,
        )
    return list(seen.values())

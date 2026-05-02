"""bs4 parsers for vBulletin 3.8.11 (bimmerpost.com).

All parsers are pure functions of (html: str) → structured dict/list.
No IO, no network — fixture-testable.
"""
from __future__ import annotations

import datetime as _dt
import re
from typing import TypedDict
from urllib.parse import urljoin

from bs4 import BeautifulSoup
from dateutil import parser as _date_parser


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


class ThreadMeta(TypedDict):
    thread_id: int
    title: str
    url: str
    replies: int | None
    views: int | None
    last_post_at: str | None
    is_sticky: int


class ForumPage(TypedDict):
    threads: list[ThreadMeta]
    total_pages: int
    has_next: bool


_THREAD_HREF_RE = re.compile(r"showthread\.php\?(?:[^\"']*&)?t=(\d+)")
_PAGE_RE = re.compile(r"page=(\d+)")
_THREAD_TITLE_ID_RE = re.compile(r"^thread_title_(\d+)$")
_TD_THREADTITLE_ID_RE = re.compile(r"^td_threadtitle_(\d+)$")


def _normalize_vbulletin_date(text: str) -> str | None:
    """vBulletin shows: 'Today, 10:23 AM', 'Yesterday, 04:55 PM', or 'MM-DD-YYYY, HH:MM AM/PM'.

    The bimmerpost theme also renders without a comma: 'Today 10:23 AM'.
    Return ISO 8601 UTC or None.
    """
    text = text.strip()
    if not text:
        return None
    today = _dt.datetime.now(_dt.timezone.utc).date()
    try:
        lower = text.lower()
        if lower.startswith("today"):
            # split on comma OR whitespace after the keyword
            rest = text[len("today"):].lstrip(", ").strip()
            time_part = rest if rest else "00:00"
            t = _date_parser.parse(time_part).time()
            return _dt.datetime.combine(today, t, _dt.timezone.utc).isoformat()
        if lower.startswith("yesterday"):
            rest = text[len("yesterday"):].lstrip(", ").strip()
            time_part = rest if rest else "00:00"
            t = _date_parser.parse(time_part).time()
            return _dt.datetime.combine(today - _dt.timedelta(days=1), t, _dt.timezone.utc).isoformat()
        # absolute date e.g. "01-15-2026, 09:12 AM"
        return _date_parser.parse(text).replace(tzinfo=_dt.timezone.utc).isoformat()
    except (ValueError, IndexError, OverflowError):
        return None


def _parse_int_loose(text: str) -> int | None:
    """vBulletin formats numbers as '1,234' or '7,392'. Strip commas + parse."""
    cleaned = re.sub(r"[^\d]", "", text or "")
    return int(cleaned) if cleaned else None


def parse_forum_listing_page(html: str, forum_id: int) -> ForumPage:
    """Parse a forumdisplay.php?f=N&page=K HTML page.

    vBulletin 3.8.11 (bimmerpost theme) structure observed in fixtures:
      Thread rows live inside <tbody id='threadbits_forum_<f>'> as plain
      <tr> elements (no per-row id). Each row contains:
        <td id='td_threadtitle_NNNN'>
          <a id='thread_title_NNNN' href='showthread.php?t=NNNN'>title</a>
        </td>
        <td class='alt2' title='Replies: X, Views: Y'>
          last-post text: 'Today <span>HH:MM AM</span>' or 'MM-DD-YYYY, ...'
        </td>
        <td align='center' class='alt1'>replies</td>
        <td align='center' class='alt2'>views</td>

      Sticky / announcement rows have a different status icon (e.g. img alt
      contains 'Sticky' or 'Announcement') and may also lack a thread_id link
      pattern; announcements use 'announcement.php?...' instead of showthread.

    The parser is chassis-agnostic: it returns hrefs as-found (typically
    relative). The caller (list_threads stage) is responsible for resolving
    them against the chassis-specific base URL.
    """
    soup = BeautifulSoup(html, "lxml")

    threads: list[ThreadMeta] = []
    seen_ids: set[int] = set()

    # Locate the thread-listing tbody. The forum_id is in the id.
    tbody = soup.find("tbody", id=f"threadbits_forum_{forum_id}")
    # Fallback: any tbody whose id starts with threadbits_forum_
    if tbody is None:
        tbody = soup.find("tbody", id=re.compile(r"^threadbits_forum_\d+$"))

    candidate_rows = tbody.find_all("tr", recursive=False) if tbody else soup.find_all("tr")

    for tr in candidate_rows:
        # Identify thread_id from a child <td id='td_threadtitle_NNN'> or
        # <a id='thread_title_NNN'> or any showthread.php?t=NNN href in the row.
        thread_id: int | None = None

        td_title = tr.find("td", id=_TD_THREADTITLE_ID_RE)
        if td_title is not None:
            m = _TD_THREADTITLE_ID_RE.match(td_title.get("id", ""))
            if m:
                thread_id = int(m.group(1))

        if thread_id is None:
            a_title = tr.find("a", id=_THREAD_TITLE_ID_RE)
            if a_title is not None:
                m = _THREAD_TITLE_ID_RE.match(a_title.get("id", ""))
                if m:
                    thread_id = int(m.group(1))

        if thread_id is None:
            # Last-resort: any showthread link in this row
            a_any = tr.find("a", href=_THREAD_HREF_RE)
            if a_any is not None:
                m = _THREAD_HREF_RE.search(a_any.get("href", ""))
                if m:
                    thread_id = int(m.group(1))

        if thread_id is None or thread_id in seen_ids:
            continue
        seen_ids.add(thread_id)

        # Title anchor
        title_a = tr.find("a", id=f"thread_title_{thread_id}")
        if title_a is None:
            title_a = tr.find(
                "a",
                href=re.compile(rf"showthread\.php\?(?:[^\"']*&)?t={thread_id}\b"),
            )
        title = title_a.get_text(strip=True) if title_a else ""

        # Return raw href as found (typically relative). Caller resolves.
        url = (
            title_a.get("href")
            if (title_a and title_a.get("href"))
            else f"showthread.php?t={thread_id}"
        )

        # Replies + views: prefer 'title' attribute on the last-post td which
        # contains 'Replies: X, Views: Y' verbatim. Fall back to scanning
        # numeric cells (skip the row's title cell which can have huge ints
        # in attributes).
        replies: int | None = None
        views: int | None = None
        for c in tr.find_all("td"):
            t_attr = c.get("title", "") or ""
            mr = re.search(r"Replies:\s*([\d,]+)", t_attr)
            mv = re.search(r"Views:\s*([\d,]+)", t_attr)
            if mr or mv:
                if mr:
                    replies = _parse_int_loose(mr.group(1))
                if mv:
                    views = _parse_int_loose(mv.group(1))
                break

        if replies is None or views is None:
            # Fallback: scan small-int td texts at align=center
            nums: list[int] = []
            for c in tr.find_all("td", align="center"):
                n = _parse_int_loose(c.get_text())
                if n is not None and n < 10_000_000:
                    nums.append(n)
            if replies is None and len(nums) >= 1:
                replies = nums[0]
            if views is None and len(nums) >= 2:
                views = nums[1]

        # Last post date: vBulletin renders the date inline with "Today" /
        # "Yesterday" / "MM-DD-YYYY" plus a <span class='time'>HH:MM AM</span>.
        # Find the cell that has 'by <a ...lastposter...>' or matches a date pattern.
        last_post_at: str | None = None
        for c in tr.find_all("td"):
            text = c.get_text(" ", strip=True)
            if not text:
                continue
            has_date = bool(re.search(r"\d{1,2}[-/]\d{1,2}[-/]\d{2,4}", text)) or bool(
                re.search(r"\b(Today|Yesterday)\b", text, re.IGNORECASE)
            )
            if not has_date:
                continue
            # Strip the "by <username> ..." trailing portion which can appear
            # on the same flattened line.
            head = re.split(r"\s+by\s+", text, maxsplit=1)[0].strip()
            last_post_at = _normalize_vbulletin_date(head)
            if last_post_at:
                break

        # Sticky detection: vBulletin marks sticky rows with an icon img whose
        # alt contains 'Sticky' (and similar for 'Announcement').
        is_sticky = 1 if tr.find("img", alt=re.compile(r"[Ss]ticky")) else 0

        threads.append(
            ThreadMeta(
                thread_id=thread_id,
                title=title,
                url=url,
                replies=replies,
                views=views,
                last_post_at=last_post_at,
                is_sticky=is_sticky,
            )
        )

    # Pagination: <div class='pagenav'> ... 'Page N of M' ...
    pagenav = soup.find("div", class_="pagenav")
    total_pages = 1
    has_next = False
    if pagenav:
        page_text = pagenav.get_text(" ", strip=True)
        m = re.search(r"Page\s+(\d+)\s+of\s+(\d+)", page_text)
        if m:
            current = int(m.group(1))
            total_pages = int(m.group(2))
            has_next = current < total_pages

    return ForumPage(threads=threads, total_pages=total_pages, has_next=has_next)

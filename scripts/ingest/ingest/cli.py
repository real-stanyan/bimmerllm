"""CLI entrypoint. Run with `python -m ingest [...]`."""
from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path

from .config import (
    CHASSIS_MAP,
    DEFAULT_BATCH_SIZE,
    DEFAULT_QPS,
    PINECONE_INDEX,
    PINECONE_NAMESPACE,
)
from .db import apply_schema, open_db
from .http import Fetcher
from .stages import discover, fetch_threads, list_threads, upload


VALID_STAGES = {"discover", "list", "fetch", "upload", "all"}
VALID_MODES = {"full", "incremental"}


def _setup_logging(log_path: Path) -> None:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler(str(log_path), mode="a", encoding="utf-8"),
        ],
    )


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="ingest", description="bimmerllm M-series crawler")
    p.add_argument("--mode", choices=sorted(VALID_MODES), default="full")
    p.add_argument("--chassis", default=",".join(CHASSIS_MAP.keys()),
                   help="comma-separated chassis keys, or 'all'")
    p.add_argument("--stage", choices=sorted(VALID_STAGES), default="all")
    p.add_argument("--max-pages", type=int, default=None,
                   help="max pages per forum (list stage). useful for PoC.")
    p.add_argument("--max-threads", type=int, default=None,
                   help="max threads to fetch in this run (fetch stage)")
    p.add_argument("--max-pages-per-thread", type=int, default=5,
                   help="cap pages fetched per thread; mega-threads marked truncated_at (default 5)")
    p.add_argument("--qps", type=float, default=DEFAULT_QPS)
    p.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    p.add_argument("--dry-run", action="store_true",
                   help="upload stage prints record JSON instead of calling Pinecone")
    p.add_argument("--db", default="data/ingest.db")
    p.add_argument("--log", default="data/ingest.log")
    p.add_argument("--browser", action="store_true",
                   help="reserved for playwright fallback (NotImplementedError in V1)")
    return p.parse_args(argv)


def _resolve_chassis(arg: str) -> list[str]:
    if arg.strip().lower() == "all":
        return list(CHASSIS_MAP.keys())
    keys = [k.strip() for k in arg.split(",") if k.strip()]
    for k in keys:
        if k not in CHASSIS_MAP:
            raise SystemExit(f"unknown chassis '{k}'. valid: {sorted(CHASSIS_MAP)}")
    return keys


def _resolve_index_namespace():
    api_key = os.environ.get("PINECONE_API_KEY")
    if not api_key:
        raise SystemExit("PINECONE_API_KEY env var not set (sourcing .env.local helps)")
    from pinecone import Pinecone
    pc = Pinecone(api_key=api_key)
    return pc.Index(PINECONE_INDEX)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.browser:
        raise NotImplementedError("--browser (playwright fallback) not implemented in V1")

    log_path = Path(args.log)
    _setup_logging(log_path)
    logger = logging.getLogger("ingest")
    logger.info("starting ingest mode=%s stage=%s chassis=%s db=%s",
                args.mode, args.stage, args.chassis, args.db)

    chassis_keys = _resolve_chassis(args.chassis)

    db_path = Path(args.db)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = open_db(db_path)
    apply_schema(conn)

    fetcher = Fetcher(qps=args.qps)
    try:
        run_discover = args.stage in {"discover", "all"}
        run_list     = args.stage in {"list", "all"}
        run_fetch    = args.stage in {"fetch", "all"}
        run_upload   = args.stage in {"upload", "all"}

        if run_discover:
            discover.run(conn, chassis_keys=chassis_keys, fetcher=fetcher)

        if run_list:
            list_threads.run(conn, chassis_keys=chassis_keys, fetcher=fetcher,
                             mode=args.mode, max_pages=args.max_pages)

        if run_fetch:
            fetch_threads.run(conn, fetcher=fetcher,
                              max_threads=args.max_threads,
                              max_pages_per_thread=args.max_pages_per_thread)

        if run_upload:
            index = None if args.dry_run else _resolve_index_namespace()
            if args.dry_run:
                # build a dummy index that captures calls — for dry-run we still need an object
                class _DryIndex:
                    def upsert_records(self, namespace, records): pass
                index = _DryIndex()
            upload.run(conn, index=index, namespace=PINECONE_NAMESPACE,
                       batch_size=args.batch_size, dry_run=args.dry_run)
    finally:
        fetcher.close()
        conn.close()

    logger.info("done")
    return 0


if __name__ == "__main__":
    sys.exit(main())

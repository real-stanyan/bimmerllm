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
from .http import Fetcher, StealthFetcher
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
    p.add_argument("--stealth", action="store_true",
                   help="enable Scrapling StealthyFetcher fallback for 403 BotChallenge "
                        "(requires `pip install -e \".[stealth]\"` and Playwright Chromium)")
    p.add_argument("--schema-version", type=int, default=1, choices=[1, 2],
                   help="upload record schema (1=thread-level legacy, 2=post-chunk Phase 2)")
    p.add_argument("--pinecone-index", default=None,
                   help="override Pinecone index name (default from config: 'bmw-datas'; "
                        "v2 ingest typically targets 'bmw-datas-v2')")
    p.add_argument("--pinecone-namespace", default=None,
                   help="override Pinecone namespace (default from config: 'bimmerpost')")
    p.add_argument("--pinecone-sparse-index", default=None,
                   help="if set, dual-write each batch to this additional sparse index "
                        "(integrated embedding model = pinecone-sparse-english-v0). "
                        "Used by v2 hybrid retrieval; the dense + sparse indexes get "
                        "the same records and embed them with their own model.")
    p.add_argument("--pinecone-sparse-namespace", default=None,
                   help="namespace for the sparse index (defaults to --pinecone-namespace)")
    return p.parse_args(argv)


def _resolve_chassis(arg: str) -> list[str]:
    if arg.strip().lower() == "all":
        return list(CHASSIS_MAP.keys())
    keys = [k.strip() for k in arg.split(",") if k.strip()]
    for k in keys:
        if k not in CHASSIS_MAP:
            raise SystemExit(f"unknown chassis '{k}'. valid: {sorted(CHASSIS_MAP)}")
    return keys


def _resolve_index_namespace(index_name: str | None = None):
    api_key = os.environ.get("PINECONE_API_KEY")
    if not api_key:
        raise SystemExit("PINECONE_API_KEY env var not set (sourcing .env.local helps)")
    from pinecone import Pinecone
    pc = Pinecone(api_key=api_key)
    return pc.Index(index_name or PINECONE_INDEX)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

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

    stealth = StealthFetcher() if args.stealth else None
    if stealth:
        logger.info("stealth fallback enabled (Scrapling StealthyFetcher, lazy-loaded on first 403)")
    fetcher = Fetcher(qps=args.qps, stealth_fallback=stealth)
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
            target_namespace = args.pinecone_namespace or PINECONE_NAMESPACE
            extra_targets = []
            if args.dry_run:
                class _DryIndex:
                    def upsert_records(self, namespace, records): pass
                index = _DryIndex()
                if args.pinecone_sparse_index:
                    extra_targets.append((_DryIndex(),
                                          args.pinecone_sparse_namespace or target_namespace))
            else:
                index = _resolve_index_namespace(args.pinecone_index)
                if args.pinecone_sparse_index:
                    sparse_index = _resolve_index_namespace(args.pinecone_sparse_index)
                    extra_targets.append((sparse_index,
                                          args.pinecone_sparse_namespace or target_namespace))
            upload.run(conn, index=index, namespace=target_namespace,
                       batch_size=args.batch_size, dry_run=args.dry_run,
                       schema_version=args.schema_version,
                       extra_targets=extra_targets or None)
    finally:
        fetcher.close()
        conn.close()

    logger.info("done")
    return 0


if __name__ == "__main__":
    sys.exit(main())

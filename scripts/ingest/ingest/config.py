"""Static config: chassis → metadata mapping, HTTP defaults."""
from typing import TypedDict


class ChassisConfig(TypedDict):
    subdomain: str
    models: list[str]
    engines: list[str]
    series: str


CHASSIS_MAP: dict[str, ChassisConfig] = {
    "g80": {"subdomain": "g80.bimmerpost.com", "models": ["G80", "G82", "G83"], "engines": ["S58"], "series": "3/4 Series"},
    "f80": {"subdomain": "f80.bimmerpost.com", "models": ["F80", "F82", "F83"], "engines": ["S55"], "series": "3/4 Series"},
    "g87": {"subdomain": "g87.bimmerpost.com", "models": ["G87"],                "engines": ["S58"], "series": "2 Series"},
    "f87": {"subdomain": "f87.bimmerpost.com", "models": ["F87"],                "engines": ["N55", "S55"], "series": "2 Series"},
    "g90": {"subdomain": "g90.bimmerpost.com", "models": ["G90", "G99"],         "engines": ["S68"], "series": "5 Series"},
    "f90": {"subdomain": "f90.bimmerpost.com", "models": ["F90"],                "engines": ["S63"], "series": "5 Series"},
    "f92": {"subdomain": "f92.bimmerpost.com", "models": ["F92", "F93", "F91"],  "engines": ["S63"], "series": "8 Series"},
}

VALID_SERIES = {"2 Series", "3/4 Series", "5 Series", "8 Series"}

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

DEFAULT_QPS = 1.0
DEFAULT_JITTER_SEC = 0.3
DEFAULT_BATCH_SIZE = 50

PINECONE_INDEX = "bmw-datas"
PINECONE_NAMESPACE = "bimmerpost"
PINECONE_METADATA_BUDGET_BYTES = 35_000  # 5KB margin under Pinecone 40KB hard limit

"""Steps 1 + 2: fetch the speaker's sources and run quality gates.

Run:  python fetch_sources.py

Passing sources are saved to sources/0N_<type>.json.
Every result (pass or fail, with reasons) is logged to logs/fetch_report.json.
"""

import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv

from urllib.parse import urlparse

from brightdata import browser_fetch_session, is_auto_generated_captions, unlocker_fetch, youtube_fetch

# ---------------------------------------------------------------------------
# Config: one speaker, five sources
# ---------------------------------------------------------------------------

SPEAKER = {
    "name": "Cameron Hamilton",
    "company": "Alliance AI",
    "role": "Principal ML Engineer Architect",
    "talk": "Beyond the prompt: Building an AI that takes initiative",
}

SOURCES = [
    ("abstract", "https://reg.githubuniverse.com/flow/github/universe26/attendee-portal/page/sessioncatalog/session/1790284506862001SPzs"),
    ("profile", "https://www.linkedin.com/in/cameron-r-hamilton/"),
    ("youtube", "https://www.youtube.com/watch?v=Osp54zk7Hco"),
    ("article", "https://www.csail.mit.edu/news/mit-talks-love-blinds-aidata-scientist-cameron-hamilton"),
    ("company", "https://www.allianceai.co/"),
]


def pick_fetch_method(url):
    """Decide which Bright Data product fetches a URL, based on its website."""
    host = urlparse(url).netloc.lower()
    if host == "reg.githubuniverse.com":
        return "browser_api"      # content is loaded by JavaScript
    if host.endswith("youtube.com") or host == "youtu.be":
        return "youtube_scraper"  # never Unlocker (policy_20050)
    return "web_unlocker"


FETCHERS = {
    "browser_api": browser_fetch_session,
    "youtube_scraper": youtube_fetch,
    "web_unlocker": unlocker_fetch,
}

# A source must mention at least one of these to count as relevant.
SPEAKER_TERMS = ["cameron hamilton", "hamilton"]
TOPIC_TERMS = ["alliance ai", "allianceai", "beyond the prompt", "takes initiative", "initiative", "agentic", "proactive"]

# Always a sign we got a wall instead of the real page.
BLOCKED_PATTERNS = [
    r"captcha", r"verify you are (a )?human", r"are you a robot", r"access denied",
    r"authwall", r"unusual traffic", r"request blocked",
]
# Normal on real pages too (nav bars etc.), so only suspicious when the page is short.
WEAK_BLOCKED_PATTERNS = [
    r"sign in to (view|continue|see)", r"log ?in to continue", r"join linkedin", r"page not found",
    r"\b404\b", r"enable javascript", r"something went wrong", r"session (has )?expired",
]

# Pages that are kept up to date, so dates inside them (e.g. an old publication
# listed on a profile) don't tell us how old the page is.
LIVING_PAGES = {"profile", "company"}

MIN_TEXT_CHARS = 500
STALE_AFTER = timedelta(days=365)

ROOT = Path(__file__).parent
SOURCES_DIR = ROOT / "sources"
LOGS_DIR = ROOT / "logs"


# ---------------------------------------------------------------------------
# Quality gates
# ---------------------------------------------------------------------------

def real_text(content):
    """Strip markdown links, images, URLs and extra whitespace to measure actual prose."""
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", content)    # images
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)    # links -> link text
    text = re.sub(r"https?://\S+", " ", text)                # bare URLs
    text = re.sub(r"[#*_>`|\-]{2,}", " ", text)              # markdown decoration
    return re.sub(r"\s+", " ", text).strip()


MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December"


def find_date(text):
    """Return the first date we can spot in the text (a heuristic for web pages)."""
    m = re.search(rf"\b({MONTHS})\s+(\d{{1,2}}),\s+(\d{{4}})\b", text)
    if m:
        return datetime.strptime(" ".join(m.groups()), "%B %d %Y").replace(tzinfo=timezone.utc)
    m = re.search(rf"\b({MONTHS})\s+(\d{{1,2}})\s+'(\d\d)\b", text)  # e.g. April 02 '20
    if m:
        return datetime.strptime(" ".join(m.groups()), "%B %d %y").replace(tzinfo=timezone.utc)
    m = re.search(r"\b(20\d\d)-(\d\d)-(\d\d)\b", text)
    if m:
        return datetime(*map(int, m.groups()), tzinfo=timezone.utc)
    return None


def check_quality(source_type, fetch_method, result):
    """Return (reasons_to_reject, flags, published_date)."""
    reasons, flags = [], []
    content = result.get("content") or ""
    text = real_text(content)
    lower = text.lower()

    if result["status"] != 200:
        reasons.append(f"HTTP status {result['status']}" + (f" ({result['error']})" if result.get("error") else ""))

    if len(text) < MIN_TEXT_CHARS:
        reasons.append(f"only {len(text)} chars of real text (< {MIN_TEXT_CHARS})")

    hits = [p for p in BLOCKED_PATTERNS if re.search(p, lower)]
    if len(text) < 2000:
        hits += [p for p in WEAK_BLOCKED_PATTERNS if re.search(p, lower)]
    if hits:
        reasons.append(f"looks like a login/CAPTCHA/error page (matched: {', '.join(hits)})")

    mentions = [t for t in SPEAKER_TERMS + TOPIC_TERMS if t in lower]
    if not mentions:
        reasons.append("doesn't mention the speaker or topic")

    # Age: YouTube gives us an upload date; for web pages, guess from the text.
    published = None
    if fetch_method == "youtube_scraper":
        raw_date = (result.get("youtube") or {}).get("upload_date")
        if raw_date:
            published = datetime.fromisoformat(str(raw_date).replace("Z", "+00:00"))
            if published.tzinfo is None:
                published = published.replace(tzinfo=timezone.utc)
        if is_auto_generated_captions(result.get("youtube") or {}):
            flags.append("auto-generated captions")
    elif source_type not in LIVING_PAGES:
        published = find_date(content)

    if published and datetime.now(timezone.utc) - published > STALE_AFTER:
        flags.append("older than 12 months")

    return reasons, flags, published


def confidence_for(flags):
    if "auto-generated captions" in flags:
        return "low"
    if "older than 12 months" in flags:
        return "medium"
    return "high"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    load_dotenv(ROOT / ".env")
    SOURCES_DIR.mkdir(exist_ok=True)
    LOGS_DIR.mkdir(exist_ok=True)

    report = []
    for number, (source_type, url) in enumerate(SOURCES, start=1):
        fetch_method = pick_fetch_method(url)
        print(f"[{number}/{len(SOURCES)}] Fetching {source_type} via {fetch_method}: {url}")
        try:
            result = FETCHERS[fetch_method](url)
        except Exception as e:  # network errors, bad JSON, browser crashes, etc.
            result = {"status": 0, "content": "", "error": f"{type(e).__name__}: {e}"}

        reasons, flags, published = check_quality(source_type, fetch_method, result)
        passed = not reasons
        fetched_at = datetime.now(timezone.utc).isoformat(timespec="seconds")

        row = {
            "number": number,
            "source_type": source_type,
            "fetch_method": fetch_method,
            "url": url,
            "status": result["status"],
            "text_chars": len(real_text(result.get("content") or "")),
            "passed": passed,
            "reasons": reasons,
            "flags": flags,
            "published": published.date().isoformat() if published else None,
            "content_format": result.get("content_format"),
        }

        if passed:
            record = {
                "url": url,
                "fetched_at": fetched_at,
                "status": result["status"],
                "source_type": source_type,
                "fetch_method": fetch_method,
                "confidence": confidence_for(flags),
                "flags": flags,
                "published": row["published"],
                "content": result["content"],
            }
            # Structured extras: transcript segments for YouTube, fields for sessions.
            for extra in ("youtube", "session"):
                if extra in result:
                    record[extra] = result[extra]
            path = SOURCES_DIR / f"{number:02d}_{source_type}.json"
            path.write_text(json.dumps(record, indent=2, ensure_ascii=False))
            row["saved_to"] = str(path.relative_to(ROOT))
        else:
            # Keep a short preview so we can see what came back instead.
            row["preview"] = (result.get("content") or "")[:500]

        report.append(row)

    (LOGS_DIR / "fetch_report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False))
    print_summary(report)


def print_summary(report):
    print("\n" + "=" * 115)
    print(f"{'#':<3}{'type':<10}{'method':<17}{'status':<8}{'chars':<8}{'result':<8}{'confidence / reasons'}")
    print("-" * 115)
    for r in report:
        if r["passed"]:
            detail = confidence_for(r["flags"]) + (f"  [{'; '.join(r['flags'])}]" if r["flags"] else "")
            detail += f"  published={r['published'] or 'unknown'}"
        else:
            detail = "; ".join(r["reasons"])
        print(f"{r['number']:<3}{r['source_type']:<10}{r['fetch_method']:<17}{r['status']:<8}{r['text_chars']:<8}"
              f"{'PASS' if r['passed'] else 'FAIL':<8}{detail}")
    print("=" * 115)
    passed = sum(r["passed"] for r in report)
    print(f"{passed}/{len(report)} sources passed. Full log: logs/fetch_report.json")


if __name__ == "__main__":
    main()

"""Small wrappers around the three Bright Data products we use.

- unlocker_fetch(): normal web pages, via the Web Unlocker zone.
- youtube_fetch():  YouTube videos, via the YouTube Videos dataset scraper.
                    (Never send YouTube URLs to the Unlocker: it refuses them
                    with policy_20050.)
- browser_fetch_session(): GitHub Universe session pages, via the Browser API.
                    These pages build their content with JavaScript, so we need
                    a real browser.

All return a plain dict: {"status": int, "content": str, "error": str | None, ...}
"""

import asyncio
import os
import re
import time

import requests
from bs4 import BeautifulSoup
from playwright.async_api import TimeoutError as PlaywrightTimeout
from playwright.async_api import async_playwright

API = "https://api.brightdata.com"
YOUTUBE_DATASET_ID = "gd_lk56epmy2i5g7lzu0k"


def _headers():
    return {
        "Authorization": f"Bearer {os.environ['BRIGHTDATA_TOKEN']}",
        "Content-Type": "application/json",
    }


def _looks_like_html(text):
    start = text.lstrip()[:2000].lower()
    return start.startswith(("<!doctype", "<html")) or "<body" in start


def html_to_text(html):
    """Turn an HTML page into clean readable text."""
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript", "svg", "nav", "footer", "header", "form"]):
        tag.decompose()
    text = soup.get_text("\n")
    lines = [line.strip() for line in text.splitlines()]
    return "\n".join(line for line in lines if line)


def unlocker_fetch(url):
    """Fetch a web page as markdown; fall back to raw HTML -> clean text."""
    body = {
        "zone": os.environ["BRIGHTDATA_UNLOCKER_ZONE"],
        "url": url,
        "format": "raw",
        "data_format": "markdown",
    }
    resp = requests.post(f"{API}/request", headers=_headers(), json=body, timeout=120)
    content_format = "markdown"

    # If markdown output isn't supported, ask again for plain raw HTML.
    if resp.status_code == 400 and "data_format" in resp.text.lower():
        body.pop("data_format")
        resp = requests.post(f"{API}/request", headers=_headers(), json=body, timeout=120)
        content_format = "html"

    content = resp.text
    # Even when we ask for markdown we sometimes get HTML back; clean it either way.
    if _looks_like_html(content):
        content = html_to_text(content)
        content_format = "html->text"

    return {
        "status": resp.status_code,
        "content": content,
        "content_format": content_format,
        # Bright Data reports its own problems in these headers.
        "error": resp.headers.get("x-brd-error") or resp.headers.get("x-brd-err-msg")
        or (None if resp.ok else content[:300]),
    }


def youtube_fetch(url, max_wait_seconds=600):
    """Scrape one YouTube video (incl. transcript) with the dataset scraper."""
    resp = requests.post(
        f"{API}/datasets/v3/scrape",
        params={"dataset_id": YOUTUBE_DATASET_ID, "format": "json"},
        headers=_headers(),
        json=[{"url": url}],
        timeout=300,
    )

    # Slow jobs come back as 202 + snapshot_id; poll until the snapshot is ready.
    if resp.status_code == 202:
        snapshot_id = resp.json().get("snapshot_id")
        print(f"    YouTube scrape queued (snapshot {snapshot_id}), polling...")
        waited = 0
        while True:
            time.sleep(10)
            waited += 10
            resp = requests.get(
                f"{API}/datasets/v3/snapshot/{snapshot_id}",
                params={"format": "json"},
                headers=_headers(),
                timeout=120,
            )
            if resp.status_code != 202:
                break
            if waited >= max_wait_seconds:
                return {"status": 202, "content": "", "error": f"snapshot {snapshot_id} not ready after {waited}s"}
            print(f"    ...still building ({waited}s)")

    if resp.status_code != 200:
        return {"status": resp.status_code, "content": "", "error": resp.text[:300]}

    data = resp.json()
    record = data[0] if isinstance(data, list) and data else data
    if not isinstance(record, dict) or record.get("error"):
        return {"status": resp.status_code, "content": "", "error": str(record)[:300]}

    transcript = record.get("transcript") or ""
    title = record.get("title") or ""
    description = record.get("description") or ""

    return {
        "status": 200,
        # The text we quality-check and later extract from.
        "content": f"# {title}\n\n{description}\n\n## Transcript\n\n{transcript}".strip(),
        "content_format": "youtube_transcript",
        "error": None,
        "youtube": {
            "title": title,
            "upload_date": record.get("date_posted") or record.get("upload_date"),
            "channel": record.get("youtuber") or record.get("channel_name"),
            "transcript_language": english_only(record.get("transcript_language")),
            "transcript": transcript,
            # Timestamped segments -- needed later for citing "at 12:34".
            "formatted_transcript": record.get("formatted_transcript"),
        },
    }


# --- Browser API (GitHub Universe session pages) ---------------------------

# The session title only appears once the page's JavaScript has loaded the session.
SESSION_TITLE = ".session-details-container .session-title"

# Runs inside the page: pull out just the session details, skipping menus and footer.
EXTRACT_SESSION_JS = """() => {
  const root = document.querySelector('.session-details-container');
  if (!root) return null;
  const text = sel => root.querySelector(sel)?.innerText.trim() || '';
  const tags = [...root.querySelectorAll('.rf-attribute')]
    .map(a => {
      const name = (a.querySelector('.attribute-name')?.innerText || '').trim().replace(/:+$/, '');
      const values = a.querySelector('.attribute-values')?.innerText.trim();
      if (!values || /image/i.test(name)) return null;  // skip tile-image links
      return name ? name + ': ' + values : values;
    })
    .filter(Boolean);
  // Speaker pill = name on the first line, then role/company values.
  const pill = root.querySelector('.speakers-component');
  const speakerName = (pill?.innerText || '').trim().split('\\n')[0];
  const speakerMeta = [...(pill?.querySelectorAll('.speaker-pill-value') || [])].map(v => v.innerText.trim());
  return {
    title: text('.session-title .title-text'),
    speakers: [speakerName, ...speakerMeta].filter(Boolean).join(', '),
    date: text('.session-date'),
    time: text('.session-time'),
    room: text('.session-location'),
    tags: tags,
    abstract: text('.abstract-component'),
  };
}"""


def _one_line(text):
    return re.sub(r"\s+", " ", text or "").strip()


async def _browser_fetch_session(url):
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp(os.environ["BRIGHTDATA_BROWSER_WS"].strip())
        try:
            page = await browser.new_page()
            response = await page.goto(url, timeout=120_000)
            try:
                await page.wait_for_selector(SESSION_TITLE, timeout=30_000)
            except PlaywrightTimeout:
                await page.wait_for_timeout(15_000)  # fallback: give JavaScript more time
            session = await page.evaluate(EXTRACT_SESSION_JS)
            status = response.status if response else 0
        finally:
            await browser.close()  # always close, even on error

    if not session or not session.get("title"):
        return {"status": status, "content": "", "error": "session details not found on page"}

    session = {key: (value if key == "tags" else _one_line(value)) for key, value in session.items()}
    lines = [
        f"# {session['title']}",
        "",
        f"Speakers: {session['speakers']}",
        f"Date/time: {session['date']} {session['time']}".strip(),
        f"Room: {session['room']}",
        f"Tags: {', '.join(session['tags']) or 'none'}",
        "",
        "## Abstract",
        "",
        session["abstract"],
    ]
    return {
        "status": status,
        "content": "\n".join(lines),
        "content_format": "session_details",
        "error": None,
        "session": session,
    }


def browser_fetch_session(url):
    """Load a GitHub Universe session page in Bright Data's remote browser."""
    return asyncio.run(_browser_fetch_session(url))


def english_only(languages):
    """YouTube lists every auto-translate option (Arabic, Hindi, ...); keep just English."""
    if not isinstance(languages, list):
        return languages
    return [lang for lang in languages if "english" in str(lang).lower()]


def is_auto_generated_captions(youtube_info):
    """Best-effort check: does the transcript language say it's auto-generated?"""
    lang = str(youtube_info.get("transcript_language") or "").lower()
    return bool(re.search(r"auto|asr|generated", lang))

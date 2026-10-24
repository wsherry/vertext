import asyncio, os
from dotenv import load_dotenv
from playwright.async_api import async_playwright

load_dotenv()
URL = "https://reg.githubuniverse.com/flow/github/universe26/attendee-portal/page/sessioncatalog/session/1790284506862001SPzs"

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp(os.getenv("BRIGHTDATA_BROWSER_WS"))
        page = await browser.new_page()
        await page.goto(URL, timeout=120000)
        await page.wait_for_timeout(8000)   # give the JavaScript time to load the session
        text = await page.inner_text("body")
        print(text[:3000])
        await browser.close()

asyncio.run(main())
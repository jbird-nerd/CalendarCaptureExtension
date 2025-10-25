import asyncio
from playwright.async_api import async_playwright
import os

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()

        # Verify modal.html
        modal_path = "file://" + os.path.abspath("modal.html")
        await page.goto(modal_path)

        # Update status text for verification
        await page.eval_on_selector('#api-status', """(el) => {
            el.textContent = 'OCRing with gpt-4o...';
        }""")

        await page.screenshot(path="jules-scratch/verification/modal_final_confirmation.png")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())

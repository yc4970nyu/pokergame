"""Dev helper: drive the game in headless Chrome and save screenshots.
Usage: python3 scripts/screenshots.py [outdir]   (server must be running on :3001 with a built client)
"""
import asyncio, sys, os
from playwright.async_api import async_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else 'shots'
URL = os.environ.get('URL', 'http://localhost:3001/')


async def main():
    os.makedirs(OUT, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=os.environ.get('CHROME', '/usr/bin/google-chrome'), args=['--no-sandbox'])
        for label, vp, mobile in [
            ('phone', {'width': 390, 'height': 844}, True),
            ('landscape', {'width': 844, 'height': 390}, True),
            ('desktop', {'width': 1280, 'height': 800}, False),
        ]:
            ctx = await b.new_context(viewport=vp, is_mobile=mobile, has_touch=mobile, device_scale_factor=2 if mobile else 1)
            pg = await ctx.new_page()
            logs = []
            pg.on('console', lambda m: logs.append(m.text) if m.type == 'error' else None)
            pg.on('pageerror', lambda e: logs.append('PAGEERROR ' + str(e)))
            await pg.goto(URL)
            await pg.wait_for_timeout(1500)
            await pg.screenshot(path=f'{OUT}/{label}-home.png')
            await pg.fill('input[autocomplete=nickname]', 'Louis')
            await pg.click('text=和机器人练习')
            await pg.wait_for_timeout(3500)
            await pg.screenshot(path=f'{OUT}/{label}-table.png')
            for _ in range(8):
                btn = pg.locator('button:has-text("提示")')
                if await btn.is_enabled():
                    await btn.click()
                    await pg.wait_for_timeout(500)
                    await pg.screenshot(path=f'{OUT}/{label}-selected.png')
                    await pg.click('button:has-text("出牌")')
                    await pg.wait_for_timeout(250)
                    await pg.screenshot(path=f'{OUT}/{label}-flying.png')
                    await pg.wait_for_timeout(1200)
                    await pg.screenshot(path=f'{OUT}/{label}-played.png')
                    break
                await pg.wait_for_timeout(1500)
            await pg.wait_for_timeout(2500)
            await pg.screenshot(path=f'{OUT}/{label}-later.png')
            print(label, 'errors:', logs[:10])
            await ctx.close()
        await b.close()

asyncio.run(main())

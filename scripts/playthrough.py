"""Dev helper: play a whole round against bots in headless Chrome (hint → play, else pass) and screenshot the result."""
import asyncio, sys, os
from playwright.async_api import async_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else 'shots'
URL = os.environ.get('URL', 'http://localhost:3001/')


async def main():
    os.makedirs(OUT, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=os.environ.get('CHROME', '/usr/bin/google-chrome'), args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, device_scale_factor=2)
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL)
        await pg.evaluate("localStorage.setItem('dld.settings', JSON.stringify({speed:'fast', sound:false}))")
        await pg.reload()
        await pg.fill('input[autocomplete=nickname]', 'Louis')
        await pg.click('text=和机器人练习')
        await pg.wait_for_timeout(2000)
        moves = 0
        for _ in range(400):
            if await pg.locator('.result').count():
                break
            hint = pg.locator('button:has-text("提示")')
            if await hint.is_enabled():
                await hint.click()
                await pg.wait_for_timeout(120)
                play = pg.locator('button:has-text("出牌")')
                if await play.is_enabled() and await pg.locator('.hand-card.sel').count():
                    await play.click()
                else:
                    await pg.click('button:has-text("不要")')
                moves += 1
                if moves == 3:
                    await pg.screenshot(path=f'{OUT}/mid.png')
            await pg.wait_for_timeout(250)
        await pg.wait_for_timeout(420)
        await pg.screenshot(path=f'{OUT}/chips.png')
        await pg.wait_for_timeout(2500)
        await pg.screenshot(path=f'{OUT}/result.png')
        await pg.click('button:has-text("下一局")')
        await pg.wait_for_timeout(1300)
        await pg.screenshot(path=f'{OUT}/round2-deal.png')
        print('moves', moves, 'errors', errs)
        await b.close()

asyncio.run(main())

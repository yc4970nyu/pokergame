"""Dev helper: screenshot the opening deal sequence at fixed moments (phone + desktop)."""
import asyncio, sys, os
from playwright.async_api import async_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else 'shots'
URL = os.environ.get('URL', 'http://localhost:3001/')
MOMENTS = [0.5, 1.6, 2.8, 4.1, 4.6, 5.6]


async def main():
    os.makedirs(OUT, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=os.environ.get('CHROME', '/usr/bin/google-chrome'), args=['--no-sandbox'])
        for label, vp, mobile in [('phone', {'width': 390, 'height': 844}, True), ('desktop', {'width': 1280, 'height': 800}, False)]:
            ctx = await b.new_context(viewport=vp, is_mobile=mobile, has_touch=mobile, device_scale_factor=2 if mobile else 1)
            pg = await ctx.new_page()
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.goto(URL)
            await pg.fill('input[autocomplete=nickname]', 'Louis')
            await pg.click('text=和机器人练习')
            await pg.wait_for_selector('.hand-card')
            t0 = asyncio.get_event_loop().time()
            for m in MOMENTS:
                now = asyncio.get_event_loop().time() - t0
                if m > now:
                    await pg.wait_for_timeout(int((m - now) * 1000))
                await pg.screenshot(path=f'{OUT}/{label}-t{m:.1f}.png')
            print(label, 'errors', errs)
            await ctx.close()
        await b.close()

asyncio.run(main())

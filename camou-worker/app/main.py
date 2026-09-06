"""
Camoufox-воркер: антидетект-Firefox (правдоподобный отпечаток).
POST /scrape  {"url":"https://www.ozon.ru/"}
   -> {"ok":true,  "status":"ok",        "title":..., "html":..., "url":...}
   -> {"ok":false, "status":"captcha",   ...}
   -> {"ok":false, "status":"ip-blocked",...}
"""
import os
import re
import time
import random
from urllib.parse import urlparse, unquote

from fastapi import FastAPI
from pydantic import BaseModel

from camoufox.sync_api import Camoufox

app = FastAPI()

PROXY_URL = os.environ.get("PROXY_URL", "")
# HEADED=true только для ручного прохода капчи с дисплеем; по умолчанию headless.
HEADED = os.environ.get("HEADED", "false").lower() in ("1", "true", "yes")
HEADLESS = not HEADED

_browser = None
_browser_lock = False


def _proxy_cfg():
    """Разбираем PROXY_URL вида http://user:pass@host:port в proxy-словарь playwright."""
    url = PROXY_URL.strip() if PROXY_URL else ""
    if not url:
        return None
    if "://" not in url:
        url = "http://" + url
    p = urlparse(url)
    server = f"{p.scheme}://{p.hostname}"
    if p.port:
        server += f":{p.port}"
    cfg = {"server": server}
    if p.username:
        cfg["username"] = unquote(p.username)
        cfg["password"] = unquote(p.password or "")
    return cfg


def get_browser():
    global _browser, _browser_lock
    if _browser is None and not _browser_lock:
        _browser_lock = True
        try:
            kwargs = dict(
                headless=HEADLESS,
                humanize=True,
                geoip=False,
            )
            pc = _proxy_cfg()
            if pc:
                kwargs["proxy"] = pc
                print(f"[camou] using proxy {kwargs['proxy']['server']}", flush=True)
            _browser = Camoufox(**kwargs).__enter__()
            print("[camou] browser launched", flush=True)
        finally:
            _browser_lock = False
    return _browser


def detect_block(page, html, title):
    """Распознаём капчу/блок ПО ФАКТУ виджета, а не по словам во всём HTML."""
    # Триггерим только по интерактивной ручке #slider, реально в пределах экрана.
    # (#puzzle — это картинка, её скрытый контейнер присутствует всегда,
    # если включать её в проверку — фантомная капча на любой странице.)
    slider = page.locator("#slider")
    if slider.count():
        box = slider.first.bounding_box()
        if box:
            vp = page.viewport_size
            on_screen = (
                box["x"] < vp["width"] and box["y"] < vp["height"]
                and box["x"] + box["width"] > 0 and box["y"] + box["height"] > 0
                and box["width"] > 0 and box["height"] > 0
            )
            if on_screen:
                return "captcha"
    low = html.lower()
    if "нет соединения" in low or "выключите vpn" in low:
        return "ip-blocked"
    if title and ("проблема с ip" in title.lower() or "доступ ограничен" in title.lower()):
        return "ip-blocked"
    return None


def solve_once(page, attempt):
    """Один драг ручки #slider на расстояние смещения кусочка #puzzle."""
    slider = page.locator("#slider")
    puzzle = page.locator("#puzzle")
    if slider.count() == 0 or puzzle.count() == 0:
        return False

    box = slider.bounding_box()
    if not box:
        return False
    style = (puzzle.get_attribute("style") or "")
    m = re.search(r"left:\s*(-?[\d.]+)px", style)
    dist = abs(float(m.group(1))) if m else box["width"] * 1.5
    if dist <= 0:
        dist = box["width"] * 1.5

    scale = 1.0
    cap = page.locator("#captcha")
    if cap.count():
        sm = re.search(r"--scale:\s*([\d.]+)", (cap.get_attribute("style") or ""))
        if sm:
            scale = float(sm.group(1)) or 1.0

    # чередуем "с масштабом / без": Ozon каждый раз генерит новое смещение
    travel = dist * scale if attempt % 2 == 0 else dist

    x0 = box["x"] + box["width"] / 2
    y = box["y"] + box["height"] / 2
    x1 = x0 + travel

    page.mouse.move(x0, y)
    page.mouse.down()
    steps = 20 + random.randint(0, 7)
    for i in range(1, steps + 1):
        x = x0 + (x1 - x0) * (i / steps)
        page.mouse.move(x, y + (random.random() - 0.5) * 2)
        page.wait_for_timeout(9 + random.randint(0, 10))
    page.wait_for_timeout(170)
    page.mouse.up()
    page.wait_for_timeout(1800)
    print(f"[camou] slider dragged dist={travel:.0f} scale={scale} attempt={attempt}", flush=True)
    return True


class ScrapeRequest(BaseModel):
    url: str = "https://www.ozon.ru/"
    timeout_ms: int = 90000


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/scrape")
def scrape(req: ScrapeRequest):
    browser = get_browser()
    page = browser.new_page()
    t0 = time.time()
    is_avito = "avito" in (req.url or "").lower()
    try:
        page.goto(req.url, wait_until="domcontentloaded", timeout=req.timeout_ms)
        print(f"[camou] goto ok {(time.time()-t0):.1f}s url={page.url[:70]}", flush=True)
        page.wait_for_timeout(1200 + random.randint(0, 1200))

        solved = False
        tried = 0
        for attempt in range(6):
            if page.locator("#slider").count() == 0 and "Antibot" not in page.title():
                solved = True
                break
            if detect_block(page, page.content(), page.title()) == "ip-blocked":
                break
            solve_once(page, attempt)
            tried += 1
            page.wait_for_timeout(2500)

        print(f"[camou] tries={tried} total={(time.time()-t0):.1f}s", flush=True)

        # Avito часто держит JS-челлендж ("антибот") задержкой и разрешает сам:
        # даём время на автопереход в контент, прежде чем объявлять капчу.
        if is_avito and detect_block(page, page.content(), page.title()) == "captcha":
            for _ in range(18):  # до ~36 сек
                page.wait_for_timeout(2000)
                b = detect_block(page, page.content(), page.title())
                if b is None:
                    solved = True
                    break
            print(f"[camou] avito wait-resolve done solved={solved} total={(time.time()-t0):.1f}s", flush=True)

        html = page.content()
        title = page.title()
        block = detect_block(page, html, title)
        print(f"[camou] done block={block} total={(time.time()-t0):.1f}s", flush=True)

        if block == "captcha":
            page.screenshot(path=f"/tmp/captcha_{int(time.time())}.png")
            print(f"[camou] captcha final url={page.url[:90]} title={title[:60]!r}", flush=True)
            return {"ok": False, "status": "captcha", "url": page.url, "title": title[:120]}
        if block == "ip-blocked":
            return {"ok": False, "status": "ip-blocked",
                    "hint": "Сайт заблокировал этот IP/сеть (нет соединения / VPN)."}
        if not solved:
            return {"ok": False, "status": "captcha"}
        return {"ok": True, "status": "ok", "title": title,
                "html": html[:1_000_000], "url": page.url,
                "elapsed": round(time.time() - t0)}
    except Exception as e:  # noqa: BLE001 — единая обёртка для любых сайтов
        print(f"[camou] scrape ERROR {type(e).__name__}: {str(e)[:200]}", flush=True)
        return {"ok": False, "status": "error", "error": f"{type(e).__name__}: {str(e)[:200]}"}
    finally:
        try:
            page.close()
        except Exception:
            pass

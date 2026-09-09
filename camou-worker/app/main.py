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
import threading
import pathlib
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse, unquote

from fastapi import FastAPI, Request, HTTPException
from pydantic import BaseModel

from camoufox.sync_api import Camoufox
from camoufox.addons import DefaultAddons

app = FastAPI()

PROXY_URL = os.environ.get("PROXY_URL", "")
# HEADED=true только для ручного прохода капчи с дисплеем; по умолчанию headless.
HEADED = os.environ.get("HEADED", "false").lower() in ("1", "true", "yes")
HEADLESS = not HEADED
AUTH_TOKEN = os.environ.get("AUTH_TOKEN", "")

_browser = None
# Всё выполняется на ОДНОМ потоке: Camoufox (sync) thread-bound и теряет браузер,
# если запускать/дёргать его с разных нитей.
_ENGINE = ThreadPoolExecutor(max_workers=1, thread_name_prefix="camou")


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


def _launch_browser():
    # uBlock не нужен для скрейпинга, а его скачивание с addons.mozilla.org
    # вешает старт на нестабильной сети. Исключаем — и запуск оффлайн.
    kwargs = dict(headless=HEADLESS, humanize=True, geoip=False,
                  exclude_addons=[DefaultAddons.UBO])
    pc = _proxy_cfg()
    if pc:
        kwargs["proxy"] = pc
        print(f"[camou] using proxy {kwargs['proxy']['server']}", flush=True)
    return Camoufox(**kwargs).__enter__()


def _hydrate_content(page, url=""):
    """Триггерим клиентскую гидратацию JS-страниц (WB, каталоги): мягкие скроллы
    + ожидание появления карточек/ссылок. Без этого воркер отдаёт «shell» без товаров."""
    low = url.lower()
    is_market = any(k in low for k in ("wildberries", "wb.ru", "ozon", "avito",
                                       "search.aspx", "/catalog/", "megamarket", "dns-shop"))
    try:
        for _ in range(3):
            page.mouse.wheel(0, 4000)
            page.wait_for_timeout(900)
        page.mouse.wheel(0, -6000)
        page.wait_for_timeout(800)
    except Exception:
        pass
    if is_market:
        try:
            page.locator('a[href*="/catalog/"], a[href*="/product/"], .product-card, [data-wba-at], [data-wb]').first.wait_for(timeout=12000)
            page.wait_for_timeout(800)
        except Exception:
            pass


def get_browser():
    """Синглтон-браузер. Всё выполняется на потоке единого executer-а, поэтому
    Camoufox (sync, thread-bound) не теряет свою нить запуска."""
    global _browser
    if _browser is None:
        _browser = _launch_browser()
        print("[camou] browser launched", flush=True)
    return _browser


def detect_block(page, html, title):
    """Распознаём капчу/блок ПО ФАКТУ виджета, а не по словам во всём HTML."""
    if _slider_active(page):
        return "captcha"
    low = html.lower()
    # Ozon может отдавать блок-страницу и на английском.
    if "captcha" in title.lower() or "antibot" in title.lower():
        return "captcha"
    if ("нет соединения" in low or "выключите vpn" in low
            or "no connection" in low or "no internet connection" in low
            or "make sure your vpn" in low or "no connection" in title.lower()
            # страницы-ошибки/блоки, которые воркер ошибочно помечал "ok"
            or "http 403" in title.lower() or "упс" in title.lower()):
        return "ip-blocked"
    # общие признаки "stub"/ошибок, когда HTML почти пуст (нет контента)
    if (len((html or "").strip()) < 1500
            and ("is not available" in low or "not found" in low
                 or "ошибка" in low or "captcha" in low)):
        return "ip-blocked"
    if title and ("проблема с ip" in title.lower() or "доступ ограничен" in title.lower()):
        return "ip-blocked"
    return None


def _slider_active(page):
    """Активна ли капча: интерактивная ручка #slider реально в пределах экрана."""
    # Требуем контейнер капчи Ozon: на других сайтах "#slider" — обычная карусель.
    if page.locator("#captcha-container").count() == 0:
        return False
    slider = page.locator("#slider")
    if slider.count() == 0:
        return False
    try:
        box = slider.first.bounding_box()
    except Exception:
        return False
    if not box:
        return False
    vp = page.viewport_size
    # Camoufox в headless иногда возвращает None до первого layout'а —
    # не валим запрос, а честно сообщаем "капчи пока нет".
    if not vp:
        return False
    try:
        return (
            box["x"] < vp["width"] and box["y"] < vp["height"]
            and box["x"] + box["width"] > 0 and box["y"] + box["height"] > 0
            and box["width"] > 0 and box["height"] > 0
        )
    except Exception:
        return False


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
def health(request: Request):
    _auth(request)
    return {"ok": True, "engine": "camoufox", "auth": "allowlist"}


def _run_scrape(req: ScrapeRequest):
    browser = get_browser()
    if browser is None:
        return {"ok": False, "status": "error",
                "error": "browser failed to start (launch timeout)"}
    page = browser.new_page()
    t0 = time.time()
    is_avito = "avito" in (req.url or "").lower()
    try:
        page.goto(req.url, wait_until="domcontentloaded", timeout=req.timeout_ms)
        print(f"[camou] goto ok {(time.time()-t0):.1f}s url={page.url[:70]}", flush=True)
        page.wait_for_timeout(1200 + random.randint(0, 1200))
        _hydrate_content(page, req.url)
        print(f"[camou] dom cc={page.locator('#captcha-container').count()} "
              f"s={page.locator('#slider').count()} p={page.locator('#puzzle').count()}", flush=True)

        solved = False
        tried = 0
        idle = 0
        for attempt in range(10):
            # Ozon инжектит слайдер с задержкой: сначала даём странице устаканиться.
            if _slider_active(page) or "Antibot" in page.title():
                solve_once(page, attempt)
                tried += 1
                idle = 0
                page.wait_for_timeout(2200)
                continue
            if detect_block(page, page.content(), page.title()) == "ip-blocked":
                break
            idle += 1
            if idle >= 2:  # ~5 сек чисто и стабильно -> контент
                solved = True
                break
            page.wait_for_timeout(2500)

        print(f"[camou] tries={tried} solved={solved} total={(time.time()-t0):.1f}s", flush=True)

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


@app.post("/scrape")
def scrape(req: ScrapeRequest, request: Request):
    _auth(request)
    fut = _ENGINE.submit(_run_scrape, req)
    # page.goto упирается в req.timeout_ms; добавляем запас на запуск браузера/обвязку.
    wait_s = (req.timeout_ms / 1000.0) + 150.0
    try:
        return fut.result(timeout=wait_s)
    except TimeoutError:
        return {"ok": False, "status": "error",
                "error": "timeout (worker busy or a page hung)"}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "status": "error",
                "error": f"{type(e).__name__}: {str(e)[:200]}"}


def _auth(request: Request):
    """Allowlist-защита: AUTH_TOKEN (legacy) + токены из TOKENS_FILE
    (один на строку: `<token> [user]`). Читается на каждый запрос — выдача/отзыв
    действуют сразу. Пустой список = без авторизации (LAN)."""
    toks = {AUTH_TOKEN} if AUTH_TOKEN else set()
    tf = os.environ.get("TOKENS_FILE", "")
    if tf:
        try:
            for line in pathlib.Path(tf).read_text(encoding="utf-8", errors="ignore").splitlines():
                t = line.split()[0].strip() if line.strip() else ""
                if t:
                    toks.add(t)
        except OSError:
            pass
    if not toks:
        return
    got = (request.headers.get("x-api-token") or request.query_params.get("token") or "")
    if got not in toks:
        raise HTTPException(status_code=401, detail="unauthorized")

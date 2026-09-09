"""CloakBrowser-воркер: stealth-Chromium (C++-патчи), drop-in Playwright API.
POST /scrape {"url": "..."} -> {"ok","status","title","html","url","elapsed"}
"""
import os
import re
import time
import threading
import pathlib

from fastapi import FastAPI, Request, HTTPException
from pydantic import BaseModel

from cloakbrowser import launch

app = FastAPI()

PROXY_URL = os.environ.get("PROXY_URL", "")
HEADLESS = os.environ.get("HEADED", "false").lower() not in ("1", "true", "yes")
AUTH_TOKEN = os.environ.get("AUTH_TOKEN", "")

_browser = None
_lock = threading.Lock()


def _get_browser():
    global _browser
    with _lock:
        if _browser is None:
            kwargs = dict(headless=HEADLESS, humanize=True, geoip=False)
            if PROXY_URL.strip():
                kwargs["proxy"] = PROXY_URL.strip()
            _browser = launch(**kwargs)
    return _browser


def _detect(title, html):
    low = (html or "").lower()
    tl = (title or "").lower()
    if ("проверяем браузер" in low or "checking your browser" in low
            or "captcha" in tl or "antibot" in tl):
        return "captcha"
    if ("нет соединения" in low or "no connection" in low or "выключите vpn" in low
            or "http 403" in tl or "403 forbidden" in low or "упс" in tl or "уps" in tl):
        return "ip-blocked"
    return None


class ScrapeRequest(BaseModel):
    url: str = "https://example.com/"
    timeout_ms: int = 45000


@app.get("/health")
def health(request: Request):
    _auth(request)
    return {"ok": True, "engine": "cloakbrowser", "auth": "allowlist"}


@app.post("/scrape")
def scrape(req: ScrapeRequest, request: Request):
    _auth(request)
    t0 = time.time()
    try:
        browser = _get_browser()
        page = browser.new_page()
        try:
            page.goto(req.url, wait_until="domcontentloaded", timeout=req.timeout_ms)
            page.wait_for_timeout(1200)
            # JS-сайты (WB/каталоги): мягкая гидратация
            try:
                page.mouse.wheel(0, 4000)
                page.wait_for_timeout(900)
                page.mouse.wheel(0, -6000)
                page.wait_for_timeout(700)
            except Exception:
                pass
            html = page.content()
            title = page.title()
        finally:
            try:
                page.close()
            except Exception:
                pass
        block = _detect(title, html)
        if block:
            return {"ok": False, "status": block, "title": title, "html": ""}
        return {"ok": True, "status": "ok", "title": title,
                "html": html[:1_000_000], "url": req.url,
                "elapsed": round(time.time() - t0)}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "status": "error", "error": f"{type(e).__name__}: {str(e)[:200]}"}


def _allowed_tokens():
    """AUTH_TOKEN (legacy) + все токены из TOKENS_FILE (allowlist, один на строку:
    `<token> [user]`). Читается на каждый запрос — выдача/отзыв действуют сразу."""
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
    return toks


def _auth(request: Request):
    toks = _allowed_tokens()
    if not toks:
        return
    got = (request.headers.get("x-api-token") or request.query_params.get("token") or "")
    if got not in toks:
        raise HTTPException(status_code=401, detail="unauthorized")

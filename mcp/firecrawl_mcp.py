#!/usr/bin/env python3
"""MCP stdio server (2024-11-05, Content-Length framing) exposing the scrapers.

Tools:
  - scrape_url(url, timeout)      : через Camoufox-воркер (антидетект + прокси).
  - scrape_markdown(url, timeout) : через Firecrawl.

Env:
  WORKER_URL     http://<host>:3100/scrape   (воркер, требует x-api-token если AUTH_TOKEN задан)
  FIRECRAWL_URL  http://<host>:3002          (firecrawl, LAN)
  AUTH_TOKEN     secret (необязателен)
"""
import json
import os
import re
import sys
import urllib.request
import urllib.error
from html.parser import HTMLParser

WORKER_URL = os.environ.get("WORKER_URL", "http://192.168.0.138:3100/scrape")
FIRECRAWL_URL = os.environ.get("FIRECRAWL_URL", "http://192.168.0.138:3002")
AUTH_TOKEN = os.environ.get("AUTH_TOKEN", "")


class _TextExtract(HTMLParser):
    VOID = {"br", "p", "div", "li", "h1", "h2", "h3", "tr"}

    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag in self.VOID:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in self.VOID:
            self.parts.append("\n")

    def handle_data(self, data):
        if data.strip():
            self.parts.append(data)


def html_to_text(html, limit=6000):
    p = _TextExtract()
    p.feed(html or "")
    return " ".join(" ".join(p.parts).split())[:limit]


def to_headers(payload):
    h = {"Content-Type": "application/json"}
    if AUTH_TOKEN:
        h["x-api-token"] = AUTH_TOKEN
    return h


def _post(url, payload, timeout):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers=to_headers(payload), method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.status, json.loads(resp.read().decode("utf-8", "replace"))


def call_scrape(url, timeout=90):
    try:
        _status, d = _post(WORKER_URL, {"url": url, "timeout_ms": timeout * 1000}, timeout)
    except urllib.error.HTTPError as e:
        return {"isError": True, "content": [{"type": "text", "text": f"HTTP {e.code}: {e.read()[:300]}"}]}
    except Exception as e:  # noqa: BLE001
        return {"isError": True, "content": [{"type": "text", "text": f"worker error: {e}"}]}
    if not d.get("ok"):
        return {"isError": True, "content": [{"type": "text", "text": json.dumps(d, ensure_ascii=False)[:2000]}]}
    title = re.sub(r"\s+", " ", (d.get("title") or "")).strip()
    text = html_to_text(d.get("html") or "")
    return {"isError": False,
            "content": [{"type": "text", "text": f"status: ok\nurl: {d.get('url')}\ntitle: {title}\n\ntext:\n{text}"}]}


def call_markdown(url, timeout=90):
    try:
        _status, d = _post(f"{FIRECRAWL_URL}/v2/scrape",
                           {"url": url, "formats": ["markdown"], "timeout": timeout * 1000}, timeout)
    except Exception as e:  # noqa: BLE001
        return {"isError": True, "content": [{"type": "text", "text": f"firecrawl error: {e}"}]}
    md = (d.get("data") or {}).get("markdown") if isinstance(d.get("data"), dict) else None
    if not md:
        return {"isError": True, "content": [{"type": "text", "text": json.dumps(d, ensure_ascii=False)[:2000]}]}
    return {"isError": False, "content": [{"type": "text", "text": md[:6000]}]}


TOOLS = [
    {
        "name": "scrape_url",
        "description": "Парсит сайт через антидетект-воркер (Camoufox, жилой прокси). "
                       "Сайт назначается по URL: Ozon/Avito/Wildberries и др. "
                       "Возвращает status, title и текст-выдержку.",
        "inputSchema": {"type": "object",
                        "properties": {
                            "url": {"type": "string", "description": "Абсолютный URL страницы"},
                            "timeout": {"type": "number", "description": "Секунды (макс ~120)", "default": 90}},
                        "required": ["url"]},
    },
    {
        "name": "scrape_markdown",
        "description": "Скрейп через Firecrawl в markdown (обычные сайты).",
        "inputSchema": {"type": "object",
                        "properties": {
                            "url": {"type": "string"},
                            "timeout": {"type": "number", "description": "Секунды", "default": 90}},
                        "required": ["url"]},
    },
]


# ---------- MCP stdio transport (Content-Length framing) ----------
def read_message():
    headers = {}
    while True:
        line = sys.stdin.buffer.readline()
        if not line:
            return None
        line = line.rstrip(b"\r\n")
        if line == b"":
            break
        if b":" in line:
            k, _, v = line.partition(b":")
            headers[k.decode().strip().lower()] = v.decode().strip()
    n = int(headers.get("content-length", "0"))
    if n <= 0:
        return None
    body = sys.stdin.buffer.read(n)
    return json.loads(body)


def write_message(obj):
    data = json.dumps(obj).encode("utf-8")
    sys.stdout.buffer.write(f"Content-Length: {len(data)}\r\n\r\n".encode("ascii") + data)
    sys.stdout.buffer.flush()


def handle(msg):
    method = msg.get("method")
    mid = msg.get("id")
    if method == "initialize":
        write_message({"jsonrpc": "2.0", "id": mid, "result": {
            "protocolVersion": "2024-11-05",
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": {"name": "firecrawl-stack", "version": "1.1.0"}}})
    elif method == "ping":
        if mid is not None:
            write_message({"jsonrpc": "2.0", "id": mid, "result": {}})
    elif method == "tools/list":
        write_message({"jsonrpc": "2.0", "id": mid, "result": {"tools": TOOLS}})
    elif method == "tools/call":
        params = msg.get("params", {}) or {}
        name = params.get("name")
        args = params.get("arguments", {}) or {}
        if name == "scrape_url":
            res = call_scrape(args.get("url", ""), int(args.get("timeout", 90)))
        elif name == "scrape_markdown":
            res = call_markdown(args.get("url", ""), int(args.get("timeout", 90)))
        else:
            res = {"isError": True, "content": [{"type": "text", "text": f"unknown tool: {name}"}]}
        write_message({"jsonrpc": "2.0", "id": mid, "result": res})
    # notifications и неизвестные запросы — не отвечаем (или пустой результат для запросов)
    elif mid is not None:
        write_message({"jsonrpc": "2.0", "id": mid, "result": {}})


def main():
    while True:
        msg = read_message()
        if msg is None:
            break
        handle(msg)


if __name__ == "__main__":
    main()
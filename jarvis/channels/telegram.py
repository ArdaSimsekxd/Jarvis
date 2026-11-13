"""Telegram kanalı: bütün ajanlar mesajlarını buradan gönderir."""
import html
import json
import os
import re
import urllib.error
import urllib.request

LIMIT = 4000


def _post(payload):
    token = os.environ["TELEGRAM_BOT_TOKEN"]
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/sendMessage",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        resp.read()


def plain(text):
    """Biçim etiketlerini atar; Telegram biçimli metni kabul etmezse bu gönderilir."""
    return html.unescape(re.sub(r"<[^>]+>", "", text))


def send(text):
    base = {"chat_id": os.environ["TELEGRAM_CHAT_ID"], "disable_web_page_preview": True}
    if len(text) <= LIMIT:
        try:
            _post({**base, "text": text, "parse_mode": "HTML"})
            return
        except urllib.error.HTTPError as e:
            if e.code != 400:
                raise
    # Çok uzun ya da Telegram'ın çözemediği biçim: bildirim kaybolmasın, düz yazı olarak gitsin.
    _post({**base, "text": plain(text)[:LIMIT]})

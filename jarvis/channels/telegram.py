"""Telegram kanalı: bütün ajanlar mesajlarını ve dosyalarını buradan gönderir."""
import html
import json
import os
import re
import urllib.error
import urllib.request
import uuid

LIMIT = 4000
CAPTION_LIMIT = 1000                 # Telegram dosya açıklamasında en fazla 1024 karaktere izin verir
MAX_FILE_BYTES = 45 * 1024 * 1024    # botlar en fazla 50 MB dosya yükleyebilir


def _call(method, body, content_type, timeout=30):
    token = os.environ["TELEGRAM_BOT_TOKEN"]
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/{method}",
        data=body,
        headers={"Content-Type": content_type},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        resp.read()


def _post(payload):
    _call("sendMessage", json.dumps(payload).encode(), "application/json")


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


def multipart(fields, filename, data):
    """Form alanlarını ve dosyayı tek gövdede birleştirir; (gövde, içerik türü) döndürür."""
    boundary = "jarvis" + uuid.uuid4().hex
    safe = re.sub(r'[\x00-\x1f"\\/]', "_", filename).strip() or "dosya"
    parts = [
        f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode()
        for name, value in fields.items()
    ]
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="document"; filename="{safe}"\r\n'
                 f"Content-Type: application/octet-stream\r\n\r\n".encode())
    parts += [data, f"\r\n--{boundary}--\r\n".encode()]
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


def _upload(fields, filename, data):
    _call("sendDocument", *multipart(fields, filename, data), timeout=120)


def send_document(filename, data, caption=""):
    """Dosyanın kendisini gönderir (en fazla MAX_FILE_BYTES). caption: dosyanın altındaki biçimli açıklama."""
    base = {"chat_id": os.environ["TELEGRAM_CHAT_ID"]}
    if caption and len(caption) <= CAPTION_LIMIT:
        try:
            _upload({**base, "caption": caption, "parse_mode": "HTML"}, filename, data)
            return
        except urllib.error.HTTPError as e:
            if e.code != 400:
                raise
    _upload({**base, "caption": plain(caption)[:CAPTION_LIMIT]} if caption else base, filename, data)

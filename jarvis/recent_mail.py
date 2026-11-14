"""Son mailleri botun okuyabileceği yere (Cloudflare KV) aktarır.

Bot (worker) mail kutusuna bağlanamaz; "en son ne mail geldi?" sorusuna cevap verebilmesi için
mail ajanı gördüğü son mailleri kısa hâlleriyle botun deposuna yazar. Bildirim akışından bağımsızdır:
burada bir şey bozulursa bildirimler etkilenmez.

Repo herkese açık olduğu için kayıtlara hesap kimliği, gönderen ya da konu yazılmaz.
"""
import json
import urllib.error
import urllib.request
from email.utils import parseaddr, parsedate_to_datetime
from urllib.parse import quote

CF = "https://api.cloudflare.com/client/v4"
NAMESPACE = "jarvis"          # botun deposunun adı (scripts/deploy_worker.sh ile aynı)
KEY = "mail:recent"           # worker/src/logic.js içindeki MAIL_KEY ile aynı
LIMIT = 15                    # saklanan mail sayısı
TEXT_CHARS = 1500             # her mailden saklanan yazı uzunluğu
READY_FLAG = "mail_recent_ready"


class BotStore:
    """Botun deposuna Cloudflare API'siyle erişim."""

    def __init__(self, token):
        self.token = token
        self.base = None

    def _call(self, method, url, data=None):
        req = urllib.request.Request(url, data=data, method=method, headers={
            "Authorization": f"Bearer {self.token}", "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.read()

    def _locate(self):
        if self.base is None:
            account = json.loads(self._call("GET", f"{CF}/accounts"))["result"][0]["id"]
            spaces = json.loads(self._call("GET", f"{CF}/accounts/{account}/storage/kv/namespaces?per_page=100"))["result"]
            space = next(s["id"] for s in spaces if s["title"] == NAMESPACE)
            self.base = f"{CF}/accounts/{account}/storage/kv/namespaces/{space}/values/"
        return self.base

    def get(self, key):
        try:
            return self._call("GET", self._locate() + quote(key, safe="")).decode()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            raise

    def put(self, key, text):
        self._call("PUT", self._locate() + quote(key, safe=""), text.encode())


def record(uid, msg, decode, body_text, attachment_names):
    """Bir mailin botta saklanacak kısa hâli."""
    name, addr = parseaddr(decode(msg.get("From")))
    try:
        at = int(parsedate_to_datetime(str(msg.get("Date"))).timestamp() * 1000)
    except Exception:
        at = None
    return {
        "uid": uid,
        "from": name or addr or "(bilinmeyen gönderen)",
        "subject": decode(msg.get("Subject")) or "(konusuz)",
        "at": at,
        "text": body_text(msg, TEXT_CHARS),
        "files": attachment_names(msg)[:5],
    }


def merge(stored, new):
    """Saklanan listeye yeni mailleri ekler; aynı mail iki kez girmez, en yeni LIMIT tanesi kalır (eskiden yeniye)."""
    by_uid = {m["uid"]: m for m in stored if isinstance(m, dict) and "uid" in m}
    by_uid.update({m["uid"]: m for m in new})
    return [by_uid[uid] for uid in sorted(by_uid)][-LIMIT:]


def sync(store, state, new_records, load_latest):
    """Yeni mailleri bota aktarır. Depo boşsa ya da önceki aktarım yarım kaldıysa load_latest(LIMIT) ile
    son mailler baştan yüklenir. Dönen değer: aktarım yapıldıysa True.
    """
    ready = state.data.get(READY_FLAG)
    if ready and not new_records:
        return False
    try:
        stored = json.loads(store.get(KEY) or "null")["mails"]   # depoya ulaşılamıyorsa burada durur, mail kutusu yorulmaz
    except (TypeError, KeyError, ValueError):
        stored = None
    if not ready or stored is None:
        stored = load_latest(LIMIT)
    store.put(KEY, json.dumps({"mails": merge(stored, new_records)}, ensure_ascii=False))
    state.data[READY_FLAG] = True
    return True

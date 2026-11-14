"""Okul maili ajanı.

Zimbra gelen kutusuna IMAP ile bakar, yeni mailleri Telegram'a bildirir.
Mailler okunmuş olarak işaretlenmez. Çalıştırma: python -m jarvis.agents.mail_notifier

Repo herkese açık olduğu için kayıtlara gönderen, konu ya da adres yazılmaz; sadece sayılar yazılır.
"""
import email
import email.policy
import imaplib
import os
import re
from email.header import decode_header, make_header
from email.utils import parseaddr
from urllib.parse import urlparse

from jarvis import recent_mail
from jarvis.agents.canvas_notifier import esc, skip_for_quiet_hours, strip_html
from jarvis.channels import telegram
from jarvis.state import State

DEFAULT_HOST = "posta.agu.edu.tr"
MAX_PER_RUN = 15                 # bir turda en fazla bu kadar mail tek tek bildirilir
MAX_FETCH_BYTES = 15 * 1024 * 1024
PREVIEW_CHARS = 200
MENU_IMAGE_MIN_BYTES = 50 * 1024   # yemek listesi büyük bir tablo resmi; imza logoları bundan küçük


def decode(value):
    try:
        return str(make_header(decode_header(value or ""))).strip()
    except Exception:
        return (value or "").strip()


# Cevaplarda eski yazışmanın başladığı yer. HTML'de alıntı bölümü, düz yazıda alıntı başlığı satırı.
HTML_QUOTE = re.compile(
    r'(?is)<hr[^>]*id="?zwchr|data-marker="__(?:DIVIDER|HEADERS|QUOTED_TEXT)__"|<blockquote'
    r'|class="[^"]*gmail_quote|id="?(?:divRplyFwdMsg|appendonsend)')
TEXT_QUOTE = re.compile(
    r"(?im)^[ \t]*(?:"
    r"-{2,}[ \t]*(?:orijinal mesaj|original message|özgün ileti|iletilen mesaj|forwarded message).*"
    r"|_{10,}[ \t]*"
    r"|>.*"
    r"|on .{1,200} wrote:[ \t]*"
    r"|.{1,200} tarihinde .{1,200} yazdı:[ \t]*"
    r"|(?:kimden|gönderen|from)[ \t]*:.*(?:\r?\n.*){0,3}?\r?\n[ \t]*(?:kime|alıcı|to|gönderilenler|gönderildi|tarih|sent|date)[ \t]*:.*"
    r")$")
# Okulun her maile kendiliğinden eklediği yasal uyarı ("Bu e-posta mesajı kişiye özel olup ...").
DISCLAIMER = re.compile(r"(?is)bu\s+e-?posta\s+mesaj[ıi]\s+ki[sş]iye\s+[oö]zel.*")


def own_text(text, is_html=False, keep_quote=False):
    """Mailden sadece yeni yazılan kısmı bırakır: alıntılanan eski yazışmayı ve yasal uyarıyı atar."""
    if is_html:
        text = re.sub(r"(?is)<(style|script|head).*?</\1>", " ", text)
    m = None if keep_quote else (HTML_QUOTE if is_html else TEXT_QUOTE).search(text)
    if m:
        # HTML'de eşleşme bir etiketin içinde olabilir; o etiketin başından kes.
        text = text[:text.rfind("<", 0, m.start() + 1) if is_html else m.start()]
    return DISCLAIMER.sub("", text)


def body_preview(msg, limit=PREVIEW_CHARS):
    """Mailin yazı kısmından kısa bir önizleme çıkarır."""
    part = msg.get_body(preferencelist=("plain", "html")) if hasattr(msg, "get_body") else None
    if part is None:
        return ""
    try:
        text = part.get_content()
    except Exception:
        return ""
    is_html = part.get_content_type() == "text/html"
    # Yeni yazılan kısım boşsa (ör. sadece iletilen bir mail) alıntıyı da göster.
    return (strip_html(own_text(text, is_html), limit)
            or strip_html(own_text(text, is_html, keep_quote=True), limit))


# Canvas her duyuru, ödev ve tartışma için bir de mail atar; bunları Canvas ajanı zaten bildiriyor.
CANVAS_ORIGIN = re.compile(r"https?://[^/\s\"'<>]+/profile/communication", re.I)   # her Canvas mailinin altındaki ayar bağlantısı
CANVAS_LINK = re.compile(r"https?://([^/\s\"'<>]+)/courses/\d+/(announcements|discussion_topics|assignments)/\d+([^\s\"'<>]*)", re.I)


def text_parts(msg):
    """Mailin yazı bölümlerini (düz ve HTML) birleştirir."""
    out = []
    for part in msg.walk():
        if part.get_content_maintype() != "text" or part.get_filename():
            continue
        try:
            out.append(part.get_content())
        except Exception:
            pass
    return "\n".join(out)


def canvas_duplicate(msg, canvas_host=""):
    """Bu mail, Canvas ajanının zaten bildirdiği bir şeyin (duyuru, tartışma, ödev) Canvas'tan gelen kopyası mı?

    İki koşul birden aranır: mail Canvas'tan gelmiş olmalı ve bir duyuru/tartışma/ödev sayfasına bağlantı vermeli.
    Mesajlar ve teslim yorumları gibi diğer Canvas mailleri bildirilmeye devam eder, çünkü içerikleri başka yerden gelmiyor.
    """
    text = text_parts(msg)
    _, addr = parseaddr(decode(msg.get("From")))
    domain = addr.rsplit("@", 1)[-1].lower() if "@" in addr else ""
    # Canvas, bildirim maillerini "Auto-Submitted: auto-generated" başlığıyla gönderir.
    automatic = str(msg.get("Auto-Submitted") or "").lower().startswith("auto-generated")
    from_canvas = (bool(CANVAS_ORIGIN.search(text)) or domain.endswith("instructure.com")
                   or bool(canvas_host) and (domain == canvas_host.lower() or automatic))
    if not from_canvas:
        return False
    for m in CANVAS_LINK.finditer(text):
        host, kind, rest = m.group(1).lower(), m.group(2).lower(), m.group(3).lower()
        if canvas_host and host != canvas_host.lower():
            continue
        if kind == "assignments" and "submissions" in rest:
            continue   # not ya da teslim yorumu: yorumu yalnızca mail taşıyor
        return True
    return False


def attachment_names(msg):
    return [decode(p.get_filename()) for p in msg.iter_attachments() if p.get_filename()]


def notification(msg):
    name, addr = parseaddr(decode(msg.get("From")))
    sender = name or addr or "(bilinmeyen gönderen)"
    subject = decode(msg.get("Subject")) or "(konusuz)"
    lines = [f"📧 <b>{esc(sender)}</b>", esc(subject)]
    preview = body_preview(msg)
    if preview:
        lines.append(f"<i>{esc(preview)}</i>")
    files = attachment_names(msg)
    if files:
        lines.append("📎 " + esc(", ".join(files[:5])) + (f" (+{len(files) - 5})" if len(files) > 5 else ""))
    return "\n".join(lines)


def menu_image(msg):
    """Mail yemek listesi olabilir mi? Öyleyse en büyük resmini (bayt, uzantı) döndürür, değilse None.

    Ölçüt bilerek gevşek: konuda "yemek" geçsin ve mailde büyük bir resim olsun.
    Resmin gerçekten liste olup olmadığına OCR adımı karar verir.
    """
    if "yemek" not in decode(msg.get("Subject")).replace("İ", "i").lower():
        return None
    best = None
    for part in msg.walk():
        if part.get_content_maintype() != "image":
            continue
        data = part.get_payload(decode=True) or b""
        if len(data) >= MENU_IMAGE_MIN_BYTES and (best is None or len(data) > len(best[0])):
            best = (data, part.get_content_subtype().replace("jpeg", "jpg"))
    return best


def save_menu_image(msg, out_dir):
    """Mail yemek listesi adayıysa resmini out_dir içine kaydeder ve yolunu döndürür."""
    found = menu_image(msg)
    if not found or not out_dir:
        return None
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f"menu.{found[1]}")
    with open(path, "wb") as f:
        f.write(found[0])
    print("Yemek listesi adayı bir resim kaydedildi.")
    return path


class Mailbox:
    """Gelen kutusuna salt okunur IMAP erişimi."""

    def __init__(self, host, user, password):
        self.conn = imaplib.IMAP4_SSL(host, 993, timeout=30)
        # Zimbra kurulumuna göre kullanıcı adı tam adres ya da @ öncesi olabilir.
        candidates = [user] + ([user.split("@")[0]] if "@" in user else [])
        last_error = None
        for candidate in candidates:
            try:
                self.conn.login(candidate, password)
                break
            except imaplib.IMAP4.error as e:
                last_error = e
        else:
            raise SystemExit(f"Mail girişi başarısız (IMAP açık mı, şifre doğru mu?): {last_error}")
        typ, _ = self.conn.select("INBOX", readonly=True)
        if typ != "OK":
            raise SystemExit("Gelen kutusu açılamadı.")
        typ, data = self.conn.response("UIDVALIDITY")
        self.uidvalidity = int(data[0]) if data and data[0] else 0

    def uids_after(self, last_uid):
        typ, data = self.conn.uid("SEARCH", None, f"UID {last_uid + 1}:*")
        uids = [int(u) for u in (data[0] or b"").split()] if typ == "OK" else []
        return sorted(u for u in uids if u > last_uid)  # "n:*" en az bir sonuç döndürür, süz

    def all_uids(self):
        typ, data = self.conn.uid("SEARCH", None, "ALL")
        return sorted(int(u) for u in (data[0] or b"").split()) if typ == "OK" else []

    def max_uid(self):
        return max(self.all_uids(), default=0)

    def fetch(self, uid):
        """Maili okunmuş işaretlemeden getirir. Çok büyükse sadece başlıkları alır."""
        typ, data = self.conn.uid("FETCH", str(uid), "(RFC822.SIZE)")
        m = re.search(rb"RFC822\.SIZE (\d+)", data[0] if isinstance(data[0], bytes) else b"") if typ == "OK" and data else None
        what = "(BODY.PEEK[])" if m and int(m.group(1)) <= MAX_FETCH_BYTES else "(BODY.PEEK[HEADER])"
        typ, data = self.conn.uid("FETCH", str(uid), what)
        raw = next((part[1] for part in data or [] if isinstance(part, tuple)), None)
        return email.message_from_bytes(raw, policy=email.policy.default) if raw else None

    def latest_with(self, keyword, predicate, limit=10):
        """Konusunda keyword geçen son maillerden predicate'i sağlayan en yenisini döndürür."""
        typ, data = self.conn.uid("SEARCH", None, "SUBJECT", f'"{keyword}"')
        uids = [int(u) for u in (data[0] or b"").split()] if typ == "OK" else []
        for uid in sorted(uids, reverse=True)[:limit]:
            msg = self.fetch(uid)
            if msg is not None and predicate(msg):
                return msg
        return None

    def close(self):
        try:
            self.conn.logout()
        except Exception:
            pass


def mail_record(uid, msg):
    return recent_mail.record(uid, msg, decode, body_preview, attachment_names)


def latest_records(mailbox, count):
    """Gelen kutusundaki son mailleri botta saklanacak hâlleriyle döndürür."""
    out = []
    for uid in mailbox.all_uids()[-count:]:
        msg = mailbox.fetch(uid)
        if msg is not None:
            out.append(mail_record(uid, msg))
    return out


def run(mailbox, send, state, on_message=None, canvas_host="", store=None):
    """Yeni mailleri bildirir. on_message(msg): her yeni mail için ek iş (ör. yemek menüsü).

    Canvas ajanının zaten bildirdiği Canvas mailleri (duyuru, tartışma, ödev) atlanır.
    store verilirse görülen son mailler bota da aktarılır ("en son ne mail geldi?" sorusu için).
    """
    data = state.data
    first_run = "mail_last_uid" not in data or data.get("mail_uidvalidity") != mailbox.uidvalidity
    if first_run:
        # İlk bağlantıda eski mailleri bildirme, sadece nerede kaldığımızı kaydet.
        data["mail_uidvalidity"] = mailbox.uidvalidity
        data["mail_last_uid"] = mailbox.max_uid()
        send("📧 Okul mailin bağlandı. Bundan sonra gelen yeni mailleri buraya yazacağım.")
        share_with_bot(store, state, mailbox, [])
        state.save()
        return 0

    uids = mailbox.uids_after(data["mail_last_uid"])
    skipped = max(len(uids) - MAX_PER_RUN, 0)
    sent = duplicates = 0
    records = []
    try:
        if skipped:
            send(f"📧 {len(uids)} yeni mail var; en yeni {MAX_PER_RUN} tanesini gösteriyorum.")
            data["mail_last_uid"] = uids[skipped - 1]
        for uid in uids[skipped:]:
            msg = mailbox.fetch(uid)
            if msg is not None:
                records.append(mail_record(uid, msg))   # Canvas kopyaları da "gelen mail"dir, bota aktarılır
            if msg is not None and canvas_duplicate(msg, canvas_host):
                duplicates += 1
            elif msg is not None:
                send(notification(msg))
                sent += 1
                if on_message:
                    try:
                        on_message(msg)
                    except Exception as e:  # ek iş bozulsa da bildirimler sürsün
                        print(f"Ek işlem hatası: {type(e).__name__}")
            data["mail_last_uid"] = uid
    finally:
        share_with_bot(store, state, mailbox, records)
        state.save()
        if duplicates:
            print(f"{duplicates} Canvas maili atlandı (Canvas bildirimi olarak zaten gidiyor)")
    return sent


def share_with_bot(store, state, mailbox, records):
    """Son mailleri bota aktarır. Aktarım bozulsa da bildirimler etkilenmez; bir sonraki turda yeniden denenir."""
    if store is None:
        return
    try:
        if recent_mail.sync(store, state, records, lambda count: latest_records(mailbox, count)):
            print("Son mailler bota aktarıldı")
    except Exception as e:  # hesap kimliği ya da adres kayda düşmesin: yalnızca hatanın türü
        state.data[recent_mail.READY_FLAG] = False   # bu turun mailleri eksik kalmasın: sonraki turda liste baştan kurulur
        print(f"Son mailler bota aktarılamadı ({type(e).__name__}{' ' + str(e.code) if hasattr(e, 'code') else ''})")


def main():
    user, password = os.environ.get("ZIMBRA_EMAIL"), os.environ.get("ZIMBRA_PASSWORD")
    if not user or not password:
        print("ZIMBRA_EMAIL / ZIMBRA_PASSWORD girilmemiş, mail ajanı atlandı.")
        return
    if skip_for_quiet_hours():
        print("Sessiz saatler: mail kontrolü sabaha bırakıldı")
        return
    mailbox = Mailbox(os.environ.get("ZIMBRA_IMAP_HOST") or DEFAULT_HOST, user, password)
    menu_dir = os.environ.get("MENU_IMAGE_DIR")
    try:
        canvas_host = urlparse(os.environ.get("CANVAS_BASE_URL") or "").hostname or ""
        token = os.environ.get("CLOUDFLARE_API_TOKEN")
        sent = run(mailbox, telegram.send, State("mail"), on_message=lambda m: save_menu_image(m, menu_dir),
                   canvas_host=canvas_host, store=recent_mail.BotStore(token) if token else None)
        if os.environ.get("MENU_REIMPORT") == "true":
            # Elle tetikleme: gelen kutusundaki en son yemek listesini yeniden oku.
            msg = mailbox.latest_with("yemek", lambda m: menu_image(m) is not None)
            if msg is None or not save_menu_image(msg, menu_dir):
                print("Gelen kutusunda resimli bir yemek listesi maili bulunamadı.")
    finally:
        mailbox.close()
    print(f"{sent} mail bildirildi")


if __name__ == "__main__":
    main()

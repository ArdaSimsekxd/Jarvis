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

from jarvis.agents.canvas_notifier import esc, strip_html
from jarvis.channels import telegram
from jarvis.state import State

DEFAULT_HOST = "posta.agu.edu.tr"
MAX_PER_RUN = 15                 # bir turda en fazla bu kadar mail tek tek bildirilir
MAX_FETCH_BYTES = 15 * 1024 * 1024
PREVIEW_CHARS = 200


def decode(value):
    try:
        return str(make_header(decode_header(value or ""))).strip()
    except Exception:
        return (value or "").strip()


def body_preview(msg):
    """Mailin yazı kısmından kısa bir önizleme çıkarır."""
    part = msg.get_body(preferencelist=("plain", "html")) if hasattr(msg, "get_body") else None
    if part is None:
        return ""
    try:
        text = part.get_content()
    except Exception:
        return ""
    if part.get_content_type() == "text/html":
        text = re.sub(r"(?is)<(style|script|head).*?</\1>", " ", text)
    return strip_html(text, PREVIEW_CHARS)


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

    def max_uid(self):
        typ, data = self.conn.uid("SEARCH", None, "ALL")
        uids = [int(u) for u in (data[0] or b"").split()] if typ == "OK" else []
        return max(uids) if uids else 0

    def fetch(self, uid):
        """Maili okunmuş işaretlemeden getirir. Çok büyükse sadece başlıkları alır."""
        typ, data = self.conn.uid("FETCH", str(uid), "(RFC822.SIZE)")
        m = re.search(rb"RFC822\.SIZE (\d+)", data[0] if isinstance(data[0], bytes) else b"") if typ == "OK" and data else None
        what = "(BODY.PEEK[])" if m and int(m.group(1)) <= MAX_FETCH_BYTES else "(BODY.PEEK[HEADER])"
        typ, data = self.conn.uid("FETCH", str(uid), what)
        raw = next((part[1] for part in data or [] if isinstance(part, tuple)), None)
        return email.message_from_bytes(raw, policy=email.policy.default) if raw else None

    def close(self):
        try:
            self.conn.logout()
        except Exception:
            pass


def run(mailbox, send, state, on_message=None):
    """Yeni mailleri bildirir. on_message(msg): her yeni mail için ek iş (ör. yemek menüsü)."""
    data = state.data
    first_run = "mail_last_uid" not in data or data.get("mail_uidvalidity") != mailbox.uidvalidity
    if first_run:
        # İlk bağlantıda eski mailleri bildirme, sadece nerede kaldığımızı kaydet.
        data["mail_uidvalidity"] = mailbox.uidvalidity
        data["mail_last_uid"] = mailbox.max_uid()
        send("📧 Okul mailin bağlandı. Bundan sonra gelen yeni mailleri buraya yazacağım.")
        state.save()
        return 0

    uids = mailbox.uids_after(data["mail_last_uid"])
    skipped = max(len(uids) - MAX_PER_RUN, 0)
    sent = 0
    try:
        if skipped:
            send(f"📧 {len(uids)} yeni mail var; en yeni {MAX_PER_RUN} tanesini gösteriyorum.")
            data["mail_last_uid"] = uids[skipped - 1]
        for uid in uids[skipped:]:
            msg = mailbox.fetch(uid)
            if msg is not None:
                send(notification(msg))
                sent += 1
                if on_message:
                    try:
                        on_message(msg)
                    except Exception as e:  # ek iş bozulsa da bildirimler sürsün
                        print(f"Ek işlem hatası: {type(e).__name__}")
            data["mail_last_uid"] = uid
    finally:
        state.save()
    return sent


def main():
    user, password = os.environ.get("ZIMBRA_EMAIL"), os.environ.get("ZIMBRA_PASSWORD")
    if not user or not password:
        print("ZIMBRA_EMAIL / ZIMBRA_PASSWORD girilmemiş, mail ajanı atlandı.")
        return
    mailbox = Mailbox(os.environ.get("ZIMBRA_IMAP_HOST") or DEFAULT_HOST, user, password)
    try:
        sent = run(mailbox, telegram.send, State("mail"))
    finally:
        mailbox.close()
    print(f"{sent} mail bildirildi")


if __name__ == "__main__":
    main()

"""Mail ajanı testi (sahte gelen kutusu). Çalıştırma: python -m unittest discover tests"""
import email
import email.policy
import io
import json
import tempfile
import unittest
import urllib.error
from email.message import EmailMessage
from unittest import mock

from jarvis import recent_mail
from jarvis import state as state_mod
from jarvis.agents import mail_notifier as mn


def make(sender, subject, body="", html=None, attachments=()):
    m = EmailMessage()
    m["From"], m["Subject"] = sender, subject
    m.set_content(body)
    if html:
        m.add_alternative(html, subtype="html")
    for name in attachments:
        m.add_attachment(b"%PDF-1.4", maintype="application", subtype="pdf", filename=name)
    # gerçekte olduğu gibi bayt olarak gidip gelsin (başlık kodlamaları dahil)
    return email.message_from_bytes(m.as_bytes(), policy=email.policy.default)


class FakeMailbox:
    uidvalidity = 7

    def __init__(self, mails):
        self.mails = dict(mails)

    def max_uid(self):
        return max(self.mails, default=0)

    def uids_after(self, last):
        return sorted(u for u in self.mails if u > last)

    def fetch(self, uid):
        self.fetched = getattr(self, "fetched", 0) + 1
        return self.mails[uid]

    def all_uids(self):
        return sorted(self.mails)


class FakeStore:
    """Botun deposu (Cloudflare KV) yerine."""

    def __init__(self):
        self.values = {}
        self.broken = False

    def get(self, key):
        if self.broken:
            raise OSError("ulaşılamadı")
        return self.values.get(key)

    def put(self, key, text):
        if self.broken:
            raise OSError("ulaşılamadı")
        self.values[key] = text


class MailNotifierTest(unittest.TestCase):
    def setUp(self):
        state_mod.STATE_DIR = tempfile.mkdtemp()

    def run_once(self, box, on_message=None):
        sent = []
        mn.run(box, sent.append, state_mod.State("mail"), on_message)
        return sent

    def test_flow(self):
        box = FakeMailbox({5: make("Eski <eski@agu.edu.tr>", "Eski mail")})
        sent = self.run_once(box)
        self.assertEqual(len(sent), 1)
        self.assertIn("Okul mailin bağlandı", sent[0])
        self.assertEqual(self.run_once(box), [])

        box.mails[6] = make("Öğrenci İşleri <ogrenci@agu.edu.tr>", "Kasım ayı yemek menüsü <güncel>",
                            "Merhaba,\n\nKasım ayı menüsü ektedir.\nAfiyet olsun.", attachments=["menu-kasim.pdf"])
        box.mails[7] = make("hoca@agu.edu.tr", "", html="<html><head><style>p{color:red}</style></head><body><p>Yarın <b>ders yok</b></p></body></html>")
        seen = []
        sent = self.run_once(box, on_message=lambda m: seen.append(m["Subject"]))
        self.assertEqual(len(sent), 2)
        self.assertEqual(sent[0], "📧 <b>Öğrenci İşleri</b>\nKasım ayı yemek menüsü &lt;güncel&gt;\n"
                                  "<i>Merhaba, Kasım ayı menüsü ektedir. Afiyet olsun.</i>\n📎 menu-kasim.pdf")
        self.assertIn("<b>hoca@agu.edu.tr</b>\n(konusuz)", sent[1])
        self.assertNotIn("color:red", sent[1])
        self.assertEqual(len(seen), 2)
        self.assertEqual(self.run_once(box), [])

    def test_preview_drops_quoted_reply_and_disclaimer(self):
        uyari = ("Bu e-posta mesaji kisiye ozel olup, hizmete ozel bilgiler iceriyor olabilir. "
                 "Bu e-posta mesaji, hic bir sekilde, herhangi bir amac icin cogaltilamaz.")
        alinti = ('Kimden: "arda simsek" <arda@agu.edu.tr>\nKime: "beyza" <beyza@agu.edu.tr>\n'
                  "Gönderilenler: 13 Kasım Cuma 2026 10:36:34\n\nMerhaba\n" + uyari)
        cases = {
            # Zimbra düz yazı cevabı (başlıklı ve başlıksız)
            "selam123\n\n----- Orijinal Mesaj -----\n" + alinti: "selam123",
            "selam123\n\n" + alinti: "selam123",
            # diğer posta programları
            "Tamamdır.\n\nOn Fri, Nov 13, 2026 at 10:36 AM Arda <a@agu.edu.tr> wrote:\n> Merhaba": "Tamamdır.",
            "Olur.\n\n13 Kas 2026 Cum, 10:36 tarihinde Arda <a@agu.edu.tr> şunu yazdı:\n> Merhaba": "Olur.",
            # alıntı yok, sadece yasal uyarı
            "Merhaba\n\n" + uyari: "Merhaba",
            # içinde 'Kimden:' geçen ama alıntı olmayan yazı kesilmez
            "Kimden: sorusunu hocaya sordum, cevap bekliyorum.": "Kimden: sorusunu hocaya sordum, cevap bekliyorum.",
        }
        for body, expected in cases.items():
            self.assertEqual(mn.body_preview(make("a@agu.edu.tr", "Re:", body)), expected, body)

        html = ('<html><body><div>selam123</div><hr id="zwchr" data-marker="__DIVIDER__">'
                '<div data-marker="__HEADERS__"><b>Kimden: </b>"arda simsek"</div><div>Merhaba ' + uyari + "</div></body></html>")
        msg = make("a@agu.edu.tr", "Re:", "", html=html)
        self.assertEqual(mn.own_text(msg.get_body(preferencelist=("html",)).get_content(), is_html=True).count("Kimden"), 0)
        self.assertEqual(mn.strip_html(mn.own_text(html, is_html=True)), "selam123")

        # Sadece iletilen bir mailde yeni yazı yoktur: alıntı gösterilir, yasal uyarı yine atılır.
        forwarded = mn.body_preview(make("a@agu.edu.tr", "Fwd: sınav", "----- İletilen Mesaj -----\nKimden: hoca\nKime: sınıf\n\nSınav cuma günü.\n" + uyari))
        self.assertIn("Sınav cuma günü.", forwarded)
        self.assertNotIn("kisiye ozel", forwarded)

    def test_canvas_copies_are_skipped(self):
        footer = ("\n\n________________________________________\nBildirim ayarlarını değiştirmek için:\n"
                  "https://canvas.agu.edu.tr/profile/communication")
        ann = make("HIGH VOLTAGE TECHNIQUES-S1 <notifications@agu.edu.tr>", "Midterm: HIGH VOLTAGE TECHNIQUES-S1",
                   "Dear All, ...\n\nDuyuruyu görüntüle: https://canvas.agu.edu.tr/courses/12/announcements/345" + footer)
        html_ann = make("Ders <notifications@agu.edu.tr>", "Duyuru", "düz",
                        html='<p>Dear All</p><a href="https://canvas.agu.edu.tr/courses/12/discussion_topics/9">Aç</a>'
                             '<a href="https://canvas.agu.edu.tr/profile/communication">Ayarlar</a>')
        assignment = make("Ders <notifications@instructure.com>", "Ödev",
                          "Yeni ödev: https://canvas.agu.edu.tr/courses/12/assignments/77")
        auto = make("Ders <bildirim@agu.edu.tr>", "Duyuru", "https://canvas.agu.edu.tr/courses/12/announcements/345")
        auto["Auto-Submitted"] = "auto-generated"
        for m in (ann, html_ann, assignment, auto):
            self.assertTrue(mn.canvas_duplicate(m, "canvas.agu.edu.tr"))

        # Bunlar bildirilmeye devam eder: içerikleri yalnızca mailde var ya da Canvas'tan gelmiyorlar.
        comment = make("Ders <notifications@agu.edu.tr>", "Teslim yorumu",
                       "Hoca yorum yazdı: https://canvas.agu.edu.tr/courses/12/assignments/77/submissions/5" + footer)
        message = make("Hoca <notifications@agu.edu.tr>", "Mesaj",
                       "Merhaba: https://canvas.agu.edu.tr/conversations/88" + footer)
        person = make("Arkadaş <biri@agu.edu.tr>", "Bak",
                      "Şu duyuruyu gördün mü? https://canvas.agu.edu.tr/courses/12/announcements/345")
        other_site = make("Başka <x@agu.edu.tr>", "Başka",
                          "https://baska.test/courses/1/announcements/2\nhttps://baska.test/profile/communication")
        for m in (comment, message, person, other_site, make("a@agu.edu.tr", "Düz", "selam")):
            self.assertFalse(mn.canvas_duplicate(m, "canvas.agu.edu.tr"))

        box = FakeMailbox({5: make("Eski <eski@agu.edu.tr>", "Eski mail")})
        self.run_once(box)
        box.mails.update({6: ann, 7: message, 8: assignment, 9: person})
        sent = []
        self.assertEqual(mn.run(box, sent.append, state_mod.State("mail"), canvas_host="canvas.agu.edu.tr"), 2)
        self.assertEqual(len(sent), 2)
        self.assertIn("Mesaj", sent[0])
        self.assertIn("Bak", sent[1])
        self.assertEqual(state_mod.State("mail").data["mail_last_uid"], 9)   # atlananlar yeniden gelmez

    def test_many_mails_are_capped(self):
        box = FakeMailbox({1: make("a@b.c", "ilk")})
        self.run_once(box)
        for uid in range(2, 22):
            box.mails[uid] = make("a@b.c", f"mail {uid}")
        sent = self.run_once(box)
        self.assertEqual(len(sent), mn.MAX_PER_RUN + 1)
        self.assertIn("20 yeni mail var", sent[0])
        self.assertIn("mail 21", sent[-1])
        self.assertEqual(self.run_once(box), [])

    def test_failed_send_is_retried_and_hook_errors_do_not_stop(self):
        box = FakeMailbox({1: make("a@b.c", "ilk")})
        self.run_once(box)
        box.mails[2] = make("a@b.c", "iki")
        box.mails[3] = make("a@b.c", "üç")
        calls = []

        def flaky(text):
            calls.append(text)
            if len(calls) == 2:
                raise OSError("ağ")

        with self.assertRaises(OSError):
            mn.run(box, flaky, state_mod.State("mail"))
        sent = self.run_once(box, on_message=lambda m: 1 / 0)   # sadece "üç" yeniden denenir
        self.assertEqual(len(sent), 1)
        self.assertIn("üç", sent[0])

    def test_uidvalidity_change_resets_silently(self):
        box = FakeMailbox({1: make("a@b.c", "ilk")})
        self.run_once(box)
        box.uidvalidity = 8
        box.mails = {1: make("a@b.c", "yeniden numaralandı"), 2: make("a@b.c", "bu da")}
        sent = self.run_once(box)
        self.assertEqual(len(sent), 1)
        self.assertIn("bağlandı", sent[0])


class RecentMailTest(unittest.TestCase):
    """Son maillerin bota aktarılması."""

    def setUp(self):
        state_mod.STATE_DIR = tempfile.mkdtemp()

    def run_once(self, box, store):
        sent = []
        mn.run(box, sent.append, state_mod.State("mail"), store=store)
        return sent

    def stored(self, store):
        return json.loads(store.values[recent_mail.KEY])["mails"]

    def test_record(self):
        msg = make("Öğrenci İşleri <ogrenci@agu.edu.tr>", "Burs <duyurusu>", "Merhaba,\n\n" + "çok uzun " * 400,
                   attachments=["a.pdf"])
        msg["Date"] = "Fri, 13 Nov 2026 16:05:00 +0300"
        rec = mn.mail_record(9, email.message_from_bytes(msg.as_bytes(), policy=email.policy.default))
        self.assertEqual((rec["uid"], rec["from"], rec["subject"], rec["files"]), (9, "Öğrenci İşleri", "Burs <duyurusu>", ["a.pdf"]))
        self.assertEqual(rec["at"], 1794575100000)
        self.assertTrue(rec["text"].startswith("Merhaba, çok uzun"))
        self.assertLessEqual(len(rec["text"]), recent_mail.TEXT_CHARS + 1)
        self.assertIsNone(mn.mail_record(1, make("x@agu.edu.tr", ""))["at"])       # tarihi olmayan mail
        self.assertEqual(mn.mail_record(1, make("x@agu.edu.tr", ""))["subject"], "(konusuz)")

    def test_first_sync_loads_latest_then_only_new_mails_are_added(self):
        box = FakeMailbox({uid: make("a@agu.edu.tr", f"Mail {uid}", "içerik") for uid in range(1, 21)})
        store = FakeStore()
        self.run_once(box, store)                         # ilk bağlantı: son 15 mail baştan yüklenir
        self.assertEqual([m["uid"] for m in self.stored(store)], list(range(6, 21)))

        box.fetched = 0
        self.assertEqual(self.run_once(box, store), [])   # yeni mail yok: depoya da mail kutusuna da dokunulmaz
        self.assertEqual(box.fetched, 0)

        box.mails[21] = make("Hoca <hoca@agu.edu.tr>", "Yarın ders yok", "Ders iptal.")
        box.mails[22] = make("notifications@instructure.com", "Duyuru",
                             "Yeni duyuru\nhttps://canvas.agu.edu.tr/courses/3/announcements/9\nhttps://canvas.agu.edu.tr/profile/communication")
        sent = self.run_once(box, store)
        self.assertEqual(len(sent), 1)                    # Canvas kopyası bildirilmez ...
        mails = self.stored(store)
        self.assertEqual([m["uid"] for m in mails], list(range(8, 23)))   # ... ama gelen mail olarak listeye girer
        self.assertEqual((mails[-2]["from"], mails[-2]["subject"], mails[-2]["text"]), ("Hoca", "Yarın ders yok", "Ders iptal."))
        self.assertEqual(box.fetched, 2)                  # eski mailler yeniden indirilmedi

    def test_failed_sync_does_not_break_notifications_and_is_repaired(self):
        box = FakeMailbox({1: make("a@agu.edu.tr", "Eski")})
        store = FakeStore()
        self.run_once(box, store)
        store.broken = True
        box.mails[2] = make("b@agu.edu.tr", "Kaçan mail")
        box.fetched = 0
        with mock.patch("builtins.print") as printed:
            sent = self.run_once(box, store)
        self.assertEqual(len(sent), 1)                    # bildirim yine gitti
        self.assertEqual(box.fetched, 1)                  # depo bozukken mail kutusu boşuna taranmadı
        logged = " ".join(str(c) for c in printed.call_args_list)
        self.assertIn("aktarılamadı (OSError)", logged)
        self.assertNotIn("Kaçan", logged)

        store.broken = False
        self.assertEqual(self.run_once(box, store), [])   # yeni mail yok ama liste onarılır
        self.assertEqual([m["subject"] for m in self.stored(store)], ["Eski", "Kaçan mail"])

    def test_store_is_optional_and_merge_keeps_one_copy(self):
        box = FakeMailbox({1: make("a@agu.edu.tr", "Eski")})
        self.run_once(box, None)                          # Cloudflare anahtarı yoksa eskisi gibi çalışır
        merged = recent_mail.merge([{"uid": 1, "subject": "a"}, "bozuk", {"uid": 2, "subject": "b"}], [{"uid": 2, "subject": "yeni"}])
        self.assertEqual(merged, [{"uid": 1, "subject": "a"}, {"uid": 2, "subject": "yeni"}])


class BotStoreTest(unittest.TestCase):
    def test_reads_and_writes_through_the_cloudflare_api(self):
        calls = []

        def urlopen(req, timeout=None):
            calls.append((req.get_method(), req.full_url, req.data, req.get_header("Authorization")))
            url = req.full_url
            if url.endswith("/accounts"):
                body = b'{"result":[{"id":"ACC"}]}'
            elif "namespaces?" in url:
                body = b'{"result":[{"id":"N0","title":"baska"},{"id":"N1","title":"jarvis"}]}'
            elif req.get_method() == "GET" and url.endswith("/values/yok"):
                raise urllib.error.HTTPError(url, 404, "Not Found", {}, io.BytesIO(b"{}"))
            else:
                body = "değer".encode()
            return mock.MagicMock(__enter__=lambda s: s, __exit__=lambda *a: False, read=lambda: body)

        store = recent_mail.BotStore("tok")
        with mock.patch("urllib.request.urlopen", urlopen):
            self.assertEqual(store.get("mail:recent"), "değer")
            self.assertIsNone(store.get("yok"))
            store.put("mail:recent", "yeni değer")
        self.assertEqual(len(calls), 5)                   # hesap ve depo yalnızca bir kez aranır
        self.assertTrue(all(c[3] == "Bearer tok" for c in calls))
        self.assertEqual(calls[2][1], "https://api.cloudflare.com/client/v4/accounts/ACC/storage/kv/namespaces/N1/values/mail%3Arecent")
        self.assertEqual(calls[4][0], "PUT")
        self.assertEqual(calls[4][2], "yeni değer".encode())


if __name__ == "__main__":
    unittest.main()

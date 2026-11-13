"""Mail ajanı testi (sahte gelen kutusu). Çalıştırma: python -m unittest discover tests"""
import email
import email.policy
import tempfile
import unittest
from email.message import EmailMessage

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
        return self.mails[uid]


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


if __name__ == "__main__":
    unittest.main()

import io
import json
import os
import unittest
import urllib.error
from unittest import mock

from jarvis.agents import canvas_notifier as cn
from jarvis.channels import telegram
from jarvis.richtext import to_telegram

ANNOUNCEMENT = """<p>Dear All,</p>
<p>As discussed in class today, a few dates &amp; details.</p>
<p><strong>Proposal Submission</strong></p>
<p>Deadline will be <strong>October 20</strong>.</p>
<ul><li>Bir</li><li> <a href="/courses/5/files/9">Şablon</a> ve <em>sunum</em></li></ul>
<p>x &lt; y<br><br><br>Best wishes.</p><b></b><script>alert(1)</script>"""


class RichTextTest(unittest.TestCase):
    def test_paragraphs_bold_lists_and_links_survive(self):
        self.assertEqual(to_telegram(ANNOUNCEMENT, "https://c.test/courses/5/discussion_topics/1"), "\n".join([
            "Dear All,", "",
            "As discussed in class today, a few dates &amp; details.", "",
            "<b>Proposal Submission</b>", "",
            "Deadline will be <b>October 20</b>.", "",
            "• Bir",
            '• <a href="https://c.test/courses/5/files/9">Şablon</a> ve <i>sunum</i>', "",
            "x &lt; y", "",
            "Best wishes.",
        ]))

    def test_output_is_always_balanced(self):
        # Yanlış sırada kapanan ve hiç kapanmayan etiketler Telegram'ın kabul edeceği hale gelir.
        self.assertEqual(to_telegram('<b><a href="https://x.test/?a=1&b=2">bir</b> iki</a> <i>üç'),
                         '<b><a href="https://x.test/?a=1&amp;b=2">bir</a></b> iki <i>üç</i>')
        self.assertEqual(to_telegram('<a href="javascript:alert(1)">tık</a> <a>çapa</a>'), "tık çapa")
        self.assertEqual(to_telegram(None), "")
        self.assertEqual(to_telegram("düz yazı"), "düz yazı")

    def test_long_text_is_cut_at_a_word_with_a_note(self):
        out = to_telegram("<p><b>" + "kelime " * 300 + "</b></p><p>son</p>", limit=200)
        self.assertLessEqual(len(out), 260)
        self.assertTrue(out.endswith("kelime</b>… (devamı Canvas'ta)"), out[-60:])
        self.assertNotIn("son", out)

    def test_announcement_message_carries_the_whole_text(self):
        long_body = "<p>" + "Uzun bir cümle. " * 40 + "</p><p><strong>Midterm</strong></p><p>27 Ekim 14:00</p>"
        item = {"id": 1, "type": "Announcement", "course_id": 7, "title": "Tarihler",
                "message": long_body, "html_url": "https://c.test/courses/7/discussion_topics/1"}

        class Fresh:
            def seen(self, key):
                return False

        [(key, text)] = cn.activity_messages([item], {7: "EE454"}, Fresh())
        self.assertEqual(key, "ann:1")
        self.assertTrue(text.startswith("📢 [EE454] <b>Yeni duyuru:</b> Tarihler\n\nUzun bir cümle."))
        self.assertIn("<b>Midterm</b>\n\n27 Ekim 14:00\n\n<a href=", text)   # sonuna kadar geliyor
        self.assertNotIn("…", text)
        self.assertLess(len(text), telegram.LIMIT)

        # Çok uzun duyuru Telegram sınırını aşmaz, sonunda bağlantı kalır.
        item["message"] = "<p>" + "çok uzun " * 2000 + "</p>"
        [(_, text)] = cn.activity_messages([item], {7: "EE454"}, Fresh())
        self.assertLess(len(text), telegram.LIMIT)
        self.assertIn("… (devamı Canvas'ta)\n\n<a href=", text)


class TelegramFallbackTest(unittest.TestCase):
    def setUp(self):
        self.sent = []
        env = mock.patch.dict(os.environ, {"TELEGRAM_BOT_TOKEN": "t", "TELEGRAM_CHAT_ID": "1"})
        env.start()
        self.addCleanup(env.stop)

    def fake_urlopen(self, reject_html):
        def urlopen(req, timeout=None):
            payload = json.loads(req.data)
            self.sent.append(payload)
            if reject_html and payload.get("parse_mode") == "HTML":
                raise urllib.error.HTTPError(req.full_url, 400, "Bad Request", {}, io.BytesIO(b"{}"))
            return mock.MagicMock(__enter__=lambda s: s, __exit__=lambda *a: False, read=lambda: b"{}")
        return urlopen

    def test_normal_message_is_sent_as_html(self):
        with mock.patch("urllib.request.urlopen", self.fake_urlopen(False)):
            telegram.send("<b>merhaba</b>")
        self.assertEqual([(p["text"], p.get("parse_mode")) for p in self.sent], [("<b>merhaba</b>", "HTML")])

    def test_rejected_format_is_resent_as_plain_text(self):
        with mock.patch("urllib.request.urlopen", self.fake_urlopen(True)):
            telegram.send("<b>a &amp; b</b> <i>bozuk")
        self.assertEqual([(p["text"], p.get("parse_mode")) for p in self.sent],
                         [("<b>a &amp; b</b> <i>bozuk", "HTML"), ("a & b bozuk", None)])

    def test_too_long_message_goes_as_plain_text_without_cutting_a_tag(self):
        with mock.patch("urllib.request.urlopen", self.fake_urlopen(False)):
            telegram.send("<b>" + "x" * 5000 + "</b>")
        self.assertEqual(len(self.sent), 1)
        self.assertEqual(self.sent[0]["text"], "x" * telegram.LIMIT)
        self.assertNotIn("parse_mode", self.sent[0])

    def test_other_errors_still_raise(self):
        def urlopen(req, timeout=None):
            raise urllib.error.HTTPError(req.full_url, 500, "Server Error", {}, io.BytesIO(b"{}"))
        with mock.patch("urllib.request.urlopen", urlopen), self.assertRaises(urllib.error.HTTPError):
            telegram.send("x")


if __name__ == "__main__":
    unittest.main()

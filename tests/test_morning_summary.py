"""Sabah özeti testi. Çalıştırma: python -m unittest discover tests"""
import unittest
from datetime import datetime, timezone

from jarvis.agents import morning_summary as ms

NOW = datetime(2026, 11, 13, 5, 0, tzinfo=timezone.utc)  # Cuma 08:00 Türkiye saati
COURSES = {1: "MATH101", 2: "CS102"}


def a(name, due, **extra):
    return {"id": hash(name), "name": name, "due_at": due, "published": True,
            "html_url": f"https://c/{name}", **extra}


class MorningSummaryTest(unittest.TestCase):
    def test_full_summary(self):
        assignments = {
            1: [
                a("Quiz 3", "2026-11-13T20:59:00Z"),                                 # bugün 23:59
                a("Teslim edildi", "2026-11-13T18:00:00Z", submission={"submitted_at": "2026-11-12T10:00:00Z"}),
                a("Geçmiş", "2026-11-12T20:59:00Z"),                                 # dün, gösterilmez
                a("Gece yarısı", "2026-11-13T21:30:00Z"),                            # Cumartesi 00:30, bugün değil
            ],
            2: [
                a("Proje <1>", "2026-11-18T14:00:00Z"),                              # Çarşamba 17:00
                a("Uzak", "2026-11-30T20:59:00Z"),                                   # 7 günden uzak
                a("Tarihsiz", None),
                a("Taslak", "2026-11-14T10:00:00Z", published=False),
            ],
        }
        stream = [
            {"type": "Announcement", "course_id": 2, "title": "Lab iptal", "created_at": "2026-11-12T15:00:00Z",
             "html_url": "https://c/ann"},
            {"type": "Announcement", "course_id": 1, "title": "Eski duyuru", "created_at": "2026-11-10T15:00:00Z"},
            {"type": "Conversation", "title": "Mesaj", "created_at": "2026-11-12T15:00:00Z"},
        ]
        text = ms.build(COURSES, assignments, stream, NOW)

        self.assertIn("Günaydın!</b> Cuma, 13.11.2026", text)
        self.assertIn('🔴 <b>Bugün teslim</b>\n• <b>23:59</b> MATH101: <a href="https://c/Quiz 3">Quiz 3</a>', text)
        self.assertIn("• <b>Cumartesi 14.11 00:30</b> MATH101:", text)
        self.assertIn("• <b>Çarşamba 18.11 17:00</b> CS102:", text)
        self.assertIn("Proje &lt;1&gt;", text)
        self.assertLess(text.index("Cumartesi 14.11"), text.index("Çarşamba 18.11"))
        self.assertIn("CS102: <a href=\"https://c/ann\">Lab iptal</a>", text)
        for hidden in ("Teslim edildi", "Geçmiş", "Uzak", "Tarihsiz", "Taslak", "Eski duyuru", "Mesaj"):
            self.assertNotIn(hidden, text)

    def test_overdue_section(self):
        assignments = {1: [
            a("Eksik ödev", "2026-11-11T20:59:00Z", submission={"missing": True}),
            a("İşaretsiz online", "2026-11-12T20:59:00Z", submission_types=["online_upload"]),
            a("Kağıt sınav", "2026-11-12T10:00:00Z", submission_types=["on_paper"]),
            a("Eksik değil", "2026-11-12T10:00:00Z", submission={"missing": False}, submission_types=["online_upload"]),
            a("Çok eski", "2026-10-01T20:59:00Z", submission={"missing": True}),
            a("Geç teslim edildi", "2026-11-11T20:59:00Z", submission={"missing": False, "submitted_at": "2026-11-12T01:00:00Z"}),
        ]}
        text = ms.build(COURSES, assignments, [], NOW)
        self.assertIn("⚠️ <b>Gecikenler</b> (teslim edilmemiş)\n• <b>Çarşamba 11.11 23:59</b> MATH101:", text)
        self.assertIn("Eksik ödev", text)
        self.assertIn("İşaretsiz online", text)
        self.assertLess(text.index("Gecikenler"), text.index("Bugün teslim"))
        for hidden in ("Kağıt sınav", "Eksik değil", "Çok eski", "Geç teslim edildi"):
            self.assertNotIn(hidden, text)

    def test_empty_day(self):
        text = ms.build(COURSES, {1: [], 2: []}, [], NOW)
        self.assertIn("Bugün teslim edilecek ödev yok", text)
        self.assertIn("Önümüzdeki 7 günde başka teslim görünmüyor", text)
        self.assertNotIn("duyuru", text)
        self.assertNotIn("Gecikenler", text)

    def test_run_sends_one_message(self):
        class Fake:
            def get(self, path, params=None):
                if path == "courses":
                    return [{"id": 1, "course_code": "MATH101"}]
                if path.endswith("/assignments"):
                    assert params["include[]"] == "submission"
                    return [a("Quiz 3", "2026-11-13T20:59:00Z")]
                return []

        sent = []
        ms.run(Fake(), sent.append, NOW)
        self.assertEqual(len(sent), 1)
        self.assertIn("Quiz 3", sent[0])


if __name__ == "__main__":
    unittest.main()

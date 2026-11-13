"""Ders programı ve akşam önizlemesi testi. Çalıştırma: python -m unittest discover tests"""
import unittest
from datetime import date, datetime, timezone

from jarvis import schedule
from jarvis.agents import evening_preview as ep
from jarvis.agents import morning_summary as ms

PROGRAM = """
# örnek program
Pazartesi 10:00-11:45 EE452 F0C04
pazartesi 9.00 - 9.45 MATH101
ÇARŞAMBA 16:00-17:45 EE298 A/S1 uygulama
Cumartesi 14:00-15:45 <Kulüp> Salon haftada bir
bozuk satır
Funday 10:00-11:00 X Y
"""
COURSES = {1: "EE452"}


def a(name, due, **extra):
    return {"id": hash(name), "name": name, "due_at": due, "published": True, "html_url": f"https://c/{name}", **extra}


class ScheduleTest(unittest.TestCase):
    def test_parse_and_lines(self):
        s = schedule.parse(PROGRAM)
        self.assertEqual(sorted(s), [0, 2, 5])
        self.assertEqual(schedule.lines_for(s, date(2026, 11, 16)),   # Pazartesi: saate göre sıralı
                         ["• <b>09:00–09:45</b> MATH101", "• <b>10:00–11:45</b> EE452 · F0C04"])
        self.assertEqual(schedule.lines_for(s, date(2026, 11, 18)), ["• <b>16:00–17:45</b> EE298 · A/S1 (uygulama)"])
        self.assertEqual(schedule.lines_for(s, date(2026, 11, 14)), ["• <b>14:00–15:45</b> &lt;Kulüp&gt; · Salon (haftada bir)"])
        self.assertEqual(schedule.lines_for(s, date(2026, 11, 17)), [])
        self.assertEqual(schedule.parse(""), {})
        self.assertEqual(schedule.lines_for(None, date(2026, 11, 16)), [])

    def test_morning_summary_shows_todays_lessons(self):
        now = datetime(2026, 11, 16, 5, 0, tzinfo=timezone.utc)   # Pazartesi 08:00
        text = ms.build(COURSES, {1: []}, [], now, schedule=schedule.parse(PROGRAM))
        self.assertIn("📚 <b>Bugünün dersleri</b>\n• <b>09:00–09:45</b> MATH101\n• <b>10:00–11:45</b> EE452 · F0C04", text)
        self.assertNotIn("Bugünün dersleri", ms.build(COURSES, {1: []}, [], now))


class EveningPreviewTest(unittest.TestCase):
    NOW = datetime(2026, 11, 15, 18, 0, tzinfo=timezone.utc)   # Pazar 21:00 Türkiye saati

    def test_full_preview(self):
        assignments = {1: [
            a("Bu gece", "2026-11-15T20:59:00Z"),                 # Pazar 23:59
            a("Geçti", "2026-11-15T17:00:00Z"),                   # 20:00, geçmiş
            a("Yarın <1>", "2026-11-16T14:00:00Z"),               # Pazartesi 17:00
            a("Yarın teslim edildi", "2026-11-16T15:00:00Z", submission={"submitted_at": "2026-11-14T10:00:00Z"}),
            a("Gece yarısından sonra", "2026-11-15T21:30:00Z"),   # Pazartesi 00:30 -> yarın
            a("Öbür gün", "2026-11-17T10:00:00Z"),
            a("Taslak", "2026-11-16T10:00:00Z", published=False),
        ]}
        menu = {"days": {"2026-11-16": {"Çorba": "Mercimek", "Ana yemek": "Tavuk"}, "2026-11-15": ["bugün"]}}
        text = ep.build(COURSES, assignments, self.NOW, menu, schedule.parse(PROGRAM))

        self.assertTrue(text.startswith("🌙 <b>Yarın:</b> Pazartesi, 16.11.2026"))
        self.assertIn('🚨 <b>Bu gece teslim</b>\n• <b>23:59</b> EE452: <a href="https://c/Bu gece">Bu gece</a>', text)
        self.assertIn("📚 <b>Yarının dersleri</b>\n• <b>09:00–09:45</b> MATH101", text)
        self.assertIn("🔴 <b>Yarın teslim</b>\n• <b>00:30</b> EE452: ", text)
        self.assertIn("Yarın &lt;1&gt;", text)
        self.assertIn("🍽 <b>Yarının menüsü</b>\n• <b>Çorba:</b> Mercimek", text)
        for hidden in ("Geçti", "teslim edildi", "Öbür gün", "Taslak", "bugün"):
            self.assertNotIn(hidden, text)

    def test_nothing_to_say_sends_nothing(self):
        saturday = datetime(2026, 11, 14, 18, 0, tzinfo=timezone.utc)   # yarın Pazar: ders, teslim, menü yok
        self.assertIsNone(ep.build(COURSES, {1: [a("Uzak", "2026-11-20T10:00:00Z")]}, saturday, {"days": {}}, schedule.parse(PROGRAM)))

        sent = []

        class FakeCanvas:
            def get(self, path, params=None, max_pages=None):
                return [{"id": 1, "course_code": "EE452"}] if path == "courses" else []

        self.assertFalse(ep.run(FakeCanvas(), sent.append, saturday))
        self.assertEqual(sent, [])


if __name__ == "__main__":
    unittest.main()

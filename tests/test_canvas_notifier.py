"""Sahte Canvas verisiyle uçtan uca test. Çalıştırma: python -m unittest discover tests"""
import os
import tempfile
import unittest
from datetime import datetime, timezone

os.environ["JARVIS_STATE_DIR"] = tempfile.mkdtemp()

from jarvis import state as state_mod
from jarvis.agents import canvas_notifier as cn


NOW = datetime(2026, 11, 13, 9, 0, tzinfo=timezone.utc)


class FakeCanvas:
    base = "https://c"

    def __init__(self):
        self.modules = []
        self.files = []
        self.courses = [{"id": 1, "course_code": "MATH101", "name": "Calculus"}]
        self.stream = [
            {"id": 10, "type": "Announcement", "course_id": 1, "title": "Vize <tarihi>",
             "message": "<p>Vize&nbsp;cuma günü.</p>", "html_url": "https://c/a/10"},
            {"id": 11, "type": "Submission", "course_id": 1, "title": "Quiz 1",
             "score": None, "grade": None, "assignment": {"name": "Quiz 1", "points_possible": 10}},
        ]
        self.assignments = [{"id": 100, "name": "Ödev 1", "due_at": "2026-11-20T20:59:00Z",
                             "html_url": "https://c/as/100", "published": True}]

    def get(self, path, params=None, max_pages=None):
        if path == "courses":
            return self.courses
        if path == "users/self/activity_stream":
            return self.stream
        if path == "courses/1/assignments":
            assert params["include[]"] == "submission"
            return self.assignments
        if path == "courses/1/modules":
            return self.modules
        if path == "courses/1/modules/7/items":
            return [{"id": 71, "type": "Page", "title": "Uzun modül sayfası", "html_url": "https://c/p/71"}]
        if path == "courses/1/files":
            return self.files
        raise AssertionError(path)

    try_get = get


class CanvasNotifierTest(unittest.TestCase):
    def setUp(self):
        state_mod.STATE_DIR = tempfile.mkdtemp()

    def test_flow(self):
        canvas, sent = FakeCanvas(), []

        # 1. ilk çalışma: sadece karşılama mesajı, eski olaylar sessizce kaydedilir
        cn.run(canvas, sent.append, state_mod.State("canvas"), NOW)
        self.assertEqual(len(sent), 1)
        self.assertIn("1 ders takipte", sent[0])

        # 2. değişiklik yok: bildirim yok
        sent.clear()
        self.assertEqual(cn.run(canvas, sent.append, state_mod.State("canvas"), NOW), 0)
        self.assertEqual(sent, [])

        # 3. yeni duyuru, not, mesaj, yeni ödev ve teslim tarihi değişikliği
        canvas.stream.insert(0, {"id": 12, "type": "Announcement", "course_id": 1,
                                 "title": "Ders iptal", "message": "Yarın ders yok", "html_url": "https://c/a/12"})
        canvas.stream[2].update(score=8.5, grade="8.5")
        canvas.stream.append({"id": 13, "type": "Conversation", "title": "Proje grubu",
                              "updated_at": "2026-11-13T10:00:00Z", "html_url": "https://c/conv/13"})
        canvas.assignments[0]["due_at"] = "2026-11-22T20:59:00Z"
        canvas.assignments.append({"id": 101, "name": "Ödev 2", "due_at": None, "published": True})
        canvas.assignments.append({"id": 102, "name": "Taslak", "due_at": None, "published": False})
        sent.clear()
        self.assertEqual(cn.run(canvas, sent.append, state_mod.State("canvas"), NOW), 5)
        joined = "\n".join(sent)
        self.assertIn("[MATH101] <b>Yeni duyuru:</b> Ders iptal", joined)
        self.assertIn("Quiz 1 → <b>8.5/10</b>", joined)
        self.assertIn("Yeni mesaj:</b> Proje grubu", joined)
        self.assertIn("Yeni ödev:</b> Ödev 2\nTeslim: teslim tarihi yok", joined)
        self.assertIn("20.11.2026 23:59 → <b>22.11.2026 23:59</b>", joined)
        self.assertNotIn("Taslak", joined)

        # 4. aynı veriler tekrar gelince bildirim tekrarlanmaz
        sent.clear()
        cn.run(canvas, sent.append, state_mod.State("canvas"), NOW)
        self.assertEqual(sent, [])

    def test_failed_send_is_retried(self):
        canvas = FakeCanvas()
        cn.run(canvas, lambda t: None, state_mod.State("canvas"), NOW)
        canvas.stream.insert(0, {"id": 12, "type": "Announcement", "course_id": 1, "title": "X", "message": ""})

        def boom(_):
            raise OSError("ağ hatası")

        with self.assertRaises(OSError):
            cn.run(canvas, boom, state_mod.State("canvas"), NOW)
        sent = []
        cn.run(canvas, sent.append, state_mod.State("canvas"), NOW)
        self.assertEqual(len(sent), 1)

    def run_at(self, canvas, now):
        sent = []
        cn.run(canvas, sent.append, state_mod.State("canvas"), now)
        return sent

    def test_deadline_reminders(self):
        canvas = FakeCanvas()
        canvas.assignments = [
            {"id": 1, "name": "Yakın", "due_at": "2026-11-14T08:00:00Z", "html_url": "https://c/as/1"},   # 23 saat
            {"id": 2, "name": "Uzak", "due_at": "2026-11-16T08:00:00Z"},                                  # 3 gün
            {"id": 3, "name": "Teslim edildi", "due_at": "2026-11-13T20:00:00Z",
             "submission": {"submitted_at": "2026-11-12T10:00:00Z"}},
            {"id": 4, "name": "Çok yakın", "due_at": "2026-11-13T11:30:00Z"},                             # 2 saat 30 dk
        ]
        self.run_at(canvas, NOW)  # ilk çalışma: sadece karşılama

        sent = self.run_at(canvas, NOW)
        self.assertEqual(len(sent), 2)
        joined = "\n".join(sent)
        self.assertIn("⏰ [MATH101] <b>Teslime 23 saat kaldı:</b> Yakın\nTeslim: 14.11.2026 11:00", joined)
        self.assertIn("🚨 [MATH101] <b>Teslime 2 saat 30 dk kaldı:</b> Çok yakın", joined)

        # aynı hatırlatma tekrarlanmaz; 3 saatin altına düşmüş ödev için 24 saat hatırlatması da gelmez
        self.assertEqual(self.run_at(canvas, NOW), [])

        # 3 saat kala ikinci hatırlatma gelir
        later = datetime(2026, 11, 14, 5, 15, tzinfo=timezone.utc)
        sent = self.run_at(canvas, later)
        self.assertEqual(len(sent), 1)
        self.assertIn("🚨 [MATH101] <b>Teslime 2 saat 45 dk kaldı:</b> Yakın", sent[0])

        # teslim edilince hatırlatma kesilir; tarih değişirse yeniden hatırlatılır
        canvas.assignments[0]["due_at"] = "2026-11-14T07:00:00Z"
        sent = self.run_at(canvas, later)
        self.assertEqual(len(sent), 2)  # teslim tarihi değişti + yeni tarihe göre hatırlatma
        canvas.assignments[0]["due_at"] = "2026-11-14T06:00:00Z"
        canvas.assignments[0]["submission"] = {"workflow_state": "submitted"}
        sent = self.run_at(canvas, later)
        self.assertEqual(len(sent), 1)
        self.assertIn("Teslim tarihi değişti", sent[0])

    def test_quiet_hours(self):
        at = lambda d, h, m=0: datetime(2026, 11, d, h, m, tzinfo=timezone.utc)   # Türkiye saati = UTC+3
        self.assertFalse(cn.is_quiet(at(13, 20, 59)))    # 23:59
        self.assertTrue(cn.is_quiet(at(13, 21, 0)))      # 00:00
        self.assertTrue(cn.is_quiet(at(14, 3, 59)))      # 06:59
        self.assertFalse(cn.is_quiet(at(14, 4, 0)))      # 07:00

        # Geceye denk gelen hatırlatma 23:30'a çekilir; gündüze denk gelen yerinde kalır.
        due = at(14, 2, 0)                                                        # Cumartesi 05:00
        self.assertEqual(cn.remind_at(due, 3), at(13, 20, 30))                    # 02:00 yerine Cuma 23:30
        self.assertEqual(cn.remind_at(due, 24), at(12, 20, 30))                   # Cuma 05:00 yerine Perşembe 23:30
        self.assertEqual(cn.remind_at(at(14, 12, 0), 3), at(14, 9, 0))            # 15:00 teslim -> 12:00

        canvas = FakeCanvas()
        canvas.assignments = [{"id": 7, "name": "Gece teslimi", "due_at": "2026-11-14T02:00:00Z"}]
        self.run_at(canvas, at(12, 9))                                            # ilk çalışma: karşılama
        self.assertEqual(self.run_at(canvas, at(12, 20, 20)), [])                 # Perşembe 23:20: henüz değil
        sent = self.run_at(canvas, at(12, 20, 30))                                # Perşembe 23:30: 24 saat hatırlatması
        self.assertEqual(len(sent), 1)
        self.assertIn("⏰ [MATH101] <b>Teslime 29 saat kaldı:</b> Gece teslimi", sent[0])
        self.assertEqual(self.run_at(canvas, at(13, 20, 20)), [])
        sent = self.run_at(canvas, at(13, 20, 40))                                # Cuma 23:40: 3 saat hatırlatması erken gelir
        self.assertEqual(len(sent), 1)
        self.assertIn("🚨 [MATH101] <b>Teslime 5 saat 20 dk kaldı:</b> Gece teslimi", sent[0])

    def test_scheduled_runs_are_skipped_in_quiet_hours(self):
        import unittest.mock as mock
        night = datetime(2026, 11, 14, 0, 3, tzinfo=timezone.utc)   # 03:03, GitHub'ın yedek zamanlayıcısı
        day = datetime(2026, 11, 14, 9, 0, tzinfo=timezone.utc)
        with mock.patch.object(cn, "datetime") as fake:
            fake.now.return_value = night
            with mock.patch.dict(os.environ, {"GITHUB_EVENT_NAME": "schedule"}):
                self.assertTrue(cn.skip_for_quiet_hours())
            with mock.patch.dict(os.environ, {"GITHUB_EVENT_NAME": "workflow_dispatch"}):
                self.assertFalse(cn.skip_for_quiet_hours())   # elle (ya da botun) başlattığı çalışma atlanmaz
            fake.now.return_value = day
            with mock.patch.dict(os.environ, {"GITHUB_EVENT_NAME": "schedule"}):
                self.assertFalse(cn.skip_for_quiet_hours())

    def test_new_materials(self):
        canvas = FakeCanvas()
        canvas.assignments = []
        canvas.modules = [{"id": 5, "name": "Hafta 1", "items": [
            {"id": 51, "type": "File", "content_id": 900, "title": "Eski slayt.pdf", "html_url": "https://c/m/51"},
            {"id": 52, "type": "Assignment", "title": "Ödev (ayrı bildirilir)"},
            {"id": 53, "type": "SubHeader", "title": "Başlık"},
        ]}]
        canvas.files = [{"id": 900, "display_name": "Eski slayt.pdf", "created_at": "2026-11-01T10:00:00Z"}]
        self.run_at(canvas, NOW)                       # ilk çalışma: mevcut materyaller sessizce kaydedilir
        self.assertEqual(self.run_at(canvas, NOW), [])

        # tek yeni dosya (hem modülde hem dosyalarda: tek bildirim)
        canvas.modules[0]["items"].append(
            {"id": 54, "type": "File", "content_id": 901, "title": "Hafta 2 <slayt>.pdf", "html_url": "https://c/m/54"})
        canvas.files.insert(0, {"id": 901, "display_name": "Hafta 2 <slayt>.pdf", "created_at": "2026-11-13T08:00:00Z"})
        sent = self.run_at(canvas, NOW)
        self.assertEqual(sent, ['📎 [MATH101] <b>Yeni materyal:</b> <a href="https://c/m/54">Hafta 2 &lt;slayt&gt;.pdf</a>'])
        self.assertEqual(self.run_at(canvas, NOW), [])

        # birden çok yeni materyal tek mesajda; gizli ve eski dosyalar bildirilmez
        canvas.modules.append({"id": 7, "name": "Öğeleri ayrı gelen modül"})
        canvas.files.insert(0, {"id": 902, "display_name": "notlar.docx", "created_at": "2026-11-13T08:30:00Z"})
        canvas.files.insert(0, {"id": 903, "display_name": "gizli.pdf", "created_at": "2026-11-13T08:30:00Z", "hidden": True})
        canvas.files.append({"id": 800, "display_name": "yeniden beliren eski.pdf", "created_at": "2026-09-01T08:30:00Z"})
        sent = self.run_at(canvas, NOW)
        self.assertEqual(len(sent), 1)
        self.assertIn("<b>2 yeni materyal:</b>", sent[0])
        self.assertIn('<a href="https://c/p/71">Uzun modül sayfası</a>', sent[0])
        self.assertIn('<a href="https://c/courses/1/files/902">notlar.docx</a>', sent[0])
        self.assertNotIn("gizli", sent[0])
        self.assertNotIn("eski", sent[0])
        self.assertEqual(self.run_at(canvas, NOW), [])

    def test_existing_state_without_materials_is_seeded_silently(self):
        canvas = FakeCanvas()
        canvas.assignments = []
        self.run_at(canvas, NOW)
        st = state_mod.State("canvas")
        del st.data["materials"]          # bu özellikten önce kaydedilmiş hafıza dosyası
        st.save()
        canvas.files = [{"id": 900, "display_name": "Mevcut.pdf", "created_at": "2026-11-13T08:00:00Z"}]
        self.assertEqual(self.run_at(canvas, NOW), [])
        self.assertEqual(self.run_at(canvas, NOW), [])

    def test_html_is_escaped(self):
        st = state_mod.State("canvas")
        msgs = cn.activity_messages(FakeCanvas().stream, {1: "MATH101"}, st)
        self.assertIn("Vize &lt;tarihi&gt;", msgs[0][1])
        self.assertIn("Vize cuma günü.", msgs[0][1])


if __name__ == "__main__":
    unittest.main()

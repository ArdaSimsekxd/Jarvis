"""Sahte Canvas verisiyle uçtan uca test. Çalıştırma: python -m unittest discover tests"""
import os
import tempfile
import unittest

os.environ["JARVIS_STATE_DIR"] = tempfile.mkdtemp()

from jarvis import state as state_mod
from jarvis.agents import canvas_notifier as cn


class FakeCanvas:
    def __init__(self):
        self.courses = [{"id": 1, "course_code": "MATH101", "name": "Calculus"}]
        self.stream = [
            {"id": 10, "type": "Announcement", "course_id": 1, "title": "Vize <tarihi>",
             "message": "<p>Vize&nbsp;cuma günü.</p>", "html_url": "https://c/a/10"},
            {"id": 11, "type": "Submission", "course_id": 1, "title": "Quiz 1",
             "score": None, "grade": None, "assignment": {"name": "Quiz 1", "points_possible": 10}},
        ]
        self.assignments = [{"id": 100, "name": "Ödev 1", "due_at": "2026-11-20T20:59:00Z",
                             "html_url": "https://c/as/100", "published": True}]

    def get(self, path, params=None):
        if path == "courses":
            return self.courses
        if path == "users/self/activity_stream":
            return self.stream
        if path == "courses/1/assignments":
            return self.assignments
        raise AssertionError(path)


class CanvasNotifierTest(unittest.TestCase):
    def setUp(self):
        state_mod.STATE_DIR = tempfile.mkdtemp()

    def test_flow(self):
        canvas, sent = FakeCanvas(), []

        # 1. ilk çalışma: sadece karşılama mesajı, eski olaylar sessizce kaydedilir
        cn.run(canvas, sent.append, state_mod.State("canvas"))
        self.assertEqual(len(sent), 1)
        self.assertIn("1 ders takipte", sent[0])

        # 2. değişiklik yok: bildirim yok
        sent.clear()
        self.assertEqual(cn.run(canvas, sent.append, state_mod.State("canvas")), 0)
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
        self.assertEqual(cn.run(canvas, sent.append, state_mod.State("canvas")), 5)
        joined = "\n".join(sent)
        self.assertIn("[MATH101] <b>Yeni duyuru:</b> Ders iptal", joined)
        self.assertIn("Quiz 1 → <b>8.5/10</b>", joined)
        self.assertIn("Yeni mesaj:</b> Proje grubu", joined)
        self.assertIn("Yeni ödev:</b> Ödev 2\nTeslim: teslim tarihi yok", joined)
        self.assertIn("20.11.2026 23:59 → <b>22.11.2026 23:59</b>", joined)
        self.assertNotIn("Taslak", joined)

        # 4. aynı veriler tekrar gelince bildirim tekrarlanmaz
        sent.clear()
        cn.run(canvas, sent.append, state_mod.State("canvas"))
        self.assertEqual(sent, [])

    def test_failed_send_is_retried(self):
        canvas = FakeCanvas()
        cn.run(canvas, lambda t: None, state_mod.State("canvas"))
        canvas.stream.insert(0, {"id": 12, "type": "Announcement", "course_id": 1, "title": "X", "message": ""})

        def boom(_):
            raise OSError("ağ hatası")

        with self.assertRaises(OSError):
            cn.run(canvas, boom, state_mod.State("canvas"))
        sent = []
        cn.run(canvas, sent.append, state_mod.State("canvas"))
        self.assertEqual(len(sent), 1)

    def test_html_is_escaped(self):
        st = state_mod.State("canvas")
        msgs = cn.activity_messages(FakeCanvas().stream, {1: "MATH101"}, st)
        self.assertIn("Vize &lt;tarihi&gt;", msgs[0][1])
        self.assertIn("Vize cuma günü.", msgs[0][1])


if __name__ == "__main__":
    unittest.main()

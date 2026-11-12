"""Canvas bildirim ajanı.

Canvas'tan yeni duyuru, mesaj, tartışma, not ve ödevleri bulur, Telegram'a gönderir.
Çalıştırma: python -m jarvis.agents.canvas_notifier
"""
import html
import json
import os
import re
import urllib.request
from datetime import datetime, timedelta, timezone

from jarvis.channels import telegram
from jarvis.state import State

try:
    from zoneinfo import ZoneInfo
    LOCAL_TZ = ZoneInfo(os.environ.get("JARVIS_TZ", "Europe/Istanbul"))
except Exception:  # tz verisi yoksa Türkiye saati
    LOCAL_TZ = timezone(timedelta(hours=3))

# Ödev ve not bilgisini zaten ayrı takip ediyoruz; bu Canvas bildirimleri tekrar olur.
SKIP_MESSAGE_CATEGORIES = {"Due Date", "Course Content", "Grading", "Late Grading", "Submission Comment"}


class Canvas:
    def __init__(self, base_url, token):
        self.base = base_url.rstrip("/")
        self.token = token

    def get(self, path, params=None):
        """GET isteği; sayfalı sonuçları (Link: next) birleştirir."""
        url = f"{self.base}/api/v1/{path}"
        if params:
            url += "?" + "&".join(f"{k}={v}" for k, v in params.items())
        results = []
        while url:
            req = urllib.request.Request(url, headers={"Authorization": f"Bearer {self.token}"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode())
                link = resp.headers.get("Link", "")
            if not isinstance(data, list):
                return data
            results.extend(data)
            m = re.search(r'<([^>]+)>;\s*rel="next"', link)
            url = m.group(1) if m else None
        return results


def strip_html(text, limit=200):
    text = re.sub(r"<[^>]+>", " ", text or "")
    text = re.sub(r"\s+", " ", html.unescape(text)).strip()
    return text if len(text) <= limit else text[:limit].rstrip() + "…"


def fmt_date(iso):
    if not iso:
        return "teslim tarihi yok"
    dt = datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(LOCAL_TZ)
    return dt.strftime("%d.%m.%Y %H:%M")


def esc(text):
    return html.escape(str(text or ""), quote=False)


def link(url):
    return f'\n<a href="{esc(url)}">Canvas\'ta aç</a>' if url else ""


def activity_messages(items, courses, state):
    """Aktivite akışındaki yeni olayları (anahtar, mesaj) olarak döndürür."""
    out = []
    for it in items:
        kind = it.get("type")
        course = courses.get(it.get("course_id"), "")
        tag = f"[{esc(course)}] " if course else ""
        title = esc(it.get("title"))
        url = it.get("html_url")

        if kind == "Announcement":
            key = f"ann:{it['id']}"
            text = f"📢 {tag}<b>Yeni duyuru:</b> {title}\n{esc(strip_html(it.get('message')))}{link(url)}"
        elif kind == "DiscussionTopic":
            key = f"disc:{it['id']}"
            text = f"💬 {tag}<b>Yeni tartışma:</b> {title}{link(url)}"
        elif kind == "Conversation":
            key = f"conv:{it['id']}:{it.get('updated_at')}"
            text = f"✉️ {tag}<b>Yeni mesaj:</b> {title or '(konusuz)'}{link(url)}"
        elif kind == "Submission":
            score, grade = it.get("score"), it.get("grade")
            if score is None and not grade:
                continue
            a = it.get("assignment") or {}
            key = f"sub:{it['id']}:{grade}:{score}"
            pts = a.get("points_possible")
            shown = f"{score:g}/{pts:g}" if score is not None and pts else (grade or score)
            if grade and score is not None and str(grade) != f"{score:g}":
                shown = f"{grade} ({shown})"
            text = f"📊 {tag}<b>Not girildi:</b> {esc(a.get('name') or it.get('title'))} → <b>{esc(shown)}</b>{link(url)}"
        elif kind == "Message":
            if it.get("notification_category") in SKIP_MESSAGE_CATEGORIES:
                continue
            key = f"msg:{it['id']}"
            text = f"🔔 {tag}{title}\n{esc(strip_html(it.get('message')))}{link(url)}"
        else:
            continue

        if not state.seen(key):
            out.append((key, text))
    return out


def assignment_messages(course_assignments, courses, state):
    """Yeni ödevleri ve teslim tarihi değişikliklerini (ödev id, teslim, mesaj) olarak döndürür."""
    known = state.data["assignments"]
    out = []
    for course_id, assignments in course_assignments.items():
        tag = f"[{esc(courses.get(course_id, ''))}] "
        for a in assignments:
            if a.get("published") is False:
                continue
            aid, due = str(a["id"]), a.get("due_at")
            name, url = esc(a.get("name")), a.get("html_url")
            if aid not in known:
                out.append((aid, due, f"📝 {tag}<b>Yeni ödev:</b> {name}\nTeslim: {fmt_date(due)}{link(url)}"))
            elif known[aid] != due:
                out.append((aid, due, f"⏰ {tag}<b>Teslim tarihi değişti:</b> {name}\n{fmt_date(known[aid])} → <b>{fmt_date(due)}</b>{link(url)}"))
    return out


def run(canvas, send, state):
    courses = {
        c["id"]: c.get("course_code") or c.get("name")
        for c in canvas.get("courses", {"enrollment_state": "active", "per_page": 100})
        if isinstance(c, dict) and "id" in c and not c.get("access_restricted_by_date")
    }
    items = canvas.get("users/self/activity_stream", {"per_page": 50})
    course_assignments = {
        cid: canvas.get(f"courses/{cid}/assignments", {"per_page": 100})
        for cid in courses
    }

    first_run = state.is_new
    new_activity = activity_messages(items, courses, state)
    new_assignments = assignment_messages(course_assignments, courses, state)

    if first_run:
        # İlk çalışmada eski olayları sessizce kaydet, telefonu 200 bildirimle doldurma.
        send(f"🤖 Jarvis Canvas ajanı çalışıyor. {len(courses)} ders takipte; "
             f"bundan sonraki yeni duyuru, ödev, not ve mesajları buraya yazacağım.")
        for key, _ in new_activity:
            state.mark(key)
        for aid, due, _ in new_assignments:
            state.data["assignments"][aid] = due
        state.save()
        return 0

    sent = 0
    try:  # bir gönderim hata verse bile gönderilenler hafızaya yazılır
        for aid, due, text in new_assignments:
            send(text)
            state.data["assignments"][aid] = due
            sent += 1
        for key, text in reversed(new_activity):  # eskiden yeniye
            send(text)
            state.mark(key)
            sent += 1
    finally:
        state.save()
    return sent


def main():
    canvas = Canvas(os.environ["CANVAS_BASE_URL"], os.environ["CANVAS_TOKEN"])
    sent = run(canvas, telegram.send, State("canvas"))
    print(f"{sent} bildirim gönderildi")


if __name__ == "__main__":
    main()

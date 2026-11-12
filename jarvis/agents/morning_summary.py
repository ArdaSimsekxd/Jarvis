"""Sabah özeti ajanı.

Her sabah tek mesaj: bugün ve önümüzdeki 7 günde teslim edilecekler, son 24 saatin duyuruları.
Çalıştırma: python -m jarvis.agents.morning_summary
"""
import os
from datetime import datetime, timedelta, timezone

from jarvis.agents.canvas_notifier import LOCAL_TZ, Canvas, esc
from jarvis.channels import telegram

DAYS = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"]
WEEK_DAYS = 7


def parse(iso):
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


def is_submitted(assignment):
    sub = assignment.get("submission") or {}
    return bool(sub.get("submitted_at")) or sub.get("workflow_state") in ("submitted", "graded") or bool(sub.get("excused"))


def build(courses, course_assignments, stream, now):
    """Özet mesajını üretir. now: saat dilimi bilgili datetime."""
    today = now.astimezone(LOCAL_TZ).date()
    due_today, due_week = [], []
    for cid, assignments in course_assignments.items():
        for a in assignments:
            if not a.get("due_at") or a.get("published") is False or is_submitted(a):
                continue
            due = parse(a["due_at"])
            if due < now:
                continue
            local = due.astimezone(LOCAL_TZ)
            days_left = (local.date() - today).days
            item = (due, local, courses.get(cid, ""), a.get("name"), a.get("html_url"))
            if days_left == 0:
                due_today.append(item)
            elif days_left <= WEEK_DAYS:
                due_week.append(item)

    def line(item, with_day):
        _, local, course, name, url = item
        when = f"{DAYS[local.weekday()]} {local:%d.%m} {local:%H:%M}" if with_day else f"{local:%H:%M}"
        title = f'<a href="{esc(url)}">{esc(name)}</a>' if url else esc(name)
        return f"• <b>{when}</b> {esc(course)}: {title}"

    since = now - timedelta(hours=24)
    announcements = [
        it for it in stream
        if it.get("type") == "Announcement" and it.get("created_at") and parse(it["created_at"]) >= since
    ]

    local_now = now.astimezone(LOCAL_TZ)
    parts = [f"☀️ <b>Günaydın!</b> {DAYS[local_now.weekday()]}, {local_now:%d.%m.%Y}"]

    if due_today:
        parts.append("🔴 <b>Bugün teslim</b>\n" + "\n".join(line(i, False) for i in sorted(due_today, key=lambda i: i[0])))
    else:
        parts.append("✅ Bugün teslim edilecek ödev yok.")

    if due_week:
        parts.append(f"📅 <b>Önümüzdeki {WEEK_DAYS} gün</b>\n" + "\n".join(line(i, True) for i in sorted(due_week, key=lambda i: i[0])))
    else:
        parts.append(f"Önümüzdeki {WEEK_DAYS} günde başka teslim görünmüyor.")

    if announcements:
        parts.append("📢 <b>Son 24 saatin duyuruları</b>\n" + "\n".join(
            f"• {esc(courses.get(it.get('course_id'), ''))}: "
            + (f'<a href="{esc(it["html_url"])}">{esc(it.get("title"))}</a>' if it.get("html_url") else esc(it.get("title")))
            for it in announcements
        ))
    return "\n\n".join(parts)


def run(canvas, send, now=None):
    now = now or datetime.now(timezone.utc)
    courses = {
        c["id"]: c.get("course_code") or c.get("name")
        for c in canvas.get("courses", {"enrollment_state": "active", "per_page": 100})
        if isinstance(c, dict) and "id" in c and not c.get("access_restricted_by_date")
    }
    course_assignments = {
        cid: canvas.get(f"courses/{cid}/assignments", {"per_page": 100, "include[]": "submission"})
        for cid in courses
    }
    stream = canvas.get("users/self/activity_stream", {"per_page": 50})
    send(build(courses, course_assignments, stream, now))


def main():
    canvas = Canvas(os.environ["CANVAS_BASE_URL"], os.environ["CANVAS_TOKEN"])
    run(canvas, telegram.send)
    print("Sabah özeti gönderildi")


if __name__ == "__main__":
    main()

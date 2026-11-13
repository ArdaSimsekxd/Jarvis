"""Akşam önizlemesi ajanı.

Her akşam tek mesaj: bu gece ve yarın teslim edilecekler, yarının dersleri ve yemek menüsü.
Yarın için söylenecek bir şey yoksa (ör. boş bir pazar) hiçbir şey göndermez.
Çalıştırma: python -m jarvis.agents.evening_preview
"""
import os
from datetime import datetime, timedelta, timezone

from jarvis import menu as menu_mod
from jarvis import schedule as schedule_mod
from jarvis.agents.canvas_notifier import LOCAL_TZ, Canvas, esc, is_submitted
from jarvis.agents.canvas_notifier import parse_time as parse
from jarvis.agents.morning_summary import DAYS
from jarvis.channels import telegram


def build(courses, course_assignments, now, menu=None, schedule=None):
    """Önizleme mesajını üretir; gösterilecek bir şey yoksa None. now: saat dilimi bilgili datetime."""
    today = now.astimezone(LOCAL_TZ).date()
    tomorrow = today + timedelta(days=1)
    tonight, due_tomorrow = [], []
    for cid, assignments in course_assignments.items():
        for a in assignments:
            if not a.get("due_at") or a.get("published") is False or is_submitted(a):
                continue
            due = parse(a["due_at"])
            if due < now:
                continue
            local = due.astimezone(LOCAL_TZ)
            item = (due, local, courses.get(cid, ""), a.get("name"), a.get("html_url"))
            if local.date() == today:
                tonight.append(item)
            elif local.date() == tomorrow:
                due_tomorrow.append(item)

    def lines(items):
        out = []
        for _, local, course, name, url in sorted(items, key=lambda i: i[0]):
            title = f'<a href="{esc(url)}">{esc(name)}</a>' if url else esc(name)
            out.append(f"• <b>{local:%H:%M}</b> {esc(course)}: {title}")
        return "\n".join(out)

    parts = []
    if tonight:
        parts.append("🚨 <b>Bu gece teslim</b>\n" + lines(tonight))
    lessons = schedule_mod.lines_for(schedule, tomorrow)
    if lessons:
        parts.append("📚 <b>Yarının dersleri</b>\n" + "\n".join(lessons))
    if due_tomorrow:
        parts.append("🔴 <b>Yarın teslim</b>\n" + lines(due_tomorrow))
    menu_lines = menu_mod.lines_for(menu, tomorrow) if menu else []
    if menu_lines:
        parts.append("🍽 <b>Yarının menüsü</b>\n" + "\n".join(menu_lines))
    if not parts:
        return None
    return "\n\n".join([f"🌙 <b>Yarın:</b> {DAYS[tomorrow.weekday()]}, {tomorrow:%d.%m.%Y}"] + parts)


def run(canvas, send, now=None):
    now = now or datetime.now(timezone.utc)
    raw_courses = canvas.get("courses", {"enrollment_state": "active", "per_page": 100})
    courses = {
        c["id"]: c.get("course_code") or c.get("name")
        for c in raw_courses
        if isinstance(c, dict) and "id" in c and not c.get("access_restricted_by_date")
    }
    schedule = schedule_mod.with_names(schedule_mod.load(), raw_courses)
    course_assignments = {
        cid: canvas.get(f"courses/{cid}/assignments", {"per_page": 100, "include[]": "submission"})
        for cid in courses
    }
    text = build(courses, course_assignments, now, menu_mod.load(), schedule)
    if text:
        send(text)
    return bool(text)


def main():
    canvas = Canvas(os.environ["CANVAS_BASE_URL"], os.environ["CANVAS_TOKEN"])
    sent = run(canvas, telegram.send)
    print("Akşam önizlemesi gönderildi" if sent else "Yarın için gösterilecek bir şey yok, mesaj gönderilmedi")


if __name__ == "__main__":
    main()

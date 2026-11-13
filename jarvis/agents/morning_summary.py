"""Sabah özeti ajanı.

Her sabah tek mesaj: günün dersleri, gecikmiş ödevler, bugün ve önümüzdeki 7 günde
teslim edilecekler, son 24 saatin duyuruları ve günün yemek menüsü.
Çalıştırma: python -m jarvis.agents.morning_summary
"""
import os
from datetime import datetime, timedelta, timezone

from jarvis.agents.canvas_notifier import LOCAL_TZ, Canvas, esc, is_submitted
from jarvis.agents.canvas_notifier import parse_time as parse
from jarvis import menu as menu_mod
from jarvis import schedule as schedule_mod
from jarvis.channels import telegram

DAYS = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"]
WEEK_DAYS = 7
OVERDUE_DAYS = 14  # daha eski gecikmeler özeti kalabalıklaştırmasın


def is_missing(assignment):
    """Teslim tarihi geçmiş ödev gerçekten eksik mi? Canvas'ın kendi 'missing' işaretine güvenir."""
    missing = (assignment.get("submission") or {}).get("missing")
    if missing is None:  # işaret yoksa: sadece internetten teslim edilen ödevleri say
        types = assignment.get("submission_types") or []
        missing = any(t.startswith("online") or t == "external_tool" for t in types)
    return bool(missing)


def build(courses, course_assignments, stream, now, menu=None, schedule=None):
    """Özet mesajını üretir. now: saat dilimi bilgili datetime."""
    today = now.astimezone(LOCAL_TZ).date()
    due_today, due_week, overdue = [], [], []
    for cid, assignments in course_assignments.items():
        for a in assignments:
            if not a.get("due_at") or a.get("published") is False or is_submitted(a):
                continue
            due = parse(a["due_at"])
            local = due.astimezone(LOCAL_TZ)
            item = (due, local, courses.get(cid, ""), a.get("name"), a.get("html_url"))
            if due < now:
                if now - due <= timedelta(days=OVERDUE_DAYS) and is_missing(a):
                    overdue.append(item)
                continue
            days_left = (local.date() - today).days
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

    lessons = schedule_mod.lines_for(schedule, today)
    if lessons:
        parts.append("📚 <b>Bugünün dersleri</b>\n" + "\n".join(lessons))

    if overdue:
        parts.append("⚠️ <b>Gecikenler</b> (teslim edilmemiş)\n"
                     + "\n".join(line(i, True) for i in sorted(overdue, key=lambda i: i[0])))

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
    menu_lines = menu_mod.lines_for(menu, today) if menu else []
    if menu_lines:
        parts.append("🍽 <b>Bugünün menüsü</b>\n" + "\n".join(menu_lines))
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
    send(build(courses, course_assignments, stream, now, menu_mod.load(), schedule_mod.load()))


def main():
    canvas = Canvas(os.environ["CANVAS_BASE_URL"], os.environ["CANVAS_TOKEN"])
    run(canvas, telegram.send)
    print("Sabah özeti gönderildi")


if __name__ == "__main__":
    main()

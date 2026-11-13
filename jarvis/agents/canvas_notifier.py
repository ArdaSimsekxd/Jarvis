"""Canvas bildirim ajanı.

Canvas'tan yeni duyuru, mesaj, tartışma, not, ödev ve ders materyallerini bulur, Telegram'a gönderir.
Yeni yüklenen dosyaların kendisi de gönderilir.
Çalıştırma: python -m jarvis.agents.canvas_notifier
"""
import html
import json
import os
import re
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

from jarvis.channels import telegram
from jarvis.richtext import to_telegram
from jarvis.state import State

try:
    from zoneinfo import ZoneInfo
    LOCAL_TZ = ZoneInfo(os.environ.get("JARVIS_TZ", "Europe/Istanbul"))
except Exception:  # tz verisi yoksa Türkiye saati
    LOCAL_TZ = timezone(timedelta(hours=3))

# Ödev ve not bilgisini zaten ayrı takip ediyoruz; bu Canvas bildirimleri tekrar olur.
SKIP_MESSAGE_CATEGORIES = {"Due Date", "Course Content", "Grading", "Late Grading", "Submission Comment"}

# Teslime şu kadar saat kala hatırlat (küçükten büyüğe).
REMINDER_HOURS = [(3, "🚨"), (24, "⏰")]

# Bildirilecek modül öğeleri. Ödev, quiz ve tartışmalar zaten ayrı bildiriliyor.
MATERIAL_ITEM_TYPES = {"File", "Page", "ExternalUrl", "ExternalTool"}
MATERIAL_FILE_MAX_AGE = timedelta(days=2)
MATERIAL_LIST_LIMIT = 15

# Yeni dosyaların kendisi de gönderilir. Bir kontrolde en fazla şu kadar dosya ve süre;
# artanlar bir sonraki kontrolde (10 dakika sonra) gelir.
MAX_FILES_PER_RUN = 10
FILE_TIME_BUDGET = 150   # saniye
MAX_FILE_BYTES = telegram.MAX_FILE_BYTES


class _KeepTokenHome(urllib.request.HTTPRedirectHandler):
    """Canvas dosyayı başka bir sunucuya yönlendirirse erişim anahtarı oraya gönderilmez."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        new = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new is not None and urlsplit(newurl)[:2] != urlsplit(req.full_url)[:2]:
            new.headers.pop("Authorization", None)
        return new


class Canvas:
    def __init__(self, base_url, token):
        self.base = base_url.rstrip("/")
        self.token = token

    def get(self, path, params=None, max_pages=None):
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
            if max_pages is not None:
                max_pages -= 1
                if max_pages <= 0:
                    break
            m = re.search(r'<([^>]+)>;\s*rel="next"', link)
            url = m.group(1) if m else None
        return results

    def try_get(self, path, params=None, max_pages=None):
        """get gibi, ama o bölüm öğrenciye kapalıysa (401/403/404) boş liste döner."""
        try:
            return self.get(path, params, max_pages)
        except urllib.error.HTTPError as e:
            if e.code in (401, 403, 404):
                return []
            raise

    def download(self, url, limit):
        """Dosyayı indirir. limit bayttan büyükse ya da adres web adresi değilse None döner."""
        target = urlsplit(url)
        if target.scheme not in ("http", "https"):
            return None
        headers = {}
        if target[:2] == urlsplit(self.base)[:2]:   # erişim anahtarı yalnızca Canvas'ın kendisine gider
            headers["Authorization"] = f"Bearer {self.token}"
        opener = urllib.request.build_opener(_KeepTokenHome)
        with opener.open(urllib.request.Request(url, headers=headers), timeout=60) as resp:
            data = resp.read(limit + 1)
        return data if len(data) <= limit else None


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


def parse_time(iso):
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


def is_submitted(assignment):
    sub = assignment.get("submission") or {}
    return (bool(sub.get("submitted_at")) or sub.get("workflow_state") in ("submitted", "graded")
            or bool(sub.get("excused")))


def fmt_left(delta):
    minutes = max(int(delta.total_seconds() // 60), 0)
    hours, mins = divmod(minutes, 60)
    if hours >= 6 or mins == 0 and hours:
        return f"{hours} saat"
    if hours:
        return f"{hours} saat {mins} dk"
    return f"{mins} dk"


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
            # Duyurunun tamamı gönderilir (paragraflar, kalın yazı ve bağlantılar korunur).
            body = to_telegram(it.get("message"), url or "")
            text = f"📢 {tag}<b>Yeni duyuru:</b> {title}" + (f"\n\n{body}\n" if body else "") + link(url)
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


# Sessiz saatler (Türkiye saati): bu aralıkta bildirim gönderilmez, birikenler sabah ilk kontrolde gelir.
# Aynı değerler botta da var: worker/src/logic.js (QUIET_FROM, QUIET_UNTIL).
QUIET_FROM, QUIET_UNTIL = 0, 7
QUIET_LEAD = timedelta(minutes=30)   # geceye denk gelen hatırlatma, sessiz saatlerden bu kadar önce gönderilir


def is_quiet(now=None):
    hour = (now or datetime.now(timezone.utc)).astimezone(LOCAL_TZ).hour
    return QUIET_FROM <= hour < QUIET_UNTIL


def skip_for_quiet_hours():
    """GitHub'ın yedek zamanlayıcısı gece çalışırsa kontrol atlanır. Bot gece zaten başlatmaz; elle çalıştırma her zaman çalışır."""
    return os.environ.get("GITHUB_EVENT_NAME") == "schedule" and is_quiet()


def remind_at(due, hours):
    """Teslimden `hours` saat önceki hatırlatmanın gönderileceği an.

    Sessiz saatlere denk geliyorsa öne çekilir: gece 05:00'te teslim edilecek ödevin
    "3 saat kaldı" hatırlatması 02:00'de değil, yatmadan önce 23:30'da gelir.
    """
    at = due - timedelta(hours=hours)
    local = at.astimezone(LOCAL_TZ)
    if QUIET_FROM <= local.hour < QUIET_UNTIL:
        at = local.replace(hour=QUIET_FROM, minute=0, second=0, microsecond=0) - QUIET_LEAD
    return at


def reminder_messages(course_assignments, courses, state, now):
    """Teslimi yaklaşan, henüz teslim edilmemiş ödevler için (anahtarlar, mesaj) döndürür."""
    out = []
    for course_id, assignments in course_assignments.items():
        tag = f"[{esc(courses.get(course_id, ''))}] "
        for a in assignments:
            due_iso = a.get("due_at")
            if not due_iso or a.get("published") is False or is_submitted(a):
                continue
            due = parse_time(due_iso)
            left = due - now
            if left <= timedelta(0):
                continue
            hit = next(((h, icon) for h, icon in REMINDER_HOURS if now >= remind_at(due, h)), None)
            if not hit:
                continue
            hours, icon = hit
            key = f"rem:{a['id']}:{hours}:{due_iso}"
            if state.seen(key):
                continue
            # Daha uzun süreli hatırlatmalar da artık gereksiz, onları da işaretle.
            keys = [f"rem:{a['id']}:{h}:{due_iso}" for h, _ in REMINDER_HOURS if h >= hours]
            text = (f"{icon} {tag}<b>Teslime {fmt_left(left)} kaldı:</b> {esc(a.get('name'))}\n"
                    f"Teslim: {fmt_date(due_iso)}{link(a.get('html_url'))}")
            out.append((keys, text))
    return out


def course_materials(canvas, course_id, now):
    """Bir dersin modül öğelerini ve son yüklenen dosyalarını {anahtar: (başlık, link)} olarak döndürür."""
    found = {}
    modules = canvas.try_get(f"courses/{course_id}/modules", {"per_page": 50, "include[]": "items"})
    for m in modules:
        items = m.get("items")
        if items is None:  # çok öğeli modüllerde Canvas öğeleri ayrı ister
            items = canvas.try_get(f"courses/{course_id}/modules/{m['id']}/items", {"per_page": 100})
        for it in items:
            if it.get("type") not in MATERIAL_ITEM_TYPES or it.get("published") is False:
                continue
            key = f"file:{it['content_id']}" if it["type"] == "File" and it.get("content_id") else f"item:{it['id']}"
            found[key] = (it.get("title"), it.get("html_url"))

    files = canvas.try_get(f"courses/{course_id}/files",
                           {"per_page": 100, "sort": "created_at", "order": "desc"}, max_pages=1)
    base = getattr(canvas, "base", "")
    for f in files:
        if f.get("hidden") or f.get("locked_for_user"):
            continue
        key = f"file:{f['id']}"
        # Eski bir dosya listede yeniden belirirse (ör. başka dosya silinince) bildirme.
        fresh = f.get("created_at") and now - parse_time(f["created_at"]) <= MATERIAL_FILE_MAX_AGE
        if key not in found and fresh:
            found[key] = (f.get("display_name") or f.get("filename"), f"{base}/courses/{course_id}/files/{f['id']}")
        elif key not in found:
            found[key] = None  # bilinen ama bildirilmeyecek dosya
    return found


def material_updates(canvas, courses, state, now):
    """Her ders için (ders id, ders adı, yeni anahtarlar, gösterilecekler) döndürür.

    Gösterilecekler [(anahtar, başlık, link)] listesidir. İlk görülen ders sessizce kaydedilir.
    """
    known_all = state.data["materials"]
    out = []
    for course_id, course in courses.items():
        found = course_materials(canvas, course_id, now)
        cid = str(course_id)
        if cid not in known_all:
            out.append((cid, course, list(found), []))
            continue
        known = set(known_all[cid])
        new = [(k, v) for k, v in found.items() if k not in known]
        if new:
            out.append((cid, course, [k for k, _ in new], [(k, *v) for k, v in new if v]))
    return out


def material_text(course, shown):
    """Dosyası gönderilmeyen materyaller için tek mesaj; shown: [(başlık, link)]."""
    if not shown:
        return None

    def item(title, url):
        return f'<a href="{esc(url)}">{esc(title)}</a>' if url else esc(title)
    tag = f"[{esc(course)}] "
    if len(shown) == 1:
        return f"📎 {tag}<b>Yeni materyal:</b> {item(*shown[0])}"
    lines = [f"• {item(*v)}" for v in shown[:MATERIAL_LIST_LIMIT]]
    if len(shown) > MATERIAL_LIST_LIMIT:
        lines.append(f"… ve {len(shown) - MATERIAL_LIST_LIMIT} tane daha")
    return f"📎 {tag}<b>{len(shown)} yeni materyal:</b>\n" + "\n".join(lines)


def send_material_file(canvas, course_id, file_id, caption, send_file):
    """Dosyayı Canvas'tan indirip Telegram'a yükler. Olmazsa False döner; o zaman bağlantısı gönderilir."""
    try:
        info = canvas.get(f"courses/{course_id}/files/{file_id}")
        if not isinstance(info, dict) or info.get("locked_for_user") or not info.get("url"):
            return False
        if (info.get("size") or 0) > MAX_FILE_BYTES:
            return False
        data = canvas.download(info["url"], MAX_FILE_BYTES)
        if not data:
            return False
        send_file(info.get("display_name") or info.get("filename") or "dosya", data, caption)
        return True
    except Exception as e:  # dosya adı ve adresi herkese açık kayda yazılmaz
        print(f"Bir dosya gönderilemedi ({type(e).__name__}); bağlantısı gönderilecek")
        return False


def run(canvas, send, state, now=None, send_file=None):
    """send_file(dosya adı, içerik, açıklama) verilirse yeni dosyaların kendisi de gönderilir."""
    now = now or datetime.now(timezone.utc)
    courses = {
        c["id"]: c.get("course_code") or c.get("name")
        for c in canvas.get("courses", {"enrollment_state": "active", "per_page": 100})
        if isinstance(c, dict) and "id" in c and not c.get("access_restricted_by_date")
    }
    items = canvas.get("users/self/activity_stream", {"per_page": 50})
    course_assignments = {
        cid: canvas.get(f"courses/{cid}/assignments", {"per_page": 100, "include[]": "submission"})
        for cid in courses
    }

    first_run = state.is_new
    new_activity = activity_messages(items, courses, state)
    new_assignments = assignment_messages(course_assignments, courses, state)
    reminders = reminder_messages(course_assignments, courses, state, now)
    materials = material_updates(canvas, courses, state, now)

    def remember_materials(cid, keys):
        state.data["materials"].setdefault(cid, []).extend(keys)

    if first_run:
        # İlk çalışmada eski olayları sessizce kaydet, telefonu 200 bildirimle doldurma.
        send(f"🤖 Jarvis Canvas ajanı çalışıyor. {len(courses)} ders takipte; "
             f"bundan sonraki yeni duyuru, ödev, not, materyal ve mesajları buraya yazacağım.")
        for key, _ in new_activity:
            state.mark(key)
        for aid, due, _ in new_assignments:
            state.data["assignments"][aid] = due
        for cid, _, keys, _ in materials:
            remember_materials(cid, keys)
        state.save()
        return 0

    sent = 0
    files_left, files_until = MAX_FILES_PER_RUN, time.monotonic() + FILE_TIME_BUDGET
    try:  # bir gönderim hata verse bile gönderilenler hafızaya yazılır
        for aid, due, text in new_assignments:
            send(text)
            state.data["assignments"][aid] = due
            sent += 1
        for key, text in reversed(new_activity):  # eskiden yeniye
            send(text)
            state.mark(key)
            sent += 1
        for cid, course, keys, shown in materials:
            links, handled = [], set()   # handled: dosyası gönderilenler ve sonraki kontrole kalanlar
            for key, title, url in shown:
                if send_file and key.startswith("file:"):
                    if files_left <= 0 or time.monotonic() > files_until:
                        handled.add(key)   # hafızaya yazılmaz: sıradaki kontrolde gönderilir
                        continue
                    files_left -= 1
                    name = str(title or "")
                    name = name if len(name) <= 200 else name[:200] + "…"
                    caption = f"📎 [{esc(course)}] <b>Yeni dosya:</b> {esc(name)}{link(url)}"
                    if send_material_file(canvas, cid, key[5:], caption, send_file):
                        remember_materials(cid, [key])
                        handled.add(key)
                        sent += 1
                        continue
                links.append((title, url))
            text = material_text(course, links)
            if text:
                send(text)
                sent += 1
            remember_materials(cid, [k for k in keys if k not in handled])
        for keys, text in reminders:
            send(text)
            for key in keys:
                state.mark(key)
            sent += 1
    finally:
        state.save()
    return sent


def main():
    if skip_for_quiet_hours():
        print("Sessiz saatler: Canvas kontrolü sabaha bırakıldı")
        return
    canvas = Canvas(os.environ["CANVAS_BASE_URL"], os.environ["CANVAS_TOKEN"])
    sent = run(canvas, telegram.send, State("canvas"), send_file=telegram.send_document)
    print(f"{sent} bildirim gönderildi")


if __name__ == "__main__":
    main()

"""Ders programı.

Program kişisel bilgidir (nerede, ne zaman olacağını gösterir) ve repo herkese açıktır;
bu yüzden dosyada değil, DERS_PROGRAMI adlı secret'ta durur. Biçim, her satırda bir ders:

    Pazartesi 10:00-11:45 EE452 F0C04
    Salı 11:00-12:45 EE4005 EECAPSLAB uygulama

Sıra: gün, saat aralığı, ders, (isteğe bağlı) derslik, (isteğe bağlı) not. # ile başlayan satırlar yok sayılır.
"""
import os
import re

from jarvis.agents.canvas_notifier import esc

DAY_KEYS = ["pazartesi", "sali", "carsamba", "persembe", "cuma", "cumartesi", "pazar"]
LINE = re.compile(r"^(\S+)\s+(\d{1,2})[:.](\d{2})\s*[-–]\s*(\d{1,2})[:.](\d{2})\s+(\S+)(?:\s+(\S+))?(?:\s+(.+))?$")


def _plain(text):
    text = text.replace("İ", "i").replace("I", "i").lower()
    for a, b in zip("ışğüöç", "isguoc"):
        text = text.replace(a, b)
    return text


def parse(text):
    """Metni {hafta günü (0=Pazartesi): [ders, ...]} sözlüğüne çevirir. Anlaşılmayan satırlar atlanır."""
    out = {}
    for raw in (text or "").splitlines():
        m = LINE.match(raw.strip())
        if not m or _plain(m.group(1)) not in DAY_KEYS:
            continue
        out.setdefault(DAY_KEYS.index(_plain(m.group(1))), []).append({
            "start": f"{int(m.group(2)):02d}:{m.group(3)}",
            "end": f"{int(m.group(4)):02d}:{m.group(5)}",
            "code": m.group(6), "room": m.group(7) or "", "note": (m.group(8) or "").strip(),
        })
    for lessons in out.values():
        lessons.sort(key=lambda x: (x["start"], x["code"]))
    return out


def load():
    return parse(os.environ.get("DERS_PROGRAMI", ""))


def lines_for(schedule, day):
    """day: datetime.date. O günün ders satırlarını döndürür; ders yoksa boş liste."""
    out = []
    for x in (schedule or {}).get(day.weekday(), []):
        line = f"• <b>{x['start']}–{x['end']}</b> {esc(x['code'])}"
        if x["room"]:
            line += f" · {esc(x['room'])}"
        if x["note"]:
            line += f" ({esc(x['note'])})"
        out.append(line)
    return out

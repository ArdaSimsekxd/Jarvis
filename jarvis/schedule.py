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


# Ders adının başında dersin kendisini anlatmayan kelimeler (dönem, şube) atlanır.
NOISE = {"guz", "bahar", "yaz", "fall", "spring", "summer", "section", "sec", "sube", "donemi", "donem"}


def _norm(text):
    return re.sub(r"[^0-9a-z]", "", _plain(text or ""))


def first_word(code, courses):
    """Ders kodunun Canvas'taki adının ilk kelimesini döndürür ('EE452' -> 'Digital'). Bulunamazsa ''."""
    key = _norm(code)
    if not key:
        return ""
    match = None
    for c in courses or []:
        if not isinstance(c, dict):
            continue
        if _norm(c.get("course_code")) == key:
            match = c
            break
        if match is None and (key in _norm(c.get("course_code")) or key in _norm(c.get("name"))):
            match = c
    if not match:
        return ""
    # Adın içinde kodun kendisi de geçebilir ("EE452 - Digital ...", "EE 452 Digital ..."): onu çıkar.
    m = re.fullmatch(r"([^\W\d_]+)(\d+)", code.strip())
    pattern = rf"{re.escape(m.group(1))}[\s\-_.]*{m.group(2)}" if m else re.escape(code.strip())
    name = re.sub(pattern, " ", match.get("name") or "", flags=re.IGNORECASE)
    for word in re.split(r"[^\w]+", name):
        if len(word) >= 2 and not any(ch.isdigit() for ch in word) and _plain(word) not in NOISE:
            return word
    return ""


def with_names(schedule, courses):
    """Programdaki her derse Canvas'taki adının ilk kelimesini ekler (gösterimde kodun önüne yazılır)."""
    cache = {}
    for lessons in (schedule or {}).values():
        for x in lessons:
            if x["code"] not in cache:
                cache[x["code"]] = first_word(x["code"], courses)
            x["name"] = cache[x["code"]]
    return schedule


def lines_for(schedule, day):
    """day: datetime.date. O günün ders satırlarını döndürür; ders yoksa boş liste."""
    out = []
    for x in (schedule or {}).get(day.weekday(), []):
        label = f"{x['name']} {x['code']}" if x.get("name") else x["code"]
        line = f"• <b>{x['start']}–{x['end']}</b> {esc(label)}"
        if x["room"]:
            line += f" · {esc(x['room'])}"
        if x["note"]:
            line += f" ({esc(x['note'])})"
        out.append(line)
    return out

"""Yemek listesi resmini okur (OCR) ve data/menu.json biçimine çevirir.

Liste her ay tablo halinde bir resim olarak geliyor. Tablonun çizgilerinden hücreleri bulur,
her hücreyi ayrı ayrı Tesseract ile okur. Tek tek hücre okumak, tüm resmi okumaktan çok daha isabetli.

Gerekenler: pillow, numpy ve sistemde `tesseract` (Türkçe dil paketiyle).
Kullanım: python -m jarvis.menu_ocr resim.png [--merge data/menu.json]
"""
import json
import re
import subprocess
import sys
import tempfile
from datetime import date, timedelta

MIN_DAYS = 10          # bundan az gün okunabildiyse resim yemek listesi değildir (ya da okunamadı)
KEEP_DAYS = 62         # menü dosyasında bundan eski günler tutulmaz
LINE_FRACTION = 0.5    # bir satır/sütunun bu kadarı koyuysa tablo çizgisidir
SCALE = 3


def plain(text):
    text = (text or "").replace("İ", "i").replace("I", "i").lower()
    for a, b in zip("ışğüöç", "isguoc"):
        text = text.replace(a, b)
    return re.sub(r"\s+", " ", text).strip()


def tr_title(text):
    """BÜYÜK HARFLİ yemek adını okunaklı hale getirir: 'ETLİ NOHUT' -> 'Etli Nohut'."""
    text = re.sub(r"\s+", " ", text or "").strip()
    text = re.sub(r"(?<=[^\W\d_])\s*[#*+]\s*(?=[^\W\d_])", " + ", text)      # OCR '+' işaretini #, * okuyabiliyor
    text = re.sub(r"(?<=[^\W\d_])\d(?=[^\W\d_])", " + ", text)               # ... ya da harfler arasında bir rakam
    text = re.sub(r"\.(?=[^\W\d_])", ". ", text)                             # 'ZER.MERCİMEK' -> 'ZER. MERCİMEK'
    lower = text.replace("İ", "i").replace("I", "ı").lower()

    def cap(m):
        w = m.group(0)
        first = {"i": "İ", "ı": "I"}.get(w[0], w[0].upper())
        return first + w[1:]

    return re.sub(r"[^\W\d_]+", cap, lower)


def _runs(mask):
    out, start = [], None
    for i, v in enumerate(mask):
        if v and start is None:
            start = i
        elif not v and start is not None:
            out.append((start, i - 1))
            start = None
    if start is not None:
        out.append((start, len(mask) - 1))
    return out


def _ocr(image, box, psm=7, digits=False):
    from PIL import Image
    cell = image.crop(box)
    if cell.width < 4 or cell.height < 4:
        return ""
    cell = cell.resize((cell.width * SCALE, cell.height * SCALE), Image.LANCZOS)
    with tempfile.NamedTemporaryFile(suffix=".png") as f:
        cell.save(f.name)
        cmd = ["tesseract", f.name, "stdout", "-l", "tur", "--psm", str(psm)]
        if digits:
            cmd += ["-c", "tessedit_char_whitelist=0123456789"]
        return subprocess.run(cmd, capture_output=True, text=True, timeout=60).stdout.strip()


def _number(image, box):
    for psm in (7, 8):
        text = re.sub(r"\D", "", _ocr(image, box, psm, digits=True))
        if text and 10 <= int(text) <= 5000:
            return int(text)
    return None


def _column_roles(headers):
    """Başlık metinlerinden hangi sütunun ne olduğunu bulur: {rol: sütun no}."""
    roles = {}
    for i, raw in enumerate(headers):
        h = plain(raw)
        if "tarih" in h:
            roles.setdefault("date", i)
        elif "corba" in h:
            roles.setdefault("Çorba", i)
        elif "ana" in h and "yemek" in h:
            roles.setdefault("Ana yemek", i)
        elif "vejet" in h and "yemek" in h:
            roles.setdefault("Vejetaryen", i)
        elif "yardimci" in h:
            roles.setdefault("Yardımcı", i)
        elif "tamamlay" in h:
            roles.setdefault("Tamamlayıcı", i)
        elif "toplam" in h and "vejet" not in h:
            roles["Kalori"] = i          # en sağdaki "TOPLAM KALORİ"
    return roles


def parse_image(path):
    """Resimdeki yemek listesini {"YYYY-AA-GG": {...}} olarak döndürür. Okunamazsa boş sözlük."""
    import numpy as np
    from PIL import Image

    image = Image.open(path).convert("L")
    dark = np.array(image) < 140
    vlines = _runs(dark.mean(axis=0) > LINE_FRACTION)
    hlines = _runs(dark.mean(axis=1) > LINE_FRACTION)
    if len(vlines) < 4 or len(hlines) < MIN_DAYS:
        return {}
    cols = [(vlines[i][1] + 3, vlines[i + 1][0] - 3) for i in range(len(vlines) - 1)]
    rows = [(hlines[i][1] + 3, hlines[i + 1][0] - 3) for i in range(len(hlines) - 1)]

    def box(r, c):
        return (cols[c][0], rows[r][0], cols[c][1], rows[r][1])

    # Başlık satırı: içinde "TARİH" geçen ilk satır (ilk birkaç satırda aranır).
    roles, header_row = {}, None
    for r in range(min(4, len(rows))):
        roles = _column_roles([_ocr(image, box(r, c), psm=6) for c in range(len(cols))])
        if {"date", "Çorba", "Ana yemek"} <= roles.keys():
            header_row = r
            break
    if header_row is None:
        return {}
    # Vejetaryen toplam kalori: iki satırlı başlığı güvenilir okunmuyor; "TOPLAM KALORİ"nin hemen solundaki sütun.
    veg_cal = roles["Kalori"] - 1 if roles.get("Kalori", 0) > max(v for k, v in roles.items() if k != "Kalori") + 1 else None

    days = {}
    for r in range(header_row + 1, len(rows)):
        m = re.search(r"(\d{1,2})\s*[.,/]\s*(\d{1,2})\s*[.,/]\s*(\d{4})", _ocr(image, box(r, roles["date"])))
        if not m:
            continue
        try:
            day = date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
        except ValueError:
            continue
        entry = {}
        for role in ("Çorba", "Ana yemek", "Vejetaryen", "Yardımcı", "Tamamlayıcı"):
            if role in roles:
                text = tr_title(_ocr(image, box(r, roles[role])))
                if text:
                    entry[role] = text
        if "Kalori" in roles:
            n = _number(image, box(r, roles["Kalori"]))
            if n:
                entry["Kalori"] = n
        if veg_cal is not None:
            n = _number(image, box(r, veg_cal))
            if n:
                entry["Vejetaryen kalori"] = n
        if "Ana yemek" in entry or "Çorba" in entry:
            days[day.isoformat()] = entry

    # Akıl sağlığı kontrolü: yeterince gün var mı, hepsi aynı aya mı ait?
    if len(days) < MIN_DAYS or len({k[:7] for k in days}) != 1:
        return {}
    return days


def merge(menu, days, today=None, source=None):
    """Yeni günleri menüye ekler (aynı günler güncellenir), çok eski günleri atar."""
    today = today or date.today()
    cutoff = (today - timedelta(days=KEEP_DAYS)).isoformat()
    merged = {k: v for k, v in (menu.get("days") or {}).items() if k >= cutoff}
    merged.update(days)
    out = dict(menu)
    out["days"] = dict(sorted(merged.items()))
    if source:
        out["source"] = source
    return out


def main(argv):
    if not argv:
        print(__doc__)
        return 2
    days = parse_image(argv[0])
    if not days:
        print("Resimden yemek listesi okunamadı.")
        return 1
    month = sorted(days)[0][:7]
    print(f"{len(days)} gün okundu ({month}).")
    if "--merge" in argv:
        path = argv[argv.index("--merge") + 1]
        try:
            with open(path, encoding="utf-8") as f:
                menu = json.load(f)
        except (OSError, ValueError):
            menu = {"days": {}}
        menu = merge(menu, days, source=f"Yemek listesi resmi, {month} (otomatik okundu)")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(menu, f, ensure_ascii=False, indent=1)
            f.write("\n")
    else:
        print(json.dumps(days, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

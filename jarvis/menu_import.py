"""Mailden gelen yemek listesi resmini okuyup data/menu.json dosyasına işler ve haber verir.

Kullanım: python -m jarvis.menu_import <resim> [--dry-run]
--dry-run: dosyayı değiştirmez, sadece okunanı yazdırır (deneme çalışmaları için).
Çıkış kodu 0 ve "changed=true" çıktısı: menü dosyası değişti, kaydedilmeli.
"""
import json
import os
import sys

from jarvis import menu as menu_mod
from jarvis import menu_ocr
from jarvis.channels import telegram

MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
          "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"]


def set_output(name, value):
    path = os.environ.get("GITHUB_OUTPUT")
    if path:
        with open(path, "a", encoding="utf-8") as f:
            f.write(f"{name}={value}\n")


def main(argv):
    image = argv[0]
    dry_run = "--dry-run" in argv
    days = menu_ocr.parse_image(image)
    if not days:
        print("Resimden yemek listesi okunamadı.")
        if not dry_run:
            telegram.send("🍽 Konusunda \"yemek\" geçen resimli bir mail geldi ama içinden liste okuyamadım. "
                          "Yeni ayın menüsüyse resmi Claude'a atman yeterli.")
        return 0

    year, month = sorted(days)[0].split("-")[:2]
    label = f"{MONTHS[int(month) - 1]} {year}"
    print(f"{len(days)} gün okundu ({label}).")
    if dry_run:
        print(json.dumps(days, ensure_ascii=False, indent=1))
        return 0

    current = menu_mod.load()
    known = current.get("days") or {}
    if all(known.get(k) for k in days):
        print("Bu ayın menüsü zaten kayıtlı, değişiklik yapılmadı.")  # elle düzeltilmiş kayıtları ezme
        return 0
    merged = menu_ocr.merge(current, {k: v for k, v in days.items() if not known.get(k)},
                            source=f"Yemek listesi, {label} (mailden otomatik okundu)")
    with open(menu_mod.MENU_PATH, "w", encoding="utf-8") as f:
        json.dump(merged, f, ensure_ascii=False, indent=1)
        f.write("\n")
    set_output("changed", "true")
    set_output("label", label)
    telegram.send(f"🍽 <b>{label} yemek listesi</b> maille geldi ve işlendi ({len(days)} gün). "
                  f"Bakmak için /yemek yazabilirsin.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

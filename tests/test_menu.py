"""Yemek listesi: metin düzeltme, birleştirme, mailden resim ayıklama. Çalıştırma: python -m unittest discover tests"""
import os
import tempfile
import unittest
from datetime import date
from email.message import EmailMessage

from jarvis import menu_ocr
from jarvis.agents import mail_notifier as mn


def mail(subject, images=()):
    m = EmailMessage()
    m["From"], m["Subject"] = "yemekhane@agu.edu.tr", subject
    m.set_content("Liste ektedir.")
    for i, size in enumerate(images):
        m.add_attachment(b"x" * size, maintype="image", subtype="png", filename=f"resim{i}.png")
    return m


class MenuTextTest(unittest.TestCase):
    def test_title_case_and_ocr_fixes(self):
        t = menu_ocr.tr_title
        self.assertEqual(t("ETLİ NOHUT"), "Etli Nohut")
        self.assertEqual(t("KIYMALI ISPANAK*YOĞURT"), "Kıymalı Ispanak + Yoğurt")
        self.assertEqual(t("HAMBURGER KÖFTE4FIRIN PATATES"), "Hamburger Köfte + Fırın Patates")
        self.assertEqual(t("TAVUK TANTUNİ#SÖĞÜŞ"), "Tavuk Tantuni + Söğüş")
        self.assertEqual(t("ZER.MERCİMEK ÇORBA"), "Zer. Mercimek Çorba")
        self.assertEqual(t("PEY/PAT.BÖREK"), "Pey/Pat. Börek")
        self.assertEqual(t("  İÇLİ   KÖFTE "), "İçli Köfte")
        self.assertEqual(t(""), "")

    def test_column_roles(self):
        headers = ["TARİH", "GÜN", "ÇORBA", "KALORİ", "BİRİM", "ANA YEMEK", "KALORİ", "BİRİM", "VEJETERYAN YEMEK",
                   "KALORİ", "BİRİM", "YARDIMCI YEMEK", "KALORİ", "BİRİM", "TAMAMLAYICI GRUP", "KALORİ", "BİRİM",
                   "VEJETERYAN\nTOPI AM KALMRİ", "TOPLAM KALORİ"]
        self.assertEqual(menu_ocr._column_roles(headers),
                         {"date": 0, "Çorba": 2, "Ana yemek": 5, "Vejetaryen": 8, "Yardımcı": 11, "Tamamlayıcı": 14, "Kalori": 18})

    def test_merge_keeps_recent_and_drops_old(self):
        menu = {"source": "eski", "days": {"2026-08-03": ["çok eski"], "2026-11-13": ["kasım"]}}
        out = menu_ocr.merge(menu, {"2026-12-01": ["aralık"]}, today=date(2026, 12, 1), source="yeni")
        self.assertEqual(list(out["days"]), ["2026-11-13", "2026-12-01"])
        self.assertEqual(out["source"], "yeni")


class MenuMailTest(unittest.TestCase):
    def test_menu_image_detection(self):
        self.assertIsNone(mn.menu_image(mail("Aralık ayı YEMEK listesi")))                    # resim yok
        self.assertIsNone(mn.menu_image(mail("Aralık ayı yemek listesi", [2000])))            # sadece küçük logo
        self.assertIsNone(mn.menu_image(mail("Ders programı", [400_000])))                    # konu ilgisiz
        data, ext = mn.menu_image(mail("Aralık Ayı Yemek Listesi", [2000, 400_000, 90_000]))  # en büyük resim
        self.assertEqual((len(data), ext), (400_000, "png"))

    def test_save_menu_image(self):
        out = tempfile.mkdtemp()
        path = mn.save_menu_image(mail("Yemek listesi", [100_000]), out)
        self.assertEqual(os.path.getsize(path), 100_000)
        self.assertIsNone(mn.save_menu_image(mail("Yemek listesi", [100_000]), None))
        self.assertIsNone(mn.save_menu_image(mail("Toplantı", [100_000]), out))


if __name__ == "__main__":
    unittest.main()

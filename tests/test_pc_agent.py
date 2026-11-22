import importlib.util
import os
import tempfile
import time
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("jarvis_pc", Path(__file__).resolve().parent.parent / "pc" / "jarvis_pc.py")
pc = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(pc)


class PairingTest(unittest.TestCase):
    def test_split_pairing(self):
        self.assertEqual(pc.split_pairing("https://jarvis.abc.workers.dev#K7P2-9QXA"), ("https://jarvis.abc.workers.dev", "K7P2-9QXA"))
        self.assertEqual(pc.split_pairing("  https://jarvis.abc.workers.dev/#K7P29QXA \n"), ("https://jarvis.abc.workers.dev", "K7P29QXA"))
        self.assertEqual(pc.split_pairing("http://jarvis.abc.workers.dev#K7P2-9QXA"), (None, None), "yalnızca https")
        self.assertEqual(pc.split_pairing("rastgele yazı"), (None, None))

    def test_bot_fills_and_setup_strips_the_code(self):
        source = Path(pc.__file__).read_text(encoding="utf-8")
        self.assertRegex(source, r'(?m)^PAIRING = ""$', "bot bu satırı doldurur (worker/src/pc.js injectPairing)")
        filled = source.replace('PAIRING = ""', 'PAIRING = "https://x.workers.dev#ABCD-EFGH"', 1)
        self.assertEqual(pc.strip_pairing(filled), source)


class HelpersTest(unittest.TestCase):
    def test_user_agent_is_not_pythons_default(self):
        # Cloudflare "Python-urllib" tanıtımıyla gelen istekleri 403 ile engelliyor
        self.assertTrue(pc.USER_AGENT.startswith("JarvisPC/"))
        source = Path(pc.__file__).read_text(encoding="utf-8")
        self.assertEqual(source.count("urllib.request.Request("), source.count('"User-Agent": USER_AGENT'))

    def test_volume(self):
        self.assertEqual(pc.volume_presses("40"), [("ses_kis", 50), ("ses_ac", 20)])
        self.assertEqual(pc.volume_presses("0"), [("ses_kis", 50), ("ses_ac", 0)])
        self.assertEqual(pc.volume_presses("ac"), [("ses_ac", 5)])
        self.assertEqual(pc.volume_presses("kıs"), [("ses_kis", 5)])
        self.assertEqual(pc.volume_presses("+10"), [("ses_ac", 5)])
        self.assertEqual(pc.volume_presses("250"), [("ses_kis", 50), ("ses_ac", 50)])
        self.assertIsNone(pc.volume_presses("biraz"))

    def test_resolve_target(self):
        self.assertEqual(pc.resolve_target("Spotify'ı"), ("app", "spotify:"))
        self.assertEqual(pc.resolve_target("hesap makinesi"), ("app", "calc"))
        self.assertEqual(pc.resolve_target("Canvas"), ("url", "https://canvas.agu.edu.tr"))
        self.assertEqual(pc.resolve_target("https://Example.com/A?b=1"), ("url", "https://Example.com/A?b=1"))
        self.assertEqual(pc.resolve_target("youtube.com/watch"), ("url", "https://youtube.com/watch"))
        self.assertEqual(pc.resolve_target("oyun", {"Oyun": "C:\\Games\\oyun.exe"}), ("app", "C:\\Games\\oyun.exe"))
        self.assertEqual(pc.resolve_target("bilinmeyen şey"), (None, None))
        self.assertEqual(pc.resolve_target("calc & del *"), (None, None), "tanınmayan hiçbir şey çalıştırılmaz")

    def test_recent_files_and_list(self):
        with tempfile.TemporaryDirectory() as d:
            for i, name in enumerate(["eski.pdf", "yeni.docx", "~$gecici.docx", "kisayol.lnk"]):
                p = Path(d) / name
                p.write_bytes(b"x" * (i + 1) * 1500)
                os.utime(p, (time.time() - 100 + i * 10,) * 2)
            files = pc.recent_files([Path(d), Path(d) / "yok"])
            self.assertEqual([Path(f).name for f, _ in files], ["yeni.docx", "eski.pdf"])
            text = pc.format_files(files)
            self.assertIn("1. yeni.docx (2.9 KB)", text)
            self.assertIn("/pc dosya 1", text)
        self.assertIn("bulamadım", pc.format_files([]))

    def test_location_and_wifi(self):
        self.assertEqual(pc.parse_location("38.72;35.48;40\r\n"), (38.72, 35.48, 40))
        self.assertEqual(pc.parse_location("-33.9;151.2;1200.6"), (-33.9, 151.2, 1200))
        self.assertIsNone(pc.parse_location("yok"))
        self.assertIsNone(pc.parse_location("izin-yok"))
        self.assertIsNone(pc.parse_location("95;35;10"))
        netsh = ("    Name                   : Wi-Fi\n    SSID                   : Ev Agi 5G\n"
                 "    BSSID                  : aa:bb:cc:dd:ee:ff\n")
        self.assertEqual(pc.parse_ssid(netsh), "Ev Agi 5G")
        self.assertIsNone(pc.parse_ssid("There is no wireless interface on the system."))

    def test_find_files_by_similar_name(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "Okul" / "Devre").mkdir(parents=True)
            (root / "node_modules").mkdir()
            (root / ".gizli").mkdir()
            for rel in ["Okul/Devre/Devre_Raporu_v2.pdf", "Okul/devre-lab-foyu.pdf", "Fizik Ödevi 3.docx",
                        "Okul/DigitalDesignHW4.pdf", "node_modules/devre raporu.pdf", ".gizli/devre raporu.pdf", "~$Devre Raporu.docx"]:
                (root / rel).write_bytes(b"x")
            files = pc.walk_files([root])
            names = sorted(Path(f[0]).name for f in files)
            self.assertNotIn("~$Devre Raporu.docx", names)
            self.assertEqual(len([n for n in names if n == "devre raporu.pdf"]), 0, "gizli ve sistem klasörleri atlanır")
            found = pc.find_files("devre raporunu", files)
            self.assertEqual(Path(found[0][0]).name, "Devre_Raporu_v2.pdf")
            self.assertTrue(pc.clear_winner(found))
            self.assertEqual(Path(pc.find_files("fizik odevi", files)[0][0]).name, "Fizik Ödevi 3.docx")
            self.assertEqual(Path(pc.find_files("digital design hw 4", files)[0][0]).name, "DigitalDesignHW4.pdf")
            self.assertEqual(pc.find_files("muhasebe tablosu", files), [])

    def test_unclear_match_asks_which_one(self):
        found = [("a/Devre_Raporu.pdf", 10, 0.98), ("b/Elektronik Devreler Raporu.pdf", 10, 0.93)]
        self.assertFalse(pc.clear_winner(found))
        self.assertFalse(pc.clear_winner([("x.pdf", 1, 0.7)]))
        self.assertGreater(pc.name_score("derve rapor", "Devre_Raporu_v2.pdf"), 0.8, "yazım hatası tolere edilir")

    def test_unknown_job(self):
        self.assertIn("bilmiyorum", pc.do_job({"is": "format_c"}, {}))
        self.assertIn("O numarada dosya yok", pc.do_job({"is": "dosya", "arg": "99"}, {}) if os.name == "nt" else "O numarada dosya yok")


if __name__ == "__main__":
    unittest.main()

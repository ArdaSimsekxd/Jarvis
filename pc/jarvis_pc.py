# Jarvis bilgisayar programı (Windows).
#
# Kurulum: Telegram'da Jarvis'e "/pc bağla" yaz, gelen dosyayı bilgisayarına indir ve çift tıkla.
# Program kendini %LOCALAPPDATA%\Jarvis klasörüne kopyalar, bilgisayar her açıldığında arka planda çalışır
# ve Jarvis'e bağlanıp komut bekler. Bağlantıyı program kendisi açar; modemde ayar gerekmez.
#
# Güvenlik: yalnızca aşağıdaki işleri yapar (kilitle, uyku, kapat, ekran görüntüsü, kamera fotoğrafı, konum, ses, müzik,
# uygulama/site açma, İndirilenler ve Masaüstündeki dosyaları gönderme). Kamera ve konum, bilgisayar kaybolur ya da
# çalınırsa sahibine (Telegram'daki "/pc kayıp") bilgisayarın yerini bulmak içindir. Rastgele komut çalıştırmaz. Bağlantı anahtarı yalnızca bu
# bilgisayarda (config.json) ve Jarvis'te (özeti) durur. Kaldırmak için bu dosyayı yeniden açıp "kaldir" yaz.

import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from pathlib import Path

# Telegram'dan gelen dosyada Jarvis bir sonraki satırı doldurur (tek kullanımlık eşleştirme kodu).
PAIRING = ""
VERSION = 4
# Cloudflare, Python'un varsayılan tanıtımıyla ("Python-urllib") gelen istekleri engelliyor (HTTP 403, hata 1010).
USER_AGENT = f"JarvisPC/{VERSION} (Windows)"

HOME = Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "Jarvis"
CONFIG = HOME / "config.json"
SCRIPT = HOME / "jarvis_pc.pyw"
LOG = HOME / "jarvis.log"
RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
RUN_NAME = "Jarvis"
MAX_FILE = 45 * 1024 * 1024
CREATE_NO_WINDOW = 0x08000000
DETACHED_PROCESS = 0x00000008

# Adıyla açılabilen uygulamalar ve siteler. config.json'daki "uygulamalar" bölümüne kendi eklediklerin de olur:
# "uygulamalar": {"oyun": "C:\\Games\\oyun.exe"}
APPS = {
    "spotify": "spotify:", "discord": "discord:", "steam": "steam://open/main", "whatsapp": "whatsapp:",
    "teams": "msteams:", "zoom": "zoommtg:", "vs code": "vscode:", "vscode": "vscode:",
    "chrome": "chrome", "edge": "msedge", "firefox": "firefox",
    "word": "winword", "excel": "excel", "powerpoint": "powerpnt", "outlook": "outlook",
    "not defteri": "notepad", "notepad": "notepad", "hesap makinesi": "calc", "dosya gezgini": "explorer",
    "dosyalar": "explorer", "ayarlar": "ms-settings:", "gorev yoneticisi": "taskmgr",
}
SITES = {
    "canvas": "https://canvas.agu.edu.tr", "okul maili": "https://posta.agu.edu.tr", "youtube": "https://www.youtube.com",
    "gmail": "https://mail.google.com", "github": "https://github.com", "instagram": "https://www.instagram.com",
    "netflix": "https://www.netflix.com", "google": "https://www.google.com", "chatgpt": "https://chatgpt.com",
}

VK = {"ses_ac": 0xAF, "ses_kis": 0xAE, "oynat": 0xB3, "sonraki": 0xB0, "onceki": 0xB1}

last_files = []   # "dosyalar" listesi: "dosya 3" bu listeden seçer
last_found = []   # "getir" araması: "getir 2" bu listeden seçer
SEARCH_SKIP = {"node_modules", "__pycache__", "appdata", "$recycle.bin", "venv", ".venv", "site-packages", "windows",
               "program files", "program files (x86)"}


# ---------- yardımcılar (her sistemde çalışır, test edilir) ----------

def plain(text):
    s = str(text or "").replace("İ", "i").replace("I", "i").lower()
    for a, b in (("ı", "i"), ("ş", "s"), ("ğ", "g"), ("ü", "u"), ("ö", "o"), ("ç", "c")):
        s = s.replace(a, b)
    return re.sub(r"\s+", " ", s).strip()


def split_pairing(text):
    """ "https://x.workers.dev#ABCD-EFGH" -> ("https://x.workers.dev", "ABCD-EFGH"); bozuksa (None, None)"""
    m = re.match(r"^\s*(https://[A-Za-z0-9.-]+)/?(?:pc)?#([A-Za-z0-9-]{6,12})\s*$", str(text or ""))
    return (m.group(1), m.group(2)) if m else (None, None)


def strip_pairing(source):
    """Kurulumda kopyalanan programdan tek kullanımlık kodu siler."""
    return re.sub(r'^PAIRING = "[^"\n]*"$', 'PAIRING = ""', source, count=1, flags=re.M)


def volume_presses(arg):
    """Ses isteğini tuş basışlarına çevirir. Her tuş sesi %2 değiştirir. Dönen: [(tuş, kaç kez), ...]"""
    a = plain(arg)
    if a in ("ac", "+"):
        return [("ses_ac", 5)]
    if a in ("kis", "-"):
        return [("ses_kis", 5)]
    m = re.fullmatch(r"([+-]?)(\d{1,3})", a)
    if not m:
        return None
    n = min(int(m.group(2)), 100)
    if m.group(1) == "+":
        return [("ses_ac", max(1, round(n / 2)))]
    if m.group(1) == "-":
        return [("ses_kis", max(1, round(n / 2)))]
    return [("ses_kis", 50), ("ses_ac", round(n / 2))]   # önce sıfıra, sonra istenen seviyeye


def resolve_target(what, custom=None):
    """Açılacak şeyi bulur. Dönen: ("url", adres) | ("app", hedef) | (None, None)"""
    raw = str(what or "").strip()
    if re.match(r"^https?://\S+$", raw, re.I):
        return "url", raw
    key = re.sub(r"['’`]\w*$", "", plain(raw)).strip()   # "spotify'ı" -> "spotify"
    for table, kind in ((custom or {}, None), (APPS, "app"), (SITES, "url")):
        lowered = {plain(k): v for k, v in table.items()}
        if key in lowered:
            value = lowered[key]
            return (kind or ("url" if re.match(r"^https?://", value) else "app")), value
    if re.fullmatch(r"[a-z0-9-]+(\.[a-z0-9-]+)+(/\S*)?", key):   # "youtube.com"
        return "url", "https://" + key
    return None, None


def human_size(n):
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    return f"{n} B"


def recent_files(folders, limit=10):
    files = []
    for folder in folders:
        try:
            for entry in os.scandir(folder):
                if entry.is_file() and not entry.name.startswith(("~$", ".")) and not entry.name.lower().endswith((".lnk", ".ini", ".tmp", ".crdownload", ".part")):
                    st = entry.stat()
                    files.append((st.st_mtime, entry.path, st.st_size))
        except OSError:
            continue
    files.sort(reverse=True)
    return [(path, size) for _, path, size in files[:limit]]


def format_files(files):
    if not files:
        return "📂 İndirilenler ve Masaüstünde dosya bulamadım."
    lines = ["📂 Son dosyalar:"]
    for i, (path, size) in enumerate(files, 1):
        lines.append(f"{i}. {Path(path).name} ({human_size(size)})")
    lines.append("Göndermem için: /pc dosya 1")
    return "\n".join(lines)


def name_words(name):
    """'Devre_Raporu-v2.PDF' -> ['devre', 'raporu', 'v2'] (uzantı atılır)"""
    stem = re.sub(r"\.[A-Za-z0-9]{1,5}$", "", str(name or ""))
    stem = re.sub(r"([a-zçğıöşü])([A-ZÇĞİÖŞÜ])", r"\1 \2", stem)   # DevreRaporu -> Devre Raporu
    return [w for w in re.split(r"[^a-z0-9]+", plain(stem)) if w]


def name_score(query, name):
    """Söylenen ad ile dosya adının benzerliği (0-1). Yazım hatası ve eksik ek tolere edilir."""
    from difflib import SequenceMatcher
    q = [w for w in name_words(query) if w not in ("dosya", "dosyasi", "dosyasini", "pdf", "belge", "belgesi")] or name_words(query)
    words = name_words(name)
    if not q or not words:
        return 0.0
    def word_score(a):
        best = 0.0
        for b in words:
            if a == b:
                return 1.0
            if len(a) >= 3 and (b.startswith(a) or a.startswith(b) and len(b) >= 3):
                best = max(best, 0.9)
            best = max(best, SequenceMatcher(None, a, b).ratio())
        return best
    avg = sum(word_score(a) for a in q) / len(q)
    whole = SequenceMatcher(None, " ".join(q), " ".join(words)).ratio()
    extra = max(0, len(words) - len(q)) * 0.02   # fazladan kelimeler biraz düşürür
    return round(max(avg, whole) - min(extra, 0.1), 3)


def walk_files(roots, max_files=40000, max_seconds=8):
    """Klasörlerdeki dosyalar (gizli ve sistem klasörleri atlanır): (yol, boyut, değişme zamanı)"""
    start, seen, out = time.time(), set(), []
    stack = [(Path(r), 0) for r in roots]
    while stack and len(out) < max_files and time.time() - start < max_seconds:
        folder, depth = stack.pop()
        try:
            key = os.path.realpath(folder).lower()
            if key in seen:
                continue
            seen.add(key)
            entries = list(os.scandir(folder))
        except OSError:
            continue
        for e in entries:
            if e.name.startswith((".", "~$", "$")):
                continue
            try:
                if e.is_dir(follow_symlinks=False):
                    if depth < 8 and e.name.lower() not in SEARCH_SKIP:
                        stack.append((Path(e.path), depth + 1))
                elif e.is_file() and not e.name.lower().endswith((".lnk", ".ini", ".tmp", ".crdownload", ".part")):
                    st = e.stat()
                    out.append((e.path, st.st_size, st.st_mtime))
            except OSError:
                continue
    return out


def find_files(query, files, limit=5):
    """En benzer dosyalar, en iyisi önce. Benzerlik eşitse yeni olan önce."""
    scored = [(name_score(query, Path(path).name), mtime, path, size) for path, size, mtime in files]
    scored = [x for x in scored if x[0] >= 0.55]
    scored.sort(key=lambda x: (-x[0], -x[1]))
    return [(path, size, score) for score, _, path, size in scored[:limit]]


def clear_winner(found):
    """Tek bir dosya açıkça öne çıkıyor mu?"""
    if not found or found[0][2] < 0.8:
        return False
    return len(found) == 1 or found[1][2] <= found[0][2] - 0.08


def search_roots():
    home = Path.home()
    roots = [home / "Desktop", home / "Documents", home / "Downloads", home / "OneDrive", home / "Pictures"]
    return [r for r in roots if r.exists()]


def load_config():
    try:
        return json.loads(CONFIG.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def log(message):
    try:
        HOME.mkdir(parents=True, exist_ok=True)
        if LOG.exists() and LOG.stat().st_size > 200_000:
            LOG.replace(LOG.with_suffix(".old.log"))
        with LOG.open("a", encoding="utf-8") as f:
            f.write(time.strftime("%Y-%m-%d %H:%M:%S ") + str(message) + "\n")
    except OSError:
        pass


# ---------- Windows işleri ----------

def _user32():
    import ctypes
    return ctypes.windll.user32


def press(key, times=1):
    user32 = _user32()
    for _ in range(times):
        user32.keybd_event(VK[key], 0, 0, 0)
        user32.keybd_event(VK[key], 0, 2, 0)   # 2 = tuşu bırak
        time.sleep(0.01)


def powershell(script, timeout=30):
    return subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
        capture_output=True, text=True, timeout=timeout, creationflags=CREATE_NO_WINDOW)


def battery():
    import ctypes

    class Status(ctypes.Structure):
        _fields_ = [("ac", ctypes.c_byte), ("flag", ctypes.c_byte), ("percent", ctypes.c_byte), ("saver", ctypes.c_byte),
                    ("life", ctypes.c_ulong), ("full", ctypes.c_ulong)]

    s = Status()
    if not ctypes.windll.kernel32.GetSystemPowerStatus(ctypes.byref(s)):
        return ""
    if s.flag & 128 or s.percent < 0 or s.percent > 100:
        return "Pil yok (prize bağlı)."
    return f"Pil: %{s.percent}{', şarj oluyor' if s.ac == 1 else ''}."


def uptime_text():
    import ctypes
    ctypes.windll.kernel32.GetTickCount64.restype = ctypes.c_ulonglong
    minutes = ctypes.windll.kernel32.GetTickCount64() // 60000
    if minutes < 60:
        return f"{minutes} dakikadır açık"
    hours = minutes // 60
    return f"{hours} saattir açık" if hours < 48 else f"{hours // 24} gündür açık"


SCREENSHOT_PS = r"""
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
Add-Type -Name D -Namespace W -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
[W.D]::SetProcessDPIAware() | Out-Null
$b = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
$bmp.Save('__PATH__', [System.Drawing.Imaging.ImageFormat]::Jpeg)
$g.Dispose(); $bmp.Dispose()
"""


def upload(cfg, path, kind, caption=""):
    data = Path(path).read_bytes()
    req = urllib.request.Request(cfg["server"] + "/pc/upload", data=data, method="POST", headers={
        "Authorization": "Bearer " + cfg["token"],
        "User-Agent": USER_AGENT,
        "Content-Type": "application/octet-stream",
        "X-Tur": kind,
        "X-Ad": urllib.parse.quote(Path(path).name),
        "X-Not": urllib.parse.quote(caption),
    })
    with urllib.request.urlopen(req, timeout=180) as res:
        return res.status == 200


def screenshot(cfg):
    path = Path(tempfile.gettempdir()) / f"jarvis_ekran_{int(time.time())}.jpg"
    try:
        r = powershell(SCREENSHOT_PS.replace("__PATH__", str(path).replace("'", "''")))
        if not path.exists():
            log(f"ekran görüntüsü alınamadı: {r.stderr[-300:]}")
            return "Ekran görüntüsü alamadım. Bilgisayar kilitliyse ekran görüntüsü alınamaz."
        upload(cfg, path, "foto", "🖥 Ekran görüntüsü " + time.strftime("%H:%M"))
        return ""
    finally:
        try:
            path.unlink()
        except OSError:
            pass


def webcam(cfg, caption):
    """Kameradan tek bir fotoğraf çeker ve Telegram'a gönderir (OpenCV gerekir; kurulum dosyası kurar)."""
    try:
        import cv2
    except ImportError:
        return ("Kamera için gereken parça (opencv) bu bilgisayarda kurulu değil. Telegram'da /pc bağla yazıp "
                "gelen dosyayı yeniden açarsan kurulur.")
    cam = cv2.VideoCapture(0, cv2.CAP_DSHOW)
    try:
        if not cam.isOpened():
            return "Kameraya ulaşamadım (kapalı ya da başka bir uygulama kullanıyor olabilir)."
        frame = None
        for _ in range(15):   # ilk kareler karanlık gelir: ışık ayarı otursun
            ok, img = cam.read()
            if ok:
                frame = img
            time.sleep(0.1)
    finally:
        cam.release()
    if frame is None:
        return "Kameradan görüntü alamadım."
    path = Path(tempfile.gettempdir()) / f"jarvis_kamera_{int(time.time())}.jpg"
    try:
        cv2.imwrite(str(path), frame)
        upload(cfg, path, "foto", caption)
        return ""
    finally:
        try:
            path.unlink()
        except OSError:
            pass


LOCATION_PS = r"""
Add-Type -AssemblyName System.Device
$w = New-Object System.Device.Location.GeoCoordinateWatcher('High')
$w.Start()
$t = 0
while (($w.Status -ne 'Ready') -and ($w.Permission -ne 'Denied') -and ($t -lt 120)) { Start-Sleep -Milliseconds 100; $t++ }
$c = $w.Position.Location
if ($w.Permission -eq 'Denied') { 'izin-yok' }
elseif ($c.IsUnknown) { 'yok' }
else { $i = [Globalization.CultureInfo]::InvariantCulture; '{0};{1};{2}' -f $c.Latitude.ToString($i), $c.Longitude.ToString($i), [math]::Round($c.HorizontalAccuracy) }
$w.Stop()
"""


def parse_location(text):
    """'38.72;35.48;40' -> (38.72, 35.48, 40); diğer her şey None."""
    m = re.match(r"^\s*(-?\d+(?:\.\d+)?);(-?\d+(?:\.\d+)?);(\d+(?:\.\d+)?)\s*$", text or "")
    if not m:
        return None
    lat, lon, acc = float(m.group(1)), float(m.group(2)), float(m.group(3))
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    return lat, lon, int(acc)


def parse_ssid(netsh_output):
    """'netsh wlan show interfaces' çıktısından bağlı Wi-Fi ağının adı (BSSID satırı değil)."""
    for line in (netsh_output or "").splitlines():
        m = re.match(r"^\s*SSID\s*:\s*(.+?)\s*$", line)
        if m:
            return m.group(1)
    return None


def location_text():
    lines = []
    try:
        loc = parse_location(powershell(LOCATION_PS, timeout=25).stdout.strip())
    except (subprocess.SubprocessError, OSError):
        loc = None
    if loc:
        lat, lon, acc = loc
        lines.append(f"📍 Konum (Windows): https://maps.google.com/?q={lat:.5f},{lon:.5f} (yaklaşık ±{acc} m)")
    else:
        lines.append("📍 Windows konumu alınamadı (Ayarlar > Gizlilik > Konum kapalı olabilir).")
    try:
        out = subprocess.run(["netsh", "wlan", "show", "interfaces"], capture_output=True, text=True, timeout=10,
                             creationflags=CREATE_NO_WINDOW, errors="replace").stdout
        ssid = parse_ssid(out)
    except (subprocess.SubprocessError, OSError):
        ssid = None
    lines.append(f"📶 Wi-Fi: {ssid}" if ssid else "📶 Wi-Fi'ye bağlı değil (kablo ya da telefon interneti olabilir).")
    return "\n".join(lines)


def start_menu_shortcut(name):
    """Başlat menüsündeki kısayollarda adı geçen uygulamayı bulur (yalnızca kurulu uygulamalar)."""
    want = plain(name)
    if len(want) < 3:
        return None
    roots = [Path(os.environ.get("APPDATA", "")) / r"Microsoft\Windows\Start Menu\Programs",
             Path(os.environ.get("PROGRAMDATA", r"C:\ProgramData")) / r"Microsoft\Windows\Start Menu\Programs"]
    hits = []
    for root in roots:
        if root.is_dir():
            for lnk in root.rglob("*.lnk"):
                stem = plain(lnk.stem)
                if want in stem and "uninstall" not in stem and "kaldir" not in stem:
                    hits.append((len(stem), str(lnk)))
    return min(hits)[1] if hits else None


def open_thing(what, cfg):
    kind, target = resolve_target(what, cfg.get("uygulamalar"))
    if kind is None:
        target = start_menu_shortcut(what)
        kind = "app" if target else None
    if kind is None:
        return f"\"{what}\" diye bir uygulama ya da site bulamadım. Tanıdıklarım için: /pc uygulamalar"
    if kind == "url":
        webbrowser.open(target)
        return f"🌐 Açtım: {target}"
    try:
        os.startfile(target)
    except OSError:
        return f"\"{what}\" açılamadı; bilgisayarda kurulu olmayabilir."
    return f"🚀 Açıyorum: {what}"


def send_to_panel(cfg, path):
    try:
        upload(cfg, path, "panel", Path(path).name)
    except Exception as err:   # noqa: BLE001 - kullanıcıya kısa haber yeter
        log(f"dosya panele gönderilemedi: {err}")


def fetch_file(cfg, arg):
    """'getir devre raporu' adına en yakın dosyayı panele gönderir; 'getir 2' son aramadan seçer."""
    global last_found
    arg = arg.strip()
    if arg.isdigit():
        n = int(arg)
        if not 1 <= n <= len(last_found):
            return "O numarada dosya yok. Önce adını söyle: /pc getir devre raporu"
        path, size, _ = last_found[n - 1]
    else:
        if len(plain(arg)) < 2:
            return "Hangi dosyayı getireyim? Örnek: /pc getir devre raporu"
        found = find_files(arg, walk_files(search_roots()))
        last_found = found
        if not found:
            return f"\"{arg}\" adına benzeyen bir dosya bulamadım (Masaüstü, Belgeler, İndirilenler, OneDrive ve Resimler'e baktım)."
        if not clear_winner(found):
            lines = ["Birkaç dosya buldum, hangisi?"]
            for i, (p, size, _) in enumerate(found, 1):
                lines.append(f"{i}. {Path(p).name} ({human_size(size)}) · {Path(p).parent.name}")
            lines.append("Seçmek için: /pc getir 1")
            return "\n".join(lines)
        path, size, _ = found[0]
    if size > MAX_FILE:
        return f"{Path(path).name} çok büyük ({human_size(size)}); en fazla 45 MB gönderebilirim."
    threading.Thread(target=send_to_panel, args=(cfg, path), daemon=True).start()
    return f"📄 {Path(path).name} ({human_size(size)}) buldum, panele gönderiyorum."


def send_file(cfg, path, size):
    try:
        upload(cfg, path, "dosya", "📎 " + Path(path).name)
    except Exception as err:   # noqa: BLE001 - kullanıcıya kısa haber yeter
        log(f"dosya gönderilemedi: {err}")


def do_job(job, cfg):
    """Tek bir işi yapar, Telegram'a yazılacak cevabı döndürür ("" = cevap ayrıca gitti)."""
    global last_files
    what, arg = job.get("is", ""), str(job.get("arg", ""))
    if what == "durum":
        return f"🖥 Bilgisayar açık ({uptime_text()}). {battery()}".strip()
    if what == "kilitle":
        _user32().LockWorkStation()
        return "🔒 Bilgisayarı kilitledim."
    if what == "uyku":
        threading.Timer(3, lambda: powershell("Add-Type -AssemblyName System.Windows.Forms; "
                                              "[System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false)")).start()
        return "😴 Bilgisayarı uyku moduna alıyorum. Uyanınca yeniden bağlanırım."
    if what in ("kapat", "yeniden"):
        flag = "/s" if what == "kapat" else "/r"
        r = subprocess.run(["shutdown", flag, "/t", "60", "/c", "Jarvis bilgisayari 1 dakika icinde kapatacak."],
                           capture_output=True, creationflags=CREATE_NO_WINDOW)
        if r.returncode not in (0, 1190):   # 1190: zaten bekleyen bir kapatma var
            return "Kapatma komutu çalışmadı."
        verb = "kapanacak" if what == "kapat" else "yeniden başlayacak"
        return f"⏻ Bilgisayar 1 dakika içinde {verb}. Vazgeçersen: /pc iptal"
    if what == "iptal":
        r = subprocess.run(["shutdown", "/a"], capture_output=True, creationflags=CREATE_NO_WINDOW)
        return "✋ Kapatmayı iptal ettim." if r.returncode == 0 else "Bekleyen bir kapatma yoktu."
    if what == "ekran":
        return screenshot(cfg)
    if what == "kamera":
        return webcam(cfg, arg or ("📷 Kamera " + time.strftime("%H:%M")))
    if what == "konum":
        return location_text()
    if what == "ses":
        presses = volume_presses(arg)
        if not presses:
            return "Sesi nasıl ayarlayacağımı anlamadım. Örnek: /pc ses 40"
        for key, times in presses:
            press(key, times)
        return "🔇 Sesi kapattım." if plain(arg) == "0" else f"🔊 Ses ayarlandı{' (%' + arg + ')' if arg.isdigit() else ''}."
    if what == "medya":
        press({"sonraki": "sonraki", "onceki": "onceki"}.get(arg, "oynat"))
        return {"sonraki": "⏭ Sonraki parça.", "onceki": "⏮ Önceki parça."}.get(arg, "⏯ Oynat/durdur tuşuna bastım.")
    if what == "ac":
        return open_thing(arg, cfg)
    if what == "uygulamalar":
        custom = sorted((cfg.get("uygulamalar") or {}).keys())
        return ("Açabildiklerim: " + ", ".join(sorted(APPS) + sorted(SITES) + custom)
                + ". Başlat menüsündeki diğer uygulamaları da adıyla açabilirim; bağlantı da olur.")
    if what == "dosyalar":
        home = Path.home()
        last_files = recent_files([home / "Downloads", home / "Desktop", home / "OneDrive" / "Desktop"])
        return format_files(last_files)
    if what == "getir":
        return fetch_file(cfg, arg)
    if what == "dosya":
        n = int(arg) if arg.isdigit() else 0
        if not last_files:
            home = Path.home()
            last_files = recent_files([home / "Downloads", home / "Desktop", home / "OneDrive" / "Desktop"])
        if not 1 <= n <= len(last_files):
            return "O numarada dosya yok. Liste için: /pc dosyalar"
        path, size = last_files[n - 1]
        if size > MAX_FILE:
            return f"{Path(path).name} çok büyük ({human_size(size)}); en fazla 45 MB gönderebilirim."
        threading.Thread(target=send_file, args=(cfg, path, size), daemon=True).start()
        return f"📎 Gönderiyorum: {Path(path).name} ({human_size(size)})"
    return "Bu işi bilmiyorum. Programın yeni sürümü gerekebilir: Telegram'da /pc bağla yazıp gelen dosyayı yeniden aç."


# ---------- Jarvis'e bağlantı ----------

def run_agent():
    import ctypes
    mutex = ctypes.windll.kernel32.CreateMutexW(None, False, "Local\\JarvisPC")   # aynı anda tek kopya
    if ctypes.windll.kernel32.GetLastError() == 183:
        return
    _ = mutex
    try:
        from websockets.sync.client import connect
    except ImportError:
        log("websockets eksik: kurulum dosyasını yeniden çalıştır")
        return

    backoff = 5
    while True:
        cfg = load_config()
        if not cfg:
            log("ayar dosyası yok, program duruyor")
            return
        url = cfg["server"].replace("https://", "wss://", 1) + "/pc/connect"
        try:
            with connect(url, additional_headers={"Authorization": "Bearer " + cfg["token"]}, user_agent_header=USER_AGENT,
                         open_timeout=20, close_timeout=5, ping_interval=None, max_size=2 ** 20) as ws:
                log("Jarvis'e bağlandı")
                backoff = 5
                lock = threading.Lock()
                stop = threading.Event()

                def reply(data):
                    with lock:
                        ws.send(json.dumps(data, ensure_ascii=False))

                def pinger():
                    while not stop.wait(30):
                        try:
                            with lock:
                                ws.send("ping")
                        except Exception:   # noqa: BLE001
                            return

                def handle(job):
                    try:
                        text = do_job(job, cfg)
                    except Exception as err:   # noqa: BLE001
                        log(f"iş yapılamadı ({job.get('is')}): {err}")
                        text = "Bu işi yaparken bir hata oldu."
                    try:
                        reply({"id": job.get("id"), "metin": text or ""})
                    except Exception:   # noqa: BLE001
                        pass

                threading.Thread(target=pinger, daemon=True).start()
                try:
                    while True:
                        message = ws.recv(timeout=90)   # 30 sn'de bir pong gelir; gelmezse bağlantı kopmuştur
                        if message == "pong":
                            continue
                        try:
                            job = json.loads(message)
                        except ValueError:
                            continue
                        threading.Thread(target=handle, args=(job,), daemon=True).start()
                finally:
                    stop.set()
        except Exception as err:   # noqa: BLE001
            status = getattr(getattr(err, "response", None), "status_code", None)
            closed = getattr(getattr(err, "rcvd", None), "code", None)
            log(f"bağlantı koptu: {type(err).__name__} {status or closed or ''}")
            if status in (401, 403) or closed == 4001:
                # Anahtar değişti ya da bağlantı kaldırıldı: ayar dosyası yenilenmişse hemen, yoksa 1 dakika sonra dene.
                fresh = load_config()
                if fresh and fresh.get("token") != cfg.get("token"):
                    continue
                time.sleep(60)
                continue
        time.sleep(backoff)
        backoff = min(backoff * 2, 60)


# ---------- kurulum ----------

def post_json(url, body):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return json.loads(res.read().decode())
    except urllib.error.HTTPError as err:
        body = err.read().decode(errors="replace")
        try:
            return json.loads(body)
        except ValueError:
            detail = re.sub(r"<[^>]+>|\s+", " ", body).strip()[:80]
            return {"error": f"Jarvis cevap vermedi (HTTP {err.code}{': ' + detail if detail else ''})."}


def pythonw():
    candidate = Path(sys.executable).with_name("pythonw.exe")
    return str(candidate if candidate.exists() else sys.executable)


def set_autostart(enabled):
    import winreg
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
        if enabled:
            winreg.SetValueEx(key, RUN_NAME, 0, winreg.REG_SZ, f'"{pythonw()}" "{SCRIPT}" --calis')
        else:
            try:
                winreg.DeleteValue(key, RUN_NAME)
            except FileNotFoundError:
                pass


def uninstall():
    set_autostart(False)
    try:
        CONFIG.unlink()
    except OSError:
        pass
    print("Jarvis bu bilgisayardan kaldırıldı. Arka planda çalışan kopya en geç bir dakika içinde kapanır.")
    print("Telegram'da /pc ayır yazarak Jarvis tarafındaki bağlantıyı da kaldırabilirsin.")


def ensure_websockets():
    try:
        import websockets  # noqa: F401
        return True
    except ImportError:
        pass
    print("Gerekli bir parça kuruluyor (websockets), bir dakika sürebilir...")
    r = subprocess.run([sys.executable, "-m", "pip", "install", "--user", "--quiet", "websockets"])
    if r.returncode != 0:
        print("Kurulamadı. İnternet bağlantını kontrol edip dosyayı yeniden aç.")
        return False
    import importlib
    import site
    importlib.invalidate_caches()
    user_site = site.getusersitepackages()
    if user_site not in sys.path:
        sys.path.append(user_site)
    return True


def ensure_camera():
    """Kamera için OpenCV (isteğe bağlı): kurulamazsa Jarvis yine çalışır, yalnızca kamera fotoğrafı olmaz."""
    try:
        import cv2  # noqa: F401
        return
    except ImportError:
        pass
    print("Kamera için bir parça kuruluyor (opencv, ~40 MB), biraz sürebilir...")
    r = subprocess.run([sys.executable, "-m", "pip", "install", "--user", "--quiet", "opencv-python-headless"])
    if r.returncode != 0:
        print("Kamera parçası kurulamadı; Jarvis yine çalışır, yalnızca kamera fotoğrafı çekemez.")


def setup():
    print("=== Jarvis bilgisayar kurulumu ===\n")
    if os.name != "nt":
        print("Bu program yalnızca Windows'ta çalışır.")
        return
    pairing = PAIRING
    if not pairing:
        if CONFIG.exists():
            print("Jarvis bu bilgisayarda zaten kurulu.")
        answer = input("Telegram'da /pc bağla yazınca gelen eşleştirme metnini yapıştır\n"
                       "(Jarvis'i bu bilgisayardan kaldırmak için: kaldir): ").strip()
        if plain(answer) == "kaldir":
            uninstall()
            return
        pairing = answer
    server, code = split_pairing(pairing)
    if not server:
        print("Eşleştirme metni anlaşılamadı. Telegram'da /pc bağla yazıp gelen yeni dosyayı aç.")
        return
    if not ensure_websockets():
        return
    ensure_camera()

    print("Jarvis'e bağlanılıyor...")
    result = post_json(server + "/pc/pair", {"code": code})
    token = result.get("token")
    if not token:
        print(result.get("error") or "Eşleştirme olmadı.")
        return

    HOME.mkdir(parents=True, exist_ok=True)
    old = load_config() or {}
    CONFIG.write_text(json.dumps({"server": server, "token": token, "uygulamalar": old.get("uygulamalar", {})},
                                 ensure_ascii=False, indent=2), encoding="utf-8")
    SCRIPT.write_text(strip_pairing(Path(__file__).read_text(encoding="utf-8")), encoding="utf-8")
    set_autostart(True)
    subprocess.Popen([pythonw(), str(SCRIPT), "--calis"], creationflags=DETACHED_PROCESS | CREATE_NO_WINDOW, close_fds=True)
    print("\n✓ Kuruldu! Jarvis artık bu bilgisayarda arka planda çalışıyor ve her açılışta kendiliğinden başlar.")
    print("Telegram'da deneyebilirsin: /pc ya da \"bilgisayarı kilitle\".")
    print(f"Ayarlar ve kayıt: {HOME}")


def main():
    if "--calis" in sys.argv:
        run_agent()
        return
    try:
        if "--kaldir" in sys.argv:
            uninstall()
        else:
            setup()
    except Exception as err:   # noqa: BLE001 - pencere kapanmadan önce hatayı göster
        print(f"\nBir hata oldu: {err}")
    input("\nKapatmak için Enter'a bas.")


if __name__ == "__main__":
    main()

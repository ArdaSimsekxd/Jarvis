"""Canvas'tan gelen HTML metni Telegram'ın anladığı sade biçime çevirir.

Paragraflar, madde işaretleri, kalın yazı ve bağlantılar korunur; gerisi atılır.
Telegram yalnızca düzgün iç içe geçmiş birkaç etiketi kabul ettiği için çıktı her zaman dengelidir.
"""
import html
import re
from html.parser import HTMLParser
from urllib.parse import urljoin

BOLD = {"b", "strong", "h1", "h2", "h3", "h4", "h5", "h6", "th"}
ITALIC = {"i", "em"}
BLOCK = {"p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "table", "blockquote", "pre", "section", "article"}
LINE = {"li", "tr"}
SKIP = {"script", "style", "head", "title"}
MORE = "… (devamı Canvas'ta)"


class _Converter(HTMLParser):
    def __init__(self, base_url, limit):
        super().__init__(convert_charrefs=True)
        self.base_url = base_url
        self.left = limit          # kalan ham karakter (etiketler dahil)
        self.out = []
        self.want = []             # istenen etiketler: (ad, açılış metni); ilk yazıyla birlikte açılır
        self.open = []             # gerçekten açılmış etiketler
        self.newlines = 0          # yazılmayı bekleyen satır sonu
        self.space = False         # yazılmayı bekleyen boşluk
        self.skip = 0
        self.full = False

    def _emit(self, raw):
        self.out.append(raw)
        self.left -= len(raw)

    def _write(self, body):
        """Görünen metni yazar; önce bekleyen satır sonu/boşluk ve bekleyen etiketler gelir."""
        if self.full:
            return
        if self.out and self.newlines:
            self._emit("\n" * min(self.newlines, 2))
        elif self.out and self.space:
            self._emit(" ")
        self.newlines, self.space = 0, False
        for name, raw in self.want:
            if name not in self.open and self.left > len(raw) + 60:
                self._emit(raw)
                self.open.append(name)
        escaped = html.escape(body, quote=False)
        if len(escaped) > self.left:
            self._emit(html.escape(body[:max(self.left, 0)].rsplit(" ", 1)[0], quote=False))
            self.full = True
        else:
            self._emit(escaped)

    def _want(self, name, raw):
        if all(n != name for n, _ in self.want):
            self.want.append((name, raw))

    def _close(self, name):
        if name in self.open:      # üstündekileri de kapat: iç içe sıra bozulmasın
            while self.open:
                top = self.open.pop()
                self._emit(f"</{top}>")
                self.want = [w for w in self.want if w[0] != top]
                if top == name:
                    break
        self.want = [w for w in self.want if w[0] != name]

    def handle_starttag(self, tag, attrs):
        if tag in SKIP:
            self.skip += 1
        elif tag == "br":
            self.newlines = min(self.newlines + 1, 2)
        elif tag in BLOCK:
            self.newlines = max(self.newlines, 2)
        elif tag in LINE:
            self.newlines = max(self.newlines, 1)
        if tag in ("td", "th"):
            self.space = True
        if self.skip:
            return
        if tag == "li":
            self._write("•")
            self.space = True
        elif tag in BOLD:
            self._want("b", "<b>")
        elif tag in ITALIC:
            self._want("i", "<i>")
        elif tag == "a":
            href = urljoin(self.base_url or "", dict(attrs).get("href") or "")
            if re.match(r"https?://", href):
                self._want("a", f'<a href="{html.escape(href, quote=True)}">')

    def handle_endtag(self, tag):
        if tag in SKIP:
            self.skip = max(self.skip - 1, 0)
        elif tag in BOLD:
            self._close("b")
        elif tag in ITALIC:
            self._close("i")
        elif tag == "a":
            self._close("a")
        if tag in BLOCK:
            self.newlines = max(self.newlines, 2)
        elif tag in LINE:
            self.newlines = max(self.newlines, 1)
        if tag in ("td", "th"):
            self.space = True

    def handle_data(self, data):
        if self.skip or self.full:
            return
        text = re.sub(r"\s+", " ", data)
        if not text.strip():
            self.space = self.space or bool(text)
            return
        if text[0] == " ":
            self.space = True
        self._write(text.strip())
        self.space = text[-1] == " "

    def result(self):
        while self.open:
            self._emit(f"</{self.open.pop()}>")
        return "".join(self.out).strip() + (MORE if self.full else "")


def to_telegram(text, base_url="", limit=3300):
    """HTML'i Telegram HTML'ine çevirir. limit: etiketler dahil en fazla karakter."""
    conv = _Converter(base_url, limit)
    try:
        conv.feed(text or "")
        conv.close()
    except Exception:  # bozuk HTML: elde olanla yetin
        pass
    return conv.result()

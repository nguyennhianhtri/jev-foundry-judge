"""Normalize a pasted Jev key. Phones add zero-width chars, newlines, quotes or a 'Bearer ' prefix."""
from __future__ import annotations

import re
import unicodedata

_ZW = "\u200b\u200c\u200d\u2060\ufeff\u00ad\u180e"


def clean_key(raw: str | None) -> str:
    if not raw:
        return ""
    k = "".join(ch for ch in str(raw) if ch not in _ZW and not ch.isspace()
                and unicodedata.category(ch) not in ("Cf", "Cc", "Zs", "Zl", "Zp"))
    # surrounding quotes/backticks (possibly repeated / smart quotes)
    k = re.sub(r'^[\'"`\u2018\u2019\u201c\u201d]+|[\'"`\u2018\u2019\u201c\u201d]+$', "", k)
    k = re.sub(r"^bearer[:]?", "", k, flags=re.I)
    k = re.sub(r'^[\'"`\u2018\u2019\u201c\u201d]+|[\'"`\u2018\u2019\u201c\u201d]+$', "", k)
    return k


INVALID_MSG = ("Jev says this key is invalid — check it's the full key from typesafe.ai "
               "(starts with apik…, ~108 chars). You pasted {n} characters{extra}.")

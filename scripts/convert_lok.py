#!/usr/bin/env python3
"""Převod listiny LOK (lok_sm_cz.xls z elo.miramal.com) na kompaktní JSON pro našeptávač.

K hráčům se doplní i rapid ratingy z rapid LOK (RRRRMMDD_rapid_lok_sm_cz.zip, vychází každé dva měsíce;
nejnovější se najde na úvodní stránce elo.miramal.com). Když se rapid listinu nepodaří stáhnout,
převod pokračuje jen s klasickou LOK.

Použití:
    python scripts/convert_lok.py --download docs/data/players.json
    python scripts/convert_lok.py --input lok_sm_cz.xls [--rapid-input rapid_lok_sm_cz.zip] docs/data/players.json
"""
import argparse
import datetime as dt
import json
import os
import re
import sys
import tempfile
import urllib.request
import zipfile

import xlrd

LOK_URL = "https://elo.miramal.com/download/lok_sm_cz.xls"
SITE_URL = "https://elo.miramal.com/"
RAPID_HREF = re.compile(r'href="(/download/(\d{8})_rapid_lok_sm_cz\.zip)"', re.I)
EXPECTED = ["ID_no", "Name", "ClubName", "BirthDay", "Sex", "Rtg_nat", "Rtg_int",
            "Title", "FIDE_no", "Fed", "ClubNo", "Status"]
# Pořadí položek každého hráče v JSONu (pole "players").
FIELDS = ["id", "name", "year", "sex", "rn", "rf", "title", "fide", "fed", "club", "st", "rr", "rfr"]
MIN_PLAYERS = 1000  # pojistka proti uložení prázdné nebo poškozené listiny


def as_int(value):
    if value in ("", None):
        return 0
    try:
        return int(float(value))
    except ValueError:
        return 0


def convert(path, label="LOK"):
    sheet = xlrd.open_workbook(path).sheet_by_index(0)
    header = [str(h).strip() for h in sheet.row_values(0)]
    missing = [h for h in EXPECTED if h not in header]
    if missing:
        raise SystemExit(f"Neočekávaný formát {label}, chybí sloupce: {missing} (sloupce: {header})")
    col = {h: header.index(h) for h in EXPECTED}

    clubs, players = {}, []
    for i in range(1, sheet.nrows):
        row = sheet.row_values(i)

        def get(name):
            return row[col[name]]

        name = " ".join(str(get("Name")).split())
        if not name:
            continue
        club_no = as_int(get("ClubNo"))
        club_name = str(get("ClubName")).strip()
        if club_no and club_name:
            clubs.setdefault(str(club_no), club_name)
        birth = str(get("BirthDay")).strip()  # formát 00.00.RRRR
        players.append([
            as_int(get("ID_no")),
            name,
            as_int(birth[-4:]) if len(birth) >= 4 else 0,
            "F" if str(get("Sex")).strip().lower() == "f" else "",
            as_int(get("Rtg_nat")),
            as_int(get("Rtg_int")),
            str(get("Title")).strip(),
            as_int(get("FIDE_no")),
            str(get("Fed")).strip() or "CZE",
            club_no,
            str(get("Status")).strip(),
            0,  # rapid ELO ČR (doplní merge_rapid)
            0,  # FIDE rapid
        ])

    if len(players) < MIN_PLAYERS:
        raise SystemExit(f"Podezřele málo hráčů ({len(players)}), převod zastaven.")
    return {
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "source": LOK_URL,
        "count": len(players),
        "fields": FIELDS,
        "clubs": clubs,
        "players": players,
    }


def read_rapid(path):
    """Rapid LOK (zip s .xls, nebo rovnou .xls) → {ID ČR: (rapid ELO ČR, FIDE rapid, řádek hráče)}."""
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as z:
            names = [n for n in z.namelist() if n.lower().endswith(".xls")]
            if not names:
                raise SystemExit(f"V rapid LOK chybí .xls (obsah: {z.namelist()})")
            tmp = tempfile.NamedTemporaryFile(suffix=".xls", delete=False)
            tmp.write(z.read(names[0]))
            tmp.close()
            path = tmp.name
    data = convert(path, label="rapid LOK")
    f = data["fields"]
    ix = {k: f.index(k) for k in ("id", "rn", "rf")}
    return {p[ix["id"]]: p for p in data["players"] if p[ix["id"]]}, data["clubs"]


def merge_rapid(data, rapid, rapid_clubs):
    """Doplní rapid ratingy; hráče, kteří jsou jen v rapid LOK, přidá (s klasickým ratingem 0)."""
    f = data["fields"]
    i_id, i_rn, i_rf, i_rr, i_rfr = (f.index(k) for k in ("id", "rn", "rf", "rr", "rfr"))
    seen = set()
    for p in data["players"]:
        r = rapid.get(p[i_id])
        if r:
            p[i_rr], p[i_rfr] = r[i_rn], r[i_rf]
            seen.add(p[i_id])
    added = 0
    for pid, r in rapid.items():
        if pid in seen:
            continue
        row = list(r)
        row[i_rr], row[i_rfr] = r[i_rn], r[i_rf]
        row[i_rn] = row[i_rf] = 0
        data["players"].append(row)
        added += 1
    for k, v in rapid_clubs.items():
        data["clubs"].setdefault(k, v)
    data["count"] = len(data["players"])
    return len(seen), added


def find_rapid_url():
    req = urllib.request.Request(SITE_URL, headers={"User-Agent": "prihlasovaci-formular (GitHub Actions)"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        html = resp.read().decode("utf-8", "replace")
    hits = sorted(RAPID_HREF.findall(html), key=lambda h: h[1])
    if not hits:
        raise SystemExit("Na elo.miramal.com není odkaz na rapid LOK.")
    return SITE_URL.rstrip("/") + hits[-1][0], hits[-1][1]


def download(url, suffix=".xls"):
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    req = urllib.request.Request(url, headers={"User-Agent": "prihlasovaci-formular (GitHub Actions)"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        tmp.write(resp.read())
    tmp.close()
    return tmp.name


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("output", help="cílový JSON, typicky docs/data/players.json")
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--input", help="lokální soubor lok_sm_cz.xls")
    src.add_argument("--download", action="store_true", help=f"stáhnout aktuální listinu z {LOK_URL}")
    ap.add_argument("--rapid-input", help="lokální rapid LOK (.zip nebo .xls); s --download se stáhne sama")
    args = ap.parse_args()

    path = download(LOK_URL) if args.download else args.input
    data = convert(path)
    rapid_path, rapid_date = args.rapid_input, ""
    try:
        if args.download and not rapid_path:
            url, rapid_date = find_rapid_url()
            rapid_path = download(url, suffix=".zip")
            data["rapidSource"] = url
        if rapid_path:
            rapid, rapid_clubs = read_rapid(rapid_path)
            matched, added = merge_rapid(data, rapid, rapid_clubs)
            data["rapidDate"] = rapid_date
            print(f"Rapid LOK {rapid_date}: {len(rapid)} hráčů, doplněno {matched}, navíc přidáno {added}", file=sys.stderr)
    except (SystemExit, OSError, zipfile.BadZipFile, xlrd.XLRDError) as e:
        print(f"::warning::Rapid LOK se nepodařilo zpracovat ({e}), použije se jen klasická LOK.", file=sys.stderr)
    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Uloženo {data['count']} hráčů a {len(data['clubs'])} klubů do {args.output}", file=sys.stderr)


if __name__ == "__main__":
    main()

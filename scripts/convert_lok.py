#!/usr/bin/env python3
"""Převod listiny LOK (lok_sm_cz.xls z elo.miramal.com) na kompaktní JSON pro našeptávač.

Použití:
    python scripts/convert_lok.py --download docs/data/players.json
    python scripts/convert_lok.py --input lok_sm_cz.xls docs/data/players.json
"""
import argparse
import datetime as dt
import json
import os
import sys
import tempfile
import urllib.request

import xlrd

LOK_URL = "https://elo.miramal.com/download/lok_sm_cz.xls"
EXPECTED = ["ID_no", "Name", "ClubName", "BirthDay", "Sex", "Rtg_nat", "Rtg_int",
            "Title", "FIDE_no", "Fed", "ClubNo", "Status"]
# Pořadí položek každého hráče v JSONu (pole "players").
FIELDS = ["id", "name", "year", "sex", "rn", "rf", "title", "fide", "fed", "club", "st"]
MIN_PLAYERS = 1000  # pojistka proti uložení prázdné nebo poškozené listiny


def as_int(value):
    if value in ("", None):
        return 0
    try:
        return int(float(value))
    except ValueError:
        return 0


def convert(path):
    sheet = xlrd.open_workbook(path).sheet_by_index(0)
    header = [str(h).strip() for h in sheet.row_values(0)]
    missing = [h for h in EXPECTED if h not in header]
    if missing:
        raise SystemExit(f"Neočekávaný formát LOK, chybí sloupce: {missing}")
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


def download(url):
    tmp = tempfile.NamedTemporaryFile(suffix=".xls", delete=False)
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
    args = ap.parse_args()

    path = download(LOK_URL) if args.download else args.input
    data = convert(path)
    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Uloženo {data['count']} hráčů a {len(data['clubs'])} klubů do {args.output}", file=sys.stderr)


if __name__ == "__main__":
    main()

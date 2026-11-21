# Přihlašovací formulář pro šachové turnaje

Náhrada Google formuláře pro přihlášky na šachový festival:

- **našeptávání hráčů** z listiny LOK (`lok_sm_cz.xls` z elo.miramal.com): po výběru se doplní ročník, klub, ELO ČR, FIDE, ID ČR, FIDE ID a titul,
- ruční zadání pro neregistrované a zahraniční hráče,
- **věkové podmínky turnajů se vynucují**, u limitu ELO formulář jen upozorní,
- **přihláška družstva** jedním formulářem (kapitán + hráči na šachovnicích s našeptáváním),
- přihlášky se ukládají do **Google Sheetu**, odesílá se potvrzovací e-mail,
- veřejný **seznam přihlášených** seřazený podle ratingu,
- **export pro Swiss-Manager** (`.TXT` a `.xlsx` pro každý turnaj zvlášť) ve stejném formátu jako export ze SM.

```
elo.miramal.com ──(GitHub Action, každý den)──► data/players.json
                                                      │
hráč ──► formulář na GitHub Pages (našeptávání) ──────┘
              │
              ▼
     Google Apps Script ──► Google Sheet „Přihlášky“
                                  │
                                  ▼
            menu „Šachový festival“ → Export pro Swiss-Manager (.TXT / .xlsx)
```

## Struktura

| Cesta | Co to je |
|---|---|
| `docs/` | web (GitHub Pages): `index.html` formulář, `seznam.html` seznam přihlášených |
| `docs/config.json` | **veškeré nastavení festivalu**: turnaje, ročníky, doprava, ubytování, uzávěrka |
| `scripts/convert_lok.py` | převod `lok_sm_cz.xls` → `docs/data/players.json` |
| `.github/workflows/web.yml` | testy, stažení LOK a nasazení webu (při změně v `main` a každý den) |
| `apps-script/Code.gs` | Google Apps Script: ukládání přihlášek, seznam, e-maily, export pro SM |
| `tests/` | testy (`node --test tests/*.test.js`) |

## Zprovoznění (jednou)

### 1. Web na GitHub Pages

1. V repozitáři na GitHubu: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. **Actions → „Web a listina LOK“ → Run workflow** (nebo jakýkoli push do `main`).
3. Web poběží na `https://<uživatel>.github.io/Prihlasovaci_formular/`.

Listina LOK se pak stahuje sama každý den. Když se stažení nepovede, zůstane poslední verze
a GitHub pošle e-mail o neúspěšném běhu.

### 2. Google Sheet a Apps Script

1. Založte nový Google Sheet (např. „Přihlášky Chlumec 2026“).
2. **Rozšíření → Apps Script**. Obsah `Code.gs` nahraďte souborem `apps-script/Code.gs`.
   V **Nastavení projektu** zaškrtněte „Zobrazit soubor manifestu appsscript.json“ a vložte obsah `apps-script/appsscript.json`.
3. Uložte, vraťte se do tabulky a obnovte stránku – objeví se menu **Šachový festival**.
4. **Šachový festival → Nastavit adresu konfigurace** a zadejte
   `https://<uživatel>.github.io/Prihlasovaci_formular/config.json`.
   Google si poprvé vyžádá oprávnění (tabulka, Drive, odesílání e-mailů, načtení URL).
5. V editoru Apps Script: **Nasadit → Nové nasazení → Webová aplikace**,
   „Spustit jako: **já**“, „Přístup: **kdokoli**“. Zkopírujte adresu končící `/exec`.
6. Adresu vložte do `docs/config.json` jako `"appsScriptUrl"` a commitněte do `main`.

> Při změně `Code.gs` je potřeba **Nasadit → Spravovat nasazení → Upravit → Nová verze**,
> jinak web dál volá starou verzi. Adresa `/exec` zůstane stejná.

## Nastavení festivalu – `docs/config.json`

```jsonc
"festival": {
  "name": "Šachový festival Chlumec okr. Ústí n. L. 2026",
  "year": 2026,              // podle něj se počítají kategorie U12…S60
  "deadline": "2026-05-02",  // po tomto dni se formulář zavře ("" = bez uzávěrky)
  "contactEmail": ""         // kam půjdou odpovědi na potvrzovací e-mail
},
"tournaments": [
  { "code": "zaci", "short": "Mladší žáci", "day": "sobota", "name": "…", "type": "individual",
    "minBirthYear": 2014 },                          // vynucuje se
  { "code": "neregistrovani", "short": "…", "maxBirthYear": 2013,
    "warnMaxRating": 1100 },                         // jen upozornění
  { "code": "druzstva", "type": "team", "boards": 4, "reserves": 1 }
]
```

Další volitelné položky turnaje: `capacity` (maximální počet hráčů / družstev).
Doplňky (`extras`) mohou být `checkboxes`, `select` nebo `textarea`; `modes` určuje,
jestli se ukazují u jednotlivců (`individual`), družstev (`team`) nebo obou.

**Během přihlašování neměňte `short` u turnajů a doplňků** – jsou to názvy sloupců v tabulce.
Nový turnaj nebo doplněk si tabulka přidá jako nový sloupec sama.

Pro nový ročník stačí upravit `config.json` (rok, ročníky, uzávěrka) a založit novou tabulku
s Apps Scriptem (nebo v té staré smazat řádky).

## Pro pořadatele

- **Tabulka „Přihlášky“**: jeden řádek za hráče, turnaje jako sloupce `ANO`.
  U družstva je jeden řádek za každého hráče (sloupce Družstvo, Šachovnice, Kapitán).
- **Zrušení přihlášky**: do sloupce **Stav** napište `zrušeno` – řádek zmizí ze seznamu i exportu.
- **Šachový festival → Export pro Swiss-Manager**: pro každý turnaj vytvoří na Disku
  `kod.TXT` a tabulku (ke stažení jako `.xlsx`). Sloupce jsou stejné jako v exportu ze SM:
  - `Jméno`, `surname`, `first name`, `ID č.`, `Rating nár`, `Rating FIDE`, `FIDE ID`, `Titul`, `Klub`, `Č.klubu`, `Sk.` z LOK,
  - `Narozen` jako `00.00.RRRR`, `Typ` = věková kategorie (U12/U15/U18/U20/S60) a u hráčů mimo LOK navíc `N`,
  - seřazeno podle ratingu FIDE a pak ELO ČR.
  - Družstva se exportují jako `druzstva_soupisky.TXT` (sloupce SM + Družstvo, Šachovnice, Kapitán).
- **Šachový festival → Souhrn turnajů, dopravy a ubytování**: list „Souhrn“ s počty a jmény.

## Vývoj lokálně

```bash
pip install xlrd==2.0.1
python scripts/convert_lok.py --download docs/data/players.json   # nebo --input lok_sm_cz.xls
python -m http.server -d docs 8000                                   # http://localhost:8000
node --test tests/*.test.js
```

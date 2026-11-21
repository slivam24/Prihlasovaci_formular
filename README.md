# Přihlášky na šachové turnaje

Webová aplikace pro přihlašování na šachové akce. Pořadatel si v administraci zakládá akce
(festival s více turnaji, nebo jeden samostatný turnaj) a hráči se přihlašují přes formulář
s **našeptáváním z listiny LOK**. Přihlášky jde exportovat **přímo pro Swiss-Manager**.

**Pro hráče**
- přehled akcí s otevřeným přihlašováním (`index.html`),
- přihláška na akci (`prihlaska.html?akce=<adresa>`):
  - našeptávač z LOK doplní ročník, klub, ELO ČR, FIDE, ID, FIDE ID a titul,
  - hráči mimo LOK se zadávají ručně,
- **věkové podmínky turnajů se vynucují**, u limitu ELO formulář jen upozorní,
- přihláška **družstva** jedním formulářem (kapitán + hráči na šachovnicích),
- potvrzovací e-mail a veřejný seznam přihlášených (`seznam.html?akce=<adresa>`).

**Pro pořadatele** (`admin.html`, přihlášení Google účtem)
- zakládání a úpravy akcí: termín, uzávěrka, stav, propozice, správci,
- turnaje v akci: jednotlivci / družstva, povolené ročníky, ELO limit, kapacita, počet šachovnic,
- doplňující otázky podle akce (doprava, ubytování, strava, …),
- přihlášky: zrušení / obnovení, úprava, poznámka pořadatele, ruční přidání hráče,
- **export pro Swiss-Manager** (.TXT a .xlsx) pro každý turnaj zvlášť, export všech přihlášek do Excelu,
- souhrn doplňujících otázek (kolik lidí chce dopravu, ubytování…),
- **změny přihlášek odkazem z e-mailu** (`zmena.html?t=…`): odhláška hráčů z turnajů, vrácení odhlášky,
  změna ubytování/obědů/dopravy – do dne před začátkem akce; e-mail o změně přihlášenému i pořadateli (kontaktní e-mail akce),
- **záznam všech změn** (list „Změny“) a export „Přihlášky, doplňky a změny“ (listy Přihlášky, Osoby a doplňky, Změny),
- **kopie akce na další rok** (posune data i ročníky),
- **import akce z propozic přes AI**: tlačítko „Importovat z propozic (AI)“ zkopíruje zadání pro ChatGPT / Clauda,
  odpověď (JSON) se vloží zpět a akce se otevře vyplněná v editoru ke kontrole (formát a převod: `docs/js/import.js`),
- **správci**: hlavní správce přidává pořadatele z dalších klubů, ti vidí jen své akce.

```
elo.miramal.com ──(GitHub Action, denně)──► data/players.json ──► našeptávač
                                                                   │
hráč / pořadatel ──► web na GitHub Pages ◄─────────────────────────┘
                          │  (JSON API)
                          ▼
            Google Apps Script ──► Google Sheet (listy Akce, Turnaje, Přihlášky, Správci)
```

## Struktura

| Cesta | Co to je |
|---|---|
| `docs/` | web (GitHub Pages): `index.html`, `prihlaska.html`, `seznam.html`, `admin.html` |
| `docs/config.json` | adresa backendu (`apiUrl`), Google Client ID, věkové kategorie pro export |
| `docs/js/` | `players.js` (našeptávač), `picker.js` (výběr hráče), `rules.js` (pravidla turnajů), `sm.js` (export SM), `admin.js` … |
| `apps-script/Code.gs` | backend: API, databáze nad Google Sheetem, e-maily, ověření přihlášení |
| `scripts/convert_lok.py` | převod `lok_sm_cz.xls` → `docs/data/players.json` |
| `.github/workflows/web.yml` | testy, stažení LOK a nasazení webu (při změně v `main` a každý den) |
| `tests/` | testy + simulace Google služeb (`gas-mock.js`) + vývojový server |

## Zprovoznění (jednou)

### 1. Web na GitHub Pages
1. Na GitHubu otevřete **Settings → Pages → Source: GitHub Actions**.
2. Spusťte **Actions → „Web a listina LOK“ → Run workflow**.
3. Web poběží na `https://<uživatel>.github.io/Prihlasovaci_formular/`. Listina LOK se pak aktualizuje každý den.

### 2. Přihlašování Googlem (Client ID)
1. V [Google Cloud Console](https://console.cloud.google.com/) založte projekt, např. „Přihlášky šachy“.
2. **APIs & Services → OAuth consent screen**:
   - typ *External*, vyplňte název aplikace a e-mail,
   - žádné další oprávnění nepřidávejte,
   - aplikaci přepněte na *In production*. Pro samotné přihlášení Google ověření aplikace nevyžaduje.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - typ *Web application*,
   - do **Authorized JavaScript origins** zadejte `https://<uživatel>.github.io`, pro lokální vývoj i `http://localhost:8000`.
4. Zkopírujte **Client ID** (končí `.apps.googleusercontent.com`).

### 3. Google Sheet a Apps Script (backend)
1. Založte nový Google Sheet, např. „Přihlášky – databáze“. Tabulku nikomu nesdílejte, je to databáze.
2. **Rozšíření → Apps Script**:
   - obsah `Code.gs` nahraďte souborem `apps-script/Code.gs`,
   - v **Nastavení projektu** zapněte „Zobrazit soubor manifestu appsscript.json“ a vložte obsah `apps-script/appsscript.json`.
3. Uložte, vraťte se do tabulky a obnovte stránku. Objeví se menu **Turnaje**.
4. Spusťte **Turnaje → Nastavení**:
   - Google si vyžádá oprávnění (tabulka, odesílání e-mailů, externí požadavky),
   - zadejte Client ID z kroku 2 a adresu webu,
   - váš účet se stane **hlavním správcem**.
5. V editoru Apps Script zvolte **Nasadit → Nové nasazení → Webová aplikace**:
   - „Spustit jako: **já**“, „Kdo má přístup: **kdokoli**“,
   - zkopírujte adresu končící `/exec`.
6. Do `docs/config.json` vyplňte `"apiUrl"` (adresa `/exec`) a `"googleClientId"` a commitněte do `main`.
7. Volitelně: **Turnaje → Založit ukázkovou akci (Chlumec 2026)**.

> Po každé změně `Code.gs` je potřeba nová verze nasazení. Ručně: **Implementovat → Spravovat implementace →
> Upravit → Verze: Nová verze** (adresa `/exec` zůstane stejná). Automaticky: viz další oddíl.

### 4. Automatické nasazení backendu (volitelné)
Workflow `.github/workflows/apps-script.yml` po každé změně v `apps-script/` nahraje kód do Apps Scriptu
(nástrojem [clasp](https://github.com/google/clasp)) a aktualizuje stávající nasazení. Jednorázové nastavení:

1. Na https://script.google.com/home/usersettings zapněte **Google Apps Script API**.
2. Otevřete https://shell.cloud.google.com a spusťte `npx @google/clasp@3.4.1 login --no-localhost`.
   Otevřete vypsaný odkaz, přihlaste se a povolte přístup. Prohlížeč pak skončí na nefunkční stránce
   `localhost…` – celou adresu z adresního řádku zkopírujte a vložte zpět do Cloud Shellu.
3. Příkazem `cat ~/.clasprc.json` vypište přihlašovací údaje a celý výstup zkopírujte.
4. GitHub → **Settings → Secrets and variables → Actions**:
   - záložka *Secrets* → **New repository secret**: název `CLASPRC_JSON`, hodnota = zkopírovaný obsah,
   - záložka *Variables* → **New repository variable**: název `SCRIPT_ID`, hodnota = ID skriptu
     (Apps Script → Nastavení projektu → ID skriptu).
5. **Actions → Backend (Apps Script) → Run workflow** – ověří, že nasazení funguje.

ID nasazení se bere z `apiUrl` v `docs/config.json`. Přihlašovací údaje clasp dávají přístup ke všem
Apps Script projektům účtu – uchovávejte je jen v GitHub Secrets.

### Přidání pořadatele z jiného klubu
V administraci otevřete **Správci → Přidat správce** a zadejte jeho Google účet s rolí *pořadatel*.
Pořadatel vidí a upravuje jen akce, které sám založil nebo u kterých je uveden v poli „Další správci akce“.

## Export pro Swiss-Manager
U každého turnaje v administraci jsou tlačítka **.TXT** a **.xlsx**. Formát je stejný jako export ze SM:
- UTF-8, středníky, CRLF,
- sloupce `Č.;Jméno;Titul;ID č.;Rating nár;Rating FIDE;Narozen; Fed;Pohl.;Typ;Sk.;Č.klubu;Klub;FIDE ID;…;surname;first name;atitle`,
- `Narozen` jako `00.00.RRRR`,
- `Typ` je věková kategorie podle roku akce (U12/U15/U18/U20/S60, nastavitelné v `config.json`) a u hráčů mimo LOK navíc `N`,
- `Sk.` se převezme z LOK,
- řádky jsou seřazené podle FIDE a pak ELO ČR.

Družstva se exportují jako soupisky: sloupce SM a navíc Družstvo, Šachovnice a Kapitán.

## Vývoj lokálně

```bash
pip install xlrd==2.0.1
python scripts/convert_lok.py --download docs/data/players.json   # nebo --input lok_sm_cz.xls
node tests/dev-server.js 8000      # web + backend v paměti, http://localhost:8000
node --test tests/*.test.js        # testy
```

Vývojový server spouští skutečný `Code.gs` nad simulovanou tabulkou a založí ukázkovou akci.
Do administrace se přihlásíte bez Googlu (účet `owner@example.cz`).

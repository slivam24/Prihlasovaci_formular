# Přihlášky na šachové turnaje

Webová aplikace pro přihlašování na šachové akce. Pořadatel si v administraci zakládá akce
(festival s více turnaji, nebo jeden samostatný turnaj) a hráči se přihlašují přes formulář
s **našeptáváním z listiny LOK**. Přihlášky jde exportovat **přímo pro Swiss-Manager**.

**Pro hráče**
- přehled akcí s otevřeným přihlašováním (`index.html`): kompaktní seznam po měsících nebo **kalendář**,
  hledání (od 5 akcí), uložení akce do vlastního kalendáře (.ics),
- přihláška na akci (`prihlaska.html?akce=<adresa>`):
  - našeptávač z LOK doplní ročník, klub, ELO ČR, FIDE, ID, FIDE ID a titul,
  - hráči mimo LOK se zadávají ručně,
- **věkové podmínky turnajů se vynucují**, u limitu ELO formulář jen upozorní,
- přihláška **družstva** jedním formulářem (kapitán + hráči na šachovnicích),
- potvrzovací e-mail a veřejný seznam přihlášených (`seznam.html?akce=<adresa>`).

**Pro pořadatele** (`admin.html`, přihlášení Google účtem)
- zakládání a úpravy akcí: termín, uzávěrka, stav, propozice, správci,
- turnaje v akci: jednotlivci / družstva, povolené ročníky, ELO limit, kapacita, počet šachovnic,
  **věkové kategorie** v turnaji (např. GP: 2016, 2012, 2008 a mladší – do mladší kategorie hráč nesmí, do starší ano s upozorněním),
  **rating klasický nebo rapid** (u rapid turnaje se ELO ČR a FIDE berou z rapid LOK – pro nasazení, export, slevy i upozornění),
- doplňující otázky podle akce (doprava, ubytování, strava, …),
- přihlášky: zrušení / obnovení, úprava, poznámka pořadatele, ruční přidání hráče,
- **export pro Swiss-Manager** (.TXT a .xlsx) pro každý turnaj zvlášť, export všech přihlášek do Excelu,
- **přepočet ratingu z LOK** (tlačítko v detailu akce): ELO ČR a FIDE přihlášených podle aktuální listiny,
  u rapid turnajů z rapid LOK; s náhledem změn a zápisem do záznamu změn,
- souhrn doplňujících otázek (kolik lidí chce dopravu, ubytování…),
- **družstva**: víc družstev v jedné přihlášce, soupiska se řadí šipkami (pořadí = šachovnice, pak náhradníci),
  hráče lze přidat filtrem „Vybrat hráče z listiny“ a přesouvat mezi družstvy; soupisku lze doplnit později
  přes odkaz z e-mailu, pořadatel ji upraví kdykoli („Upravit soupisku“ v detailu akce),
- **startovné se slevami** (ženy, mládež/senioři podle ročníku, tituly, ELO – platí nejnižší cena), částka k úhradě
  ve formuláři, na stránce změn i v e-mailu,
- **platby a pokladní doklady** („Platby a doklady“ v detailu akce): položky k úhradě (startovné, obědy, ubytování…),
  filtr podle klubu a kategorie, vystavení příjmového pokladního dokladu za vybrané položky (jeden, po hráčích, po přihláškách),
  tisk / PDF, storno, export; údaje klubu a řada čísel v nastavení akce,
- **obědy a ubytování s cenou**: typ otázky „počet kusů s cenou“ a předvolby v editoru akce, součty v souhrnu a exportu,
- **změny přihlášek odkazem z e-mailu** (`zmena.html?t=…`): odhláška hráčů z turnajů, vrácení odhlášky,
  změna ubytování/obědů/dopravy – do dne před začátkem akce; e-mail o změně přihlášenému i pořadateli (kontaktní e-mail akce),
- **záznam všech změn** (list „Změny“) a export „Přihlášky, doplňky a změny“ (listy Přihlášky, Osoby a doplňky, Změny),
- **kopie akce na další rok** (posune data i ročníky),
- **seznam k prezenci** k tisku („Seznam k prezenci“ v detailu akce nebo v platbách) ve třech variantách:
  po jménech (abecedně, výpravy odkazem na souhrn), po přihláškách, po klubech – vždy s částkou, kterou je ještě potřeba zaplatit,
- **hlídání limitu e-mailů**: co se kvůli dennímu limitu Googlu (100 e-mailů) neodešle, čeká ve frontě a odešle se automaticky,
  v administraci je upozornění; volitelně odesílání přes Brevo (300 e-mailů denně zdarma),
- **denní záloha tabulky** do složky „Přihlášky – zálohy“ na Disku (jen při změně; 14 posledních + 1 za měsíc),
- **ochrana osobních údajů**: stránka `ochrana-udaju.html?akce=…` (správcem je pořadatel akce), upozornění ve formuláři,
  e-maily a poznámky se 12 měsíců po akci automaticky mažou,
- **import akce z propozic přes AI**: tlačítko „Importovat z propozic (AI)“ zkopíruje zadání pro ChatGPT / Clauda,
  odpověď (JSON) se vloží zpět a akce se otevře vyplněná v editoru ke kontrole (formát a převod: `docs/js/import.js`),
- **správci**: hlavní správce přidává pořadatele z dalších klubů, ti vidí jen své akce.
- **klubová sekce** (Druh akce: klubová sekce): hráči se hlásí klubu na turnaje z kalendáře, klub pak posílá hromadnou
  přihlášku. Není v přehledu akcí (odkaz se rozešle členům), každý turnaj má vlastní datum, místo, klubovou uzávěrku
  a propozice; turnaj se po uzávěrce zavře, proběhlé se nenabízejí. U turnaje je export **pro pořadatele** (Excel
  a text do e-mailu) i pro Swiss-Manager. Plný přístup mají správci uvedení v poli „Správci klubové sekce“
  (musí být v seznamu správců jako pořadatel).
- **klubová sekce** (`klub.html`, odkaz v patičce úvodní stránky): přehled jen pro klub ve stejném vzhledu jako úvodní
  stránka – každá soutěž termínového kalendáře je samostatná akce (druh „klubová sekce“), včetně dlouhodobých soutěží.
  U akce stav: *přihlašování otevřeno* (tlačítko Přihlásit se), *výpravu nepořádáme*, *dlouhodobá soutěž*; filtry, mřížka.
  Správce přepíná přihlašování v administraci (záložka **Klubová sekce**) – při otevření zadá klubovou uzávěrku
  (výchozí 2 dny před), tlačítkem Upravit doplní poznámku, propozice a kategorie.
  Data ÚKŠS 2026/2027: `podklady/klubovy_kalendar_2026_2027.json` (založí se samy, viz `apps-script/KlubovyKalendar.gs`).
- **barvy akcí** podle značení termínového kalendáře (krajské, republikové, mládež, mládež ŠSČR, ostatní) – v přehledech
  i kalendáři, s legendou, která zároveň filtruje; nastavuje se v editoru („Barva v přehledu“).

```
elo.miramal.com (LOK + rapid LOK) ──(GitHub Action, denně)──► data/players.json ──► našeptávač
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

8. **Turnaje → Zapnout zálohy a frontu e-mailů** – potvrďte oprávnění (Disk kvůli zálohám, spouštěče). Zapne noční zálohu,
   odesílání e-mailů čekajících kvůli limitu a mazání kontaktů 12 měsíců po akci.

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

### E-maily přes Brevo (volitelné)
Gmail účet smí ze skriptu poslat asi 100 e-mailů denně. Při větším provozu:
1. Založte účet na brevo.com (zdarma 300 e-mailů denně) a ověřte odesílací adresu (nejlépe na doméně klubu).
2. Apps Script → Nastavení projektu → Vlastnosti skriptu: `BREVO_API_KEY` (API klíč) a `BREVO_SENDER` (ověřená adresa).

Bez těchto vlastností se posílá přes Gmail.

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

**Družstva** se do SM importují dvěma soubory (stejně jako je SM exportuje), proto má turnaj družstev tlačítka:
1. **Družstva .TXT** – `Č.;Jméno;Zkratka;Č.kl.;Captain;FED;Group;Info`, družstva v pořadí přihlášení,
   `Č.kl.` = nejčastější číslo klubu hráčů soupisky. Importuje se jako první.
2. **Hráči .TXT** – sloupce SM jako u jednotlivců a navíc `Šach.` (pořadí na soupisce, náhradníci pokračují)
   a `Č.tým.` (číslo družstva z prvního souboru).
3. **.xlsx** – oba seznamy jako dva listy (Družstva, Hráči).

## Vývoj lokálně

```bash
pip install xlrd==2.0.1
python scripts/convert_lok.py --download docs/data/players.json   # nebo --input lok_sm_cz.xls
node tests/dev-server.js 8000      # web + backend v paměti, http://localhost:8000
node --test tests/*.test.js        # testy
```

Vývojový server spouští skutečný `Code.gs` nad simulovanou tabulkou a založí ukázkovou akci.
Do administrace se přihlásíte bez Googlu (účet `owner@example.cz`).

# Nasadenie na Render

Výsledkom bude trvalá verejná HTTPS adresa (napr. `https://kde-su-kurieri.onrender.com`),
ktorú pošleš kuriérom aj kolegom. Poloha aj kamera budú fungovať, lebo je to HTTPS.

## 1. Daj kód na GitHub
Render načítava kód z Git repozitára. Ak ho ešte nemáš:
```bash
cd /Users/mikicernak/Documents/sac
git init
git add .
git commit -m "Kde su kurieri"
```
Vytvor si prázdny repozitár na github.com a potom:
```bash
git remote add origin https://github.com/TVOJE-MENO/kde-su-kurieri.git
git branch -M main
git push -u origin main
```

## 2. Vytvor službu na Render
1. Prihlás sa na https://render.com (zadarmo, cez GitHub).
2. **New → Blueprint**, vyber svoj repozitár. Render nájde súbor `render.yaml`.
3. Render sa spýta na hodnoty premenných:
   - `ADMIN_PASSWORD` – zvoľ si silné heslo do admina.
   - `PUBLIC_URL` – zatiaľ nechaj prázdne alebo daj dočasnú hodnotu, doplníš po prvom nasadení.
   - `SESSION_SECRET` – nechaj, Render ho vygeneruje sám.
4. Klikni **Apply**. Render appku zostaví a spustí.

## 3. Doplň PUBLIC_URL
Po prvom nasadení ti Render pridelí adresu, napr. `https://kde-su-kurieri.onrender.com`.
Choď do služby → **Environment** → nastav `PUBLIC_URL` na túto adresu a ulož.
Appka sa reštartuje. Odteraz budú linky v SMS správne ukazovať na túto adresu.

## 4. Hotovo
Otvor `https://tvoja-adresa.onrender.com`, prihlás sa heslom z `ADMIN_PASSWORD`,
pridaj kuriérov a pošli im linky.

---

## Dôležité o pláne a dátach
Súbor `render.yaml` je nastavený na plán **starter** s trvalým diskom (databáza a fotky
prežijú reštart). Starter je platený (~7 USD/mesiac).

**Chceš najprv len zadarmo otestovať?** V `render.yaml` zmaž celú sekciu `disk:` a riadok
`DB_PATH` s hodnotou `/var/data/...` nahraď za:
```yaml
      - key: DB_PATH
        value: ./data/poloha.sqlite
```
Na free pláne ale platí: po dlhšej nečinnosti sa služba uspí (prvé otvorenie je pomalšie)
a dáta sa pri reštarte stratia. Na ostrú prevádzku použi starter plán.

## Alternatíva: Railway
Railway (https://railway.app) funguje podobne – prepojíš GitHub, pridáš trvalý zväzok (volume)
na cestu `/var/data`, nastavíš rovnaké premenné prostredia. `render.yaml` tam netreba.

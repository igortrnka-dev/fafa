# Kde sú kuriéri

Sledovanie polohy zamestnancov počas pracovnej doby cez odkaz, ktorý im pošlete do SMS.
Zamestnanec klikne na link, zobrazí sa pozdrav a telefón počas pracovnej doby odosiela
polohu na váš server. Vy to vidíte na mape v admin rozhraní.

## Čo appka vie
- **Poloha s časom** každých 20–60 s počas nastavenej pracovnej doby. Mimo nej server nič neukladá.
- **Živá mapa** všetkých kuriérov naraz (zelená = online, oranžová = staršia poloha, sivá = dnes bez polohy).
- **História dňa** – celá trasa, časy a približný počet prejdených km.
- **IP adresa** zariadenia pri každej polohe (na identifikáciu zariadenia).
- **Nahlásenie nehody / poškodenia** – kuriér sám odfotí škodu a pridá popis.
- **Kamera vozidla** (voliteľné, treba zapnúť v Nastaveniach) – priebežná fotka v zadanom
  intervale. Kuriér vidí živý náhľad aj svietiaci indikátor. Treba písomne informovať zamestnancov.
- Dáta idú priamo na server, zamestnanec ich nevie meniť ani mazať. Admin je chránený heslom.

## Spustenie lokálne
```bash
npm install
cp .env.example .env     # a vyplňte heslo a tajný kľúč
ADMIN_PASSWORD=... SESSION_SECRET=... node server.js
```
Otvorte http://localhost:3000 – prihlásite sa heslom z ADMIN_PASSWORD.

## Nasadenie na internet (aby link fungoval aj mimo firmy)
Appka musí bežať na serveri s verejnou HTTPS adresou (poloha a kamera v prehliadači
fungujú len cez HTTPS). Postup:
1. Prenajmite si lacný VPS alebo použite službu ako Render, Railway, Fly.io.
2. Nastavte premenné prostredia: `ADMIN_PASSWORD`, `SESSION_SECRET` (dlhý náhodný reťazec),
   `PUBLIC_URL` (napr. https://poloha.vasafirma.sk).
3. Spustite `node server.js` (alebo cez priložený `Dockerfile`).
4. Pred ostrou adresou dajte HTTPS (reverzný proxy ako Caddy/Nginx, alebo to rieši hosting).

## Ako to používať
1. V záložke **Kuriéri** pridajte zamestnanca → appka vytvorí jeho osobný link.
2. Tlačidlom **Poslať SMS** alebo **Kopírovať link** pošlite link zamestnancovi.
3. Zamestnanec link otvorí a nechá stránku otvorenú (telefón v držiaku, zapnutá obrazovka).
4. V záložke **Teraz** vidíte polohy naživo, v **História** trasy za deň.
5. Link vypnete tlačidlom **Vypnúť** alebo **Nový link** (starý prestane fungovať).

## Právne upozornenie
Sledovanie polohy a snímanie kamerou zamestnancov podlieha GDPR a Zákonníku práce (§13).
Zamestnancov treba vopred preukázateľne informovať o rozsahu a účele. Pred nasadením,
najmä pri kamere, sa poraďte s právnikom. Skryté sledovanie je protizákonné.

## Údržba dát
- História polôh sa maže po 60 dňoch, snímky z kamery po 14 dňoch (nastaviteľné v server.js).
- Databáza aj fotky sú v priečinku `data/` – zálohujte ho.

## Spustenie lokálneho servera ako verejného (rýchly test)
Ak chceš, aby appka bežala na tvojom počítači a bola dostupná zvonka s HTTPS
(nutné pre polohu aj kameru), použi priložený skript. Jednorazovo nainštaluj tunel:
```bash
brew install cloudflared
```
Potom kedykoľvek spusti:
```bash
./start-public.sh
```
Skript spustí server (načíta `.env`) a vypíše verejnú adresu `https://....trycloudflare.com`.
Tú pošli kolegom aj kuriérom – admin aj linky kuriérov fungujú priamo na nej.
Adresa platí, kým skript beží; po Ctrl+C sa tunel aj server zastavia a adresa zanikne.
Na trvalú adresu použi nasadenie na Render (pozri DEPLOY.md).

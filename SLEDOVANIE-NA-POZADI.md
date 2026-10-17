# Sledovanie polohy na pozadí (aj pri zamknutom telefóne)

Webová stránka vie posielať polohu len kým je otvorená a obrazovka svieti.
Na sledovanie aj pri zamknutom alebo zavretom telefóne slúži bezplatná appka
**Traccar Client**, ktorá beží na pozadí a posiela polohu na tvoj server.
Zobrazí sa na tej istej mape ako doteraz.

## Čo potrebuje kuriér
1. Nainštalovať **Traccar Client** (App Store alebo Google Play, zadarmo).
2. V appke nastaviť:
   - **Server URL:** `https://TVOJA-ADRESA/gps` (napr. `https://deliveryverification.onrender.com/gps`)
   - **Device identifier:** jeho osobný kód (token) — nájdeš ho v admine v záložke
     Kuriéri → rozbaľ „Sledovanie na pozadí (Traccar Client)".
   - Frekvencia (Frequency): napr. 60 sekúnd.
3. Zapnúť prepínač **Service status** (hore). Appka si vypýta povolenie polohy
   — treba zvoliť **„Vždy / Always"**, inak pozadie nefunguje.

## Dôležité
- Povolenie polohy musí byť **„Vždy"**, nie „Iba počas používania".
- Server ukladá polohu len počas nastavenej pracovnej doby, mimo nej nie.
- Fotky appka neposiela — tie fungujú len cez webovú stránku s otvorenou kamerou.
  Na trvalý fotozáznam je potrebná palubná kamera v aute.
- Údaje na nastavenie (Server URL a Device identifier) nájdeš pri každom
  kuriérovi v admine, v záložke Kuriéri.

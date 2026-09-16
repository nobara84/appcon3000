# APPCON3000 WebBLE · v0.1

Deutschsprachige, mobile Web-App als Ersatz für die nicht mehr verfügbare iOS-App des NC-17 APPCON3000 Fahrraddynamo-/Ladesystems. Eine eigenständige `index.html` mit HTML, CSS und JavaScript; ohne Framework, Build, externe Bibliotheken, CDN, Tracker oder Analytics.

## Nutzung auf dem iPhone

1. Die HTTPS-Seite in **WebBLE** öffnen und Bluetooth aktivieren.
2. APPCON3000 einschalten, **APPCON verbinden** antippen und das Gerät auswählen. Bluetooth-Zugriff erlauben.
3. Radumfang und Polzahl in den Einstellungen prüfen (Standard: 2,149 m / 14).
4. Bei Bedarf den bisherigen Gesamtkilometerstand übernehmen; die Änderung verlangt eine Sicherheitsabfrage.

Ohne `navigator.bluetooth` zeigt die App den Hinweis, die Seite in WebBLE zu öffnen. Die tatsächliche Kompatibilität mit Gerät und WebBLE muss noch auf einem iPhone geprüft werden. Hintergrundbetrieb und Bildschirm-Sperre können die Messung unterbrechen. Während einer Trennung oder Hintergrundpause ist keine vollständige Streckenerfassung gewährleistet. Nach Verbindungsaufbau bzw. Sichtbarkeitswechsel dient das erste CSC-Paket als neue Basis.

## GitHub Pages

Im Repository unter **Settings → Pages → Deploy from a branch** den Branch **main** und **/(root)** auswählen. Anschließend ist die App unter `https://nobara84.github.io/appcon3000/` erreichbar, sofern Pages für dieses Repository aktiviert ist. Es ist kein Build-Schritt nötig. Ein Push allein aktiviert GitHub Pages nicht automatisch. HTTPS ist für Web Bluetooth erforderlich.

## Dokumentierte BLE-UUIDs

| Funktion | UUID | Verwendung |
| --- | --- | --- |
| Proprietärer Service | `02FF807E-4061-11E3-91EA-CE3F5508ACD9` | Als optionalService bei Geräteauswahl angefordert |
| High Resolution CSC | `02FF6850-4061-11E3-91EA-CE3F5508ACD9` | Notify |
| Battery Monitor | `4D18361D-8BBF-401F-AF6D-3F5983C794C1` | Read |
| Charger Monitor | `5B0F15BB-1B3E-468A-9BDE-2AF899DFA512` | Read |
| Harvester Monitor | `8A6FAF4A-4069-11E3-91EA-CE3F5508ACD9` | Nicht verwendet; Format unbestätigt |

Gefiltert wird nach dem Gerätenamen `APPCON3000`. Der optionale Standard Battery Service / 2A19 wird nicht verwendet.

## Decoder

Alle Mehrbytewerte sind Little Endian. Mindestpaketlängen werden geprüft, unbekannte Zusatzbytes nicht interpretiert.

**Battery Monitor: 16 Byte**

| Bytes | Typ / Berechnung | Wert |
| --- | --- | --- |
| 0–1 | uint16 / 1000 | Spannung V |
| 2–3 | int16 / 1000 | Durchschnittsstrom A |
| 4–5 | uint16 | Ladezustand % |
| 6–7 | uint16 / 1000 | Maximaler Ladestrom A |
| 8–9 | uint16 / 10 − 273,15 | Temperatur °C |
| 10–11 | uint16 | State of Health % |
| 12–13 | uint16 / 1000 | Kapazität Ah |
| 14–15 | uint16 | Ladezyklen |

Der interne Selbsttest nutzt `46 0f f6 ff 47 00 16 0d 6d 0b 64 00 4f 0d 04 00`: 3,910 V, −0,010 A, 71 %, 3,350 A, 19,35 °C, 100 %, 3,407 Ah, 4 Zyklen.

**Charger Monitor: 18 Byte**

| Bytes | Typ / Berechnung | Wert |
| --- | --- | --- |
| 0–1 / 2–3 | jeweils uint16 / 1000 | VBus V / IBus A |
| 4–5 / 6–7 | jeweils uint16 / 1000 | VOut V / IOut A |
| 8–9 | uint16 / 1000 | VRectPeak V |
| 10–11 | uint16 / 1000 | RectPower W (Dynamo-/Eingangsleistung) |
| 12–13 | uint16 / 1000 | ChargerMPP, Einheit unbekannt |
| 14 | uint8 / 2,5 | DynamoPeakPeak, Einheit unbekannt |
| 15 | unbekannt | Nicht dekodiert |
| 16 / 17 | jeweils uint8 | Charger State / Status Flags, Rohwerte |

USB-Ausgangsleistung = VOut × IOut. Der interne Selbsttest nutzt `0a 00 09 00 2e 13 0b 00 00 00 22 02 40 1f 2c 2c 02 19`: u. a. 4,910 V × 0,011 A = 0,05401 W, RectPower 0,546 W, MPP 8,000, DynamoPeakPeak 17,6.

**High Resolution CSC: mindestens 4 Byte**

Nur Bytes 0–3 werden als kumulativer uint32-Dynamo-Pulszähler interpretiert. Die übrigen Bytes werden nicht dekodiert. Strecke = gültiges Pulsdelta × Radumfang / Polzahl.

**Geschwindigkeit ist vorläufig:** Die austauschbare Zeitquelle `notificationClock` verwendet `performance.now()` zwischen Notifications. Der originale Gerätezeitdecoder ist noch nicht verifiziert. Funkverzögerungen und gebündelte Notifications beeinflussen die Messung. Negative Rücksprünge bzw. Deltas über den halben uint32-Bereich und Geschwindigkeiten über 100 km/h werden verworfen; ein plausibler uint32-Rollover wird berücksichtigt. Nach einem ungültigen Sprung wird die Basis neu gesetzt. Nach vier Sekunden ohne gültige neue Pulse wird 0 km/h angezeigt. Dieser Timeout ist eine App-Heuristik, keine Protokollkonstante.

## Aktualisierung, Persistenz und Datenschutz

Battery und Charger werden sofort nach dem Verbindungsaufbau und dann mit einer Sekunde Pause nach Abschluss eines Polls gelesen. Sämtliche Reads erfolgen nacheinander, ohne überlappende Polls. Ein einzelner Lesefehler trennt die Verbindung nicht; betroffene Werte werden als „—“ dargestellt und erneut abgefragt. Disconnect stoppt das Polling, setzt Geschwindigkeit auf 0 und entfernt alte Telemetrieanzeigen.

Trip und Odometer werden als ungerundete Meter, Radumfang und Polzahl als Zahlen in `localStorage` gespeichert. Trip-Reset und Odometer-Änderung verlangen jeweils Bestätigung. Der Trip-Reset verändert den Odometer nicht. Speicherprobleme werden angezeigt. Browserdaten löschen oder ein anderer Browser/eine andere Origin bedeuten einen getrennten bzw. verlorenen lokalen Kilometerstand.

Sämtliche BLE-Daten bleiben lokal im Browser; **unsere App überträgt keine BLE-Daten an einen Server**. GitHub Pages liefert nur die statischen Dateien aus. `console.debug` protokolliert Pakete und dekodierte Werte lokal für die Diagnose; diese Logs können Messwerte enthalten.

## Bekannte TODOs

- Original APPCON high-resolution timestamp decoder implementieren.
- Harvester-Verwendung und -Datenformat verifizieren, bevor ein Decoder ergänzt wird.
- Charger-Byte 15, MPP-/DynamoPeakPeak-Einheiten und Bedeutungen von State/Flags verifizieren.
- Reale BLE-Verbindung, iPhone/WebBLE, Fahrbetrieb, Timing, Hintergrundverhalten und Wiederverbindung am Gerät testen.

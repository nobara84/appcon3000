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

**High Resolution CSC: mindestens 18 Byte (wie im Original)**

Maßgebliche lokale Quelle: `appcon-decompiled/sources/de/thomastreyer/beonbike/model/`.
`BtAPPCON3000.java:190–198` überschreibt den generischen Decoder in
`BtDynamoHarvester.java`. Dessen direkte 64-Bit-Tickinterpretation gilt **nicht** für APPCON3000.
`BtDeviceKt.java:13–15` bestätigt Little Endian und unsigned 32-Bit-Wörter.

| Bytes | Interpretation |
| --- | --- |
| 0–3 | Kumulativer uint32-Dynamo-Pulszähler |
| 4–7 | uint32-Sekundenbruchteil, geteilt durch 2^32 |
| 8–11 | uint32 ganze Sekunden |
| 12 ff. | Für diese Berechnung nicht ausgewertet |

Zusammen sind Bytes 4–11 ein Q32.32-Sekundenwert. Der Originaldecoder rechnet:

```text
seconds = uint32LE(8) + uint32LE(4) / 4294967296
poleTime = trunc(seconds * 32768)
```

Die Web-App übernimmt die ursprüngliche Double-Arithmetik und Abschneidung.
Die Zeitbasis von `poleTime` ist damit 1/32768 Sekunde.

`BobSegment.java:440–482` hält maximal 256 Punkte vor. Ausgehend vom vorletzten
Punkt sucht es rückwärts, bis mindestens 16393 Ticks Abstand erreicht sind oder
nur noch der älteste Punkt verfügbar ist. Über dieses Fenster gilt:

```text
speed_kmh = (deltaPulses / deltaPoleTime)
            * wheelCircumference / wheelPoleCount * 32786 * 3.6
```

**Belegte Besonderheit:** Im Original stehen tatsächlich **32786** und **16393**,
obwohl der Decoder **32768** nutzt. Die Web-App übernimmt diese Geschwindigkeits-
und Glättungskonstanten originalgetreu. Der Faktor ergibt gegenüber der aus der
Decoderzeitbasis abgeleiteten Formel rund +0,0549 %. Ob dies ein Tippfehler oder
beabsichtigt ist, ist nicht belegt; es wird nicht stillschweigend korrigiert.
`BobSegment.java:420` verwendet ebenfalls 32786, während `GpxExporter.java:95`
mit 32768 in Millisekunden umrechnet. `SegmentView.java:112` bestätigt m/s → km/h
mit Faktor 3,6.

Der Originalempfänger drosselt anhand der Empfangsuhr auf Abstände >200 ms.
Die Web-App übernimmt diese Drosselung nicht und verarbeitet jede gültige
Notification. Empfangszeiten beeinflussen ausschließlich den Stillstands-Watchdog,
**nicht** die Geschwindigkeitsformel. Es gibt keinen Empfangszeit-Fallback:
ungültige Pakete werden ignoriert, ungültige Zeitdifferenzen verwerfen das Intervall
und setzen eine neue Basis. Der UI-Hinweis lautet „APPCON High-Resolution“.

**Rollover und zusätzliche Schutzlogik:** Die originale Geschwindigkeitsfunktion
subtrahiert Java-`int`-Pulszähler (kleine Vorwärtsdeltas über den Überlauf funktionieren
durch Integer-Wrap) und `long`-Zeitwerte ohne explizite Timestamp-Wrap-Korrektur.
Die Web-App berechnet Pulsdeltas modulo 2^32 und Tickdeltas modulo 2^47. Damit
funktionieren sowohl der Übertrag vom Bruchteil zum Sekundenwort als auch dessen
Überlauf. Deltas über den halben Wertebereich gelten als Rücksprung/Reset; Zeitdelta 0
bei geänderten Pulsen wird verworfen. Identische Punkte werden ignoriert.
Unrealistische Geschwindigkeiten >100 km/h werden sowohl vor als auch nach der
Glättung verworfen. Nach vier Sekunden ohne gültige neue Pulse wird 0 km/h angezeigt.
Disconnect, Sichtbarkeitswechsel und Änderung der Radparameter löschen die Messbasis.

Die Distanz bleibt unabhängig vom Glättungsfenster:
`distanceMeters = adjacentPulseDelta * wheelCircumference / wheelPoleCount`.
Radumfang (Default 2,149 m) und Polzahl (Default 14) bleiben konfigurierbar.

Lokale Regressionstests: `node tests/highres.cjs`. Sie enthalten alle 16 bereitgestellten
Originalpakete sowie Rollover-, Reset-, Glättungs-, Längen- und Watchdog-Prüfungen.
Mit 2,149 m / 14: 48576 → 48663 = 87 Pulse = 13,3545 m. Das erste Paket setzt
die Basis. Die folgenden 15 Geschwindigkeiten in km/h, auf drei Stellen gerundet:
8,006; 6,848; 6,249; 4,227; 6,611; 6,736; 6,542; 4,328; 0,031;
8,674; 8,740; 8,021; 8,015; 5,511; 3,558.
Dieselben Ergebnisse entstehen bei stark gebündelten Empfangszeiten.
Ein realer Fahrtest mit iPhone/WebBLE steht weiterhin aus.

## Aktualisierung, Persistenz und Datenschutz

Battery und Charger werden sofort nach dem Verbindungsaufbau und dann mit einer Sekunde Pause nach Abschluss eines Polls gelesen. Sämtliche Reads erfolgen nacheinander, ohne überlappende Polls. Ein einzelner Lesefehler trennt die Verbindung nicht; betroffene Werte werden als „—“ dargestellt und erneut abgefragt. Disconnect stoppt das Polling, setzt Geschwindigkeit auf 0 und entfernt alte Telemetrieanzeigen.

Trip und Odometer werden als ungerundete Meter, Radumfang und Polzahl als Zahlen in `localStorage` gespeichert. Trip-Reset und Odometer-Änderung verlangen jeweils Bestätigung. Der Trip-Reset verändert den Odometer nicht. Speicherprobleme werden angezeigt. Browserdaten löschen oder ein anderer Browser/eine andere Origin bedeuten einen getrennten bzw. verlorenen lokalen Kilometerstand.

Sämtliche BLE-Daten bleiben lokal im Browser; **unsere App überträgt keine BLE-Daten an einen Server**. GitHub Pages liefert nur die statischen Dateien aus. `console.debug` protokolliert Pakete und dekodierte Werte lokal für die Diagnose; diese Logs können Messwerte enthalten.

## Bekannte TODOs

- Ursache der Original-Konstanten 32786 statt 32768 klären; bis dahin originalgetreu beibehalten.
- Harvester-Verwendung und -Datenformat verifizieren, bevor ein Decoder ergänzt wird.
- Charger-Byte 15, MPP-/DynamoPeakPeak-Einheiten und Bedeutungen von State/Flags verifizieren.
- Reale BLE-Verbindung, iPhone/WebBLE, Fahrbetrieb, Timing, Hintergrundverhalten und Wiederverbindung am Gerät testen.

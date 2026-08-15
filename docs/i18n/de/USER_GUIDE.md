# Bookmark X – Benutzerhandbuch

[English](../../../README.md) · **Deutsch** · [Weitere Sprachen](../README.md)

Bookmark X ist eine quelloffene Chrome-Erweiterung, die Ihre X-Lesezeichen ohne
die X-API erfasst. Die Daten bleiben im aktuellen Chrome-Profil und können als
TXT, Markdown oder JSON-Sicherung exportiert werden.

## Installieren oder aktualisieren

1. [Laden Sie die fertige ZIP-Datei herunter](https://github.com/LucasDitchun/export-bookmarks-x-twitter/releases/latest/download/bookmark-x.zip)
   und entpacken Sie sie in einen dauerhaften Ordner.
2. Öffnen Sie `chrome://extensions`, aktivieren Sie den **Entwicklermodus** und
   wählen Sie **Entpackte Erweiterung laden**.
3. Wählen Sie den Ordner mit der Datei `manifest.json`.
4. Ersetzen Sie für ein Update die Dateien durch die neue Version und klicken
   Sie auf **Neu laden**. Ihre lokalen Daten bleiben erhalten.

Google Chrome 116 oder neuer ist erforderlich.

## Lesezeichen erfassen

Öffnen Sie `https://x.com/i/bookmarks`, warten Sie auf die Liste und öffnen Sie
die Erweiterung. **Neueste** sucht nur nach neuen Einträgen und stoppt nach der
konfigurierten Anzahl aufeinanderfolgender bereits bekannter Lesezeichen.
**Alle** prüft die gesamte Liste und gleicht Löschungen von anderen Geräten ab.
Die erste Erfassung ist immer vollständig. Lassen Sie den X-Tab geöffnet.

## Notizen, Tags und Ordner

Nach dem Speichern eines Beitrags kann Bookmark X einen Dialog für eine private
Notiz, Tags und einen Ordner öffnen. Diese Angaben bleiben in Ihrem Browser. In
der Bibliothek können Sie suchen, Notizen bearbeiten und Beiträge organisieren.
Ordner unterstützen Unterordner; Tags verbinden Einträge aus verschiedenen
Ordnern.

## Export und Sicherung

Exportieren Sie die Bibliothek als TXT oder Markdown und filtern Sie nach
Ordnern, Unterordnern, Tags oder archivierten Beiträgen. Die Felder wählen Sie
unter **Einstellungen → Export**.

**Sicherung und Wiederherstellung** lädt eine vollständige JSON-Datei herunter.
**Zusammenführen** behält lokale Daten; **Ersetzen** verwendet nur die Sicherung.
Bewahren Sie die Datei sicher auf, da sie private Notizen enthalten kann.

## Suche und Datenschutz

Die Textsuche arbeitet lokal. Die semantische Suche ist optional: Das Modell
wird nur mit Ihrer Zustimmung geladen, Index und Suchanfragen bleiben auf dem
Gerät. Es gibt keinen Server, keine Werbung, Analytics oder Telemetrie.

## Fehlerbehebung

- **Seite nicht bereit:** Der aktive Tab muss `x.com/i/bookmarks` sein.
- **Erfassung scheint zu stehen:** X lädt möglicherweise noch; warten Sie auf
  die Anzeige.
- **Erweiterung nicht aktualisiert:** Öffnen Sie `chrome://extensions` und
  klicken Sie auf **Neu laden**.
- **Vor Löschen oder Neuinstallation:** Erstellen Sie eine JSON-Sicherung.

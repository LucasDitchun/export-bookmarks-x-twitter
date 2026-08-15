# Guida utente di Bookmark X

[English](../../../README.md) · **Italiano** · [Altre lingue](../README.md)

Bookmark X è un’estensione open source per Chrome che acquisisce i segnalibri di
X senza utilizzare l’API di X. I dati restano nel profilo Chrome corrente e
possono essere esportati in TXT, Markdown o backup JSON.

## Installare o aggiornare

1. [Scarica lo ZIP pronto](https://github.com/LucasDitchun/export-bookmarks-x-twitter/releases/latest/download/bookmark-x.zip) ed estrailo in
   una cartella permanente.
2. Apri `chrome://extensions`, attiva la **Modalità sviluppatore** e scegli
   **Carica estensione non pacchettizzata**.
3. Seleziona la cartella che contiene `manifest.json`.
4. Per aggiornare, sostituisci i file con la nuova versione e premi **Ricarica**.
   I dati locali vengono conservati.

È richiesto Google Chrome 116 o successivo.

## Acquisire i segnalibri

Apri `https://x.com/i/bookmarks`, attendi la lista e apri l’estensione.
**Recenti** cerca solo i nuovi elementi e si ferma dopo il numero configurato di
segnalibri consecutivi già noti. **Tutti** esamina l’intera lista e riconcilia le
rimozioni effettuate su altri dispositivi. La prima acquisizione è sempre
completa. Mantieni aperta la scheda di X.

## Note, tag e cartelle

Dopo il salvataggio di un post, Bookmark X può aprire una finestra per aggiungere
una nota privata, tag e una cartella. Queste informazioni restano nel browser.
Nella Libreria puoi cercare, modificare note e organizzare i post. Le cartelle
supportano sottocartelle; i tag collegano elementi di cartelle diverse.

## Esportare e creare backup

Esporta la Libreria in TXT o Markdown e filtra per cartella, sottocartelle, tag o
post archiviati. Scegli i campi in **Impostazioni → Esporta**.

**Backup e ripristino** scarica un JSON completo. **Unisci** conserva i dati
locali; **Sostituisci** usa solo il backup. Conserva il file in modo sicuro:
potrebbe contenere note private.

## Ricerca e privacy

La ricerca testuale è locale. La ricerca semantica è facoltativa: il modello
viene scaricato solo con il tuo consenso, mentre indice e query restano sul
dispositivo. Non esistono server, pubblicità, analytics o telemetria.

## Risoluzione dei problemi

- **Pagina non pronta:** verifica che la scheda attiva sia `x.com/i/bookmarks`.
- **Acquisizione apparentemente ferma:** X potrebbe caricare; attendi l’indicatore.
- **Estensione non aggiornata:** apri `chrome://extensions` e premi **Ricarica**.
- **Prima di cancellare o reinstallare:** crea un backup JSON.

# Guide utilisateur de Bookmark X

[English](../../../README.md) · **Français** · [Autres langues](../README.md)

Bookmark X est une extension Chrome open source qui capture vos signets X sans
utiliser l’API de X. Les données restent dans le profil Chrome actuel et peuvent
être exportées en TXT, Markdown ou sauvegarde JSON.

## Installer ou mettre à jour

1. [Téléchargez le ZIP prêt à l’emploi](../../../download/bookmark-x.zip?raw=1)
   et extrayez-le dans un dossier permanent.
2. Ouvrez `chrome://extensions`, activez le **Mode développeur**, puis choisissez
   **Charger l’extension non empaquetée**.
3. Sélectionnez le dossier contenant `manifest.json`.
4. Pour mettre à jour, remplacez les fichiers par la nouvelle version et cliquez
   sur **Actualiser**. Vos données locales sont conservées.

Google Chrome 116 ou une version ultérieure est nécessaire.

## Capturer les signets

Ouvrez `https://x.com/i/bookmarks`, attendez la liste, puis ouvrez l’extension.
**Récents** recherche uniquement les nouveaux éléments et s’arrête après le
nombre configuré de signets déjà connus consécutifs. **Tous** examine toute la
liste et réconcilie les suppressions effectuées sur un autre appareil. La
première capture est toujours complète. Gardez l’onglet X ouvert.

## Notes, étiquettes et dossiers

Après l’enregistrement d’une publication, Bookmark X peut ouvrir une boîte de
dialogue pour ajouter une note privée, des étiquettes et un dossier. Ces données
restent dans votre navigateur. La Bibliothèque permet de rechercher, modifier
les notes et organiser les publications. Les dossiers acceptent des
sous-dossiers ; les étiquettes relient des éléments de dossiers différents.

## Exporter et sauvegarder

Exportez la Bibliothèque en TXT ou Markdown et filtrez par dossier,
sous-dossiers, étiquettes ou publications archivées. Choisissez les champs dans
**Paramètres → Exporter**.

**Sauvegarde et restauration** télécharge un JSON complet. **Fusionner** conserve
les données locales ; **Remplacer** utilise uniquement la sauvegarde. Conservez
ce fichier en lieu sûr, car il peut contenir des notes privées.

## Recherche et confidentialité

La recherche textuelle est locale. La recherche sémantique est facultative : le
modèle n’est téléchargé qu’après votre consentement, et l’index ainsi que les
requêtes restent sur l’appareil. Aucun serveur, publicité, analytics ou
télémétrie n’est utilisé.

## Dépannage

- **Page non prête :** vérifiez que l’onglet actif est `x.com/i/bookmarks`.
- **Capture apparemment bloquée :** X peut encore charger ; attendez l’indicateur.
- **Extension non actualisée :** ouvrez `chrome://extensions` et cliquez sur
  **Actualiser**.
- **Avant d’effacer ou réinstaller :** créez une sauvegarde JSON.

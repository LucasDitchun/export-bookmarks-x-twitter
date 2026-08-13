# Guía de usuario de Bookmark X

[English](../../../README.md) · **Español** · [Otros idiomas](../README.md)

Bookmark X es una extensión open source para Chrome que captura tus marcadores
de X sin utilizar la API de X. Los datos permanecen en el perfil actual de
Chrome y se pueden exportar como TXT, Markdown o copia de seguridad JSON.

## Instalar o actualizar

1. [Descarga el ZIP preparado](../../../download/bookmark-x.zip?raw=1) y
   extráelo en una carpeta permanente.
2. Abre `chrome://extensions`, activa el **Modo de desarrollador** y selecciona
   **Cargar descomprimida**.
3. Elige la carpeta que contiene `manifest.json`.
4. Para actualizar, sustituye los archivos por la nueva versión y pulsa
   **Recargar**. Tus datos locales se conservan.

Se requiere Google Chrome 116 o posterior.

## Capturar marcadores

Abre `https://x.com/i/bookmarks`, espera a que aparezca la lista y abre la
extensión. **Recientes** busca solo elementos nuevos y se detiene después del
número configurado de marcadores ya conocidos consecutivos. **Todos** revisa la
lista completa y reconcilia elementos eliminados desde otro dispositivo. La
primera captura siempre es completa. Mantén abierta la pestaña de X.

## Notas, etiquetas y carpetas

Al guardar una publicación, Bookmark X puede abrir un diálogo para añadir una
nota privada, etiquetas y una carpeta. Esa información solo existe en tu
navegador. En la Biblioteca puedes buscar, editar notas y organizar
publicaciones. Las carpetas admiten subcarpetas y las etiquetas relacionan
elementos de carpetas diferentes.

## Exportar y crear copias de seguridad

Exporta la Biblioteca en TXT o Markdown y filtra por carpeta, subcarpetas,
etiquetas o publicaciones archivadas. En **Ajustes → Exportar** elige los campos.

**Copia de seguridad y restauración** descarga un JSON completo. Usa **Combinar**
para conservar datos locales o **Reemplazar** para usar únicamente la copia.
Guarda el archivo de forma segura porque puede contener notas privadas.

## Búsqueda y privacidad

La búsqueda textual funciona localmente. La búsqueda semántica es opcional: el
modelo solo se descarga con tu consentimiento, y el índice y las consultas
permanecen en el dispositivo. No hay servidor, anuncios, analytics ni telemetría.

## Solucionar problemas

- **Página no preparada:** verifica que la pestaña activa sea `x.com/i/bookmarks`.
- **La captura parece detenida:** X puede estar cargando; espera al indicador.
- **La extensión no se actualizó:** abre `chrome://extensions` y pulsa
  **Recargar**.
- **Antes de borrar datos o reinstalar:** crea una copia JSON.

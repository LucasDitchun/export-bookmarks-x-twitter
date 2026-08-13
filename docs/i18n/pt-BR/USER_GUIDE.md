# Guia do usuário do Bookmark X

[English](../../../README.md) · **Português** · [Outros idiomas](../README.md)

O Bookmark X é uma extensão open source do Chrome que captura seus bookmarks do
X sem usar a API do X. Os dados ficam no perfil atual do Chrome e podem ser
exportados em TXT, Markdown ou backup JSON.

## Instalar ou atualizar

1. [Baixe o ZIP pronto](../../../download/bookmark-x.zip?raw=1) e extraia-o para
   uma pasta permanente.
2. Abra `chrome://extensions`, ative o **Modo do desenvolvedor** e escolha
   **Carregar sem compactação**.
3. Selecione a pasta extraída que contém `manifest.json`.
4. Para atualizar, substitua os arquivos da pasta pela nova versão e clique em
   **Recarregar** no cartão da extensão. Seus dados locais são preservados.

Requer Google Chrome 116 ou mais recente.

## Capturar bookmarks

Abra `https://x.com/i/bookmarks`, espere a lista aparecer e abra a extensão.
Use **Recentes** para procurar apenas novas adições: a captura para após a
quantidade configurada de bookmarks já conhecidos em sequência. Use **Todos**
para revisar a lista completa e reconciliar itens removidos em outro dispositivo.
A primeira captura sempre é completa. Mantenha a aba do X aberta durante o
processo.

## Notas, tags e pastas

Ao salvar um post no X, o Bookmark X pode abrir um modal para adicionar uma nota
privada, tags e uma pasta. Essas informações existem somente no seu navegador.
Na Biblioteca você pode pesquisar, editar notas e organizar posts. Pastas podem
ter subpastas; tags permitem relacionar posts de pastas diferentes.

## Exportar e fazer backup

Na Biblioteca, exporte em TXT ou Markdown. Você pode filtrar por pasta e
subpastas, por uma ou mais tags e por posts arquivados. Em **Ajustes → Exportar**,
escolha os campos incluídos.

Use **Backup e restauração** para baixar um JSON completo. Antes de restaurar,
escolha **Mesclar** para conservar dados locais ou **Substituir** para usar o
backup como fonte. Guarde o arquivo em local seguro: ele pode conter notas
privadas.

## Buscar e privacidade

A busca textual é local e funciona sem internet. A busca semântica é opcional:
ela só baixa o modelo após seu consentimento e mantém índice e consultas no
dispositivo. A extensão não possui servidor, anúncios, analytics ou telemetria.

## Resolver problemas

- **Página não está pronta:** confirme que a aba ativa é `x.com/i/bookmarks`.
- **A captura parece parada:** o X pode estar carregando; aguarde o indicador.
- **A extensão não atualizou:** abra `chrome://extensions` e clique em
  **Recarregar**.
- **Antes de limpar dados ou reinstalar:** crie um backup JSON.

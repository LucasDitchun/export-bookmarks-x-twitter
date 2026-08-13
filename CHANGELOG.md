# Changelog

All notable changes to Bookmark X are documented in this file.

## [0.1.2] - 2026-08-13

### Fixes

- localize automatic bookmark modal (#49) (`e0a98dd`)
- retry failed locale catalog loads (#50) (`dd3de48`)
- localize organization usage counts (#51) (`d87e87e`)
- make organization deletion recoverable (#52) (`3a23f15`)
- save bookmark metadata atomically (#53) (`4d053ef`)
- refresh injected locale without reload (#54) (`a1de096`)
- preserve metadata delimiter characters (#56) (`f7e0ff4`)
- await pending metadata context (#58) (`1cba5cf`)
- integrate metadata contracts (#59) (`fc8b6e6`)
- detach metadata refresh callbacks (#62) (`4b807aa`)
- retry queued locale refreshes (#66) (`023433c`)
- preserve deleted folder subtrees on restore (#68) (`81de2ae`)
- preserve metadata entity identities (#69) (`a06307c`)
- retry failed metadata refresh queries (#71) (`df25344`)
- preserve concurrent decoration refreshes (#70) (`47ad43d`)
- preserve committed settings refresh (#72) (`921bfb7`)
- serialize destructive library operations (#73) (`c41013c`)
- preserve folder base identity (#75) (`cdc4a55`)
- preserve live decoration locale (#76) (`20ee349`)
- preserve hidden organization links (#77) (`f171a1f`)
- retry transient metadata tab queries (#78) (`7da6948`)
- preserve tombstoned bookmark tag links (#80) (`e530cc0`)
- scope locale overrides to stale lookups (#81) (`71f21b7`)
- preserve targeted decoration context (#84) (`e83bdd4`)
- serialize backup exports after restores (#85) (`61eb152`)
- wait for active backup snapshots (#86) (`3f689a7`)
- restore live metadata refresh (#87) (`7ff6e63`)

### Performance

- index bookmarks by tag (#57) (`bfdf3d1`)
- serialize conflicting background requests (#63) (`bd98237`)
- cache injected decoration context (#61) (`8d703e0`)
- coalesce metadata refresh broadcasts (#67) (`50f86eb`)

### Maintenance

- keep contribution validation local (#46) (`d7077ec`)
- correct quick update behavior (#48) (`418c057`)
- add localized user guides (#47) (`ab9fd00`)
- type injected metadata translations (#55) (`decf99b`)
- split popup app responsibilities (#60) (`e0bdd82`)
- narrow bookmark UI read models (#64) (`e275276`)
- split background controller responsibilities (#65) (`3881c91`)
- format integrated fixes (#74) (`7397efa`)
- format metadata decorator (#79) (`39d3424`)
- format locale epoch fix (#82) (`480799b`)
- stabilize live bookmark observer (#83) (`b22772d`)

## [0.1.1] - 2026-08-09

### Features

- add bookmark notes and library storage (#3) (`95d7eaf`)
- add bookmark tags (#4) (`777e889`)
- add hierarchical bookmark folders (#5) (`aacc16e`)
- add bookmark library views (#7) (`4c0fb90`)
- add shared library surfaces and settings (#8) (`26abe20`)
- add JSON backup and restore (#9) (`a2e5595`)
- add instant local bookmark search (#11) (`151e322`)
- add GitHub project support (#12) (`4857910`)
- sync X bookmark actions live (#10) (`5a08bcf`)
- capture stable bookmark media (#13) (`d856318`)
- add reliable full bookmark review (#14) (`1ae9391`)
- add optional local semantic search (#15) (`a0b25d2`)
- inject local metadata into X posts (#16) (`d810e07`)
- add incremental bookmark updates (#17) (`bb786cd`)
- add configurable TXT and Markdown exports (#18) (`1235cbd`)

### Fixes

- format prepared release lockfile (`0beb547`)
- stabilize Chrome extension navigation (#22) (`0d813ff`)
- require Chromium for extension smoke (#23) (`c2e50de`)
- ignore squashed release preparation commits (#25) (`09a9790`)
- allow same-version release preparation (#27) (`18c8980`)
- preserve live bookmark metadata state (#28) (`c5d803e`)
- clear semantic data with archive (#30) (`0a75693`)
- keep bookmark search results consistent (#32) (`5c05092`)

### Performance

- streamline CI and release validation (#21) (`74c247a`)

### Maintenance

- add batched release train (`9febbb1`)
- harden release candidate (`7f9585d`)

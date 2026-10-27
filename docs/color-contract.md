# Token preview contract

Pure core module: src/tokens.js, CommonJS, no VS Code or filesystem dependency.

Exports:
- parseFile(text): parsed module (implementation internal AST), immutable to consumers.
- createTokenIndex(files, directories): index. files is array {path, text}; paths are POSIX workspace-relative strings. directories defaults ["design/tokens", "elyx/tokens"]. Includes token files and current document, plus loaded imports.
- index.resolve(documentPath, reference): {value, color?, definition?} or undefined. value is a readable resolved Elyx value string; color is {red,green,blue,alpha} normalized 0..1. definition is {path,start,end} source offsets if available.
- index.scan(documentPath): array {start,end,reference,value,color?,definition?}. Only actual expression references, hex literals, supported colour atoms or colour functions. Never strings/comments/keys/declaration names/import paths/sources/annotation names. Non-colour references included for hovers. Include the entire resolvable colour call as a single occurrence rather than its nested references (avoid overlapping swatches). References with an alias imported explicitly must resolve that import before any directory fallback. start/end are UTF-16 offsets, end exclusive.

Resolution: file-local/root :: references, qualified import aliases, workspace-root and importer-relative import paths, configured directory fallback by file stem (when no explicit alias), group inheritance tokens : module.group, property references and aliases. Do not guess ambiguous file stems, missing symbols, cycles, unsupported function semantics. Values include numeric lengths and strings for hovers. Handle nested map/list values where feasible and hyphenated names. Current support should resolve all actual colours in design/tokens/colors.elyx, including opacity() and .white/.black/.transparent. Literal hex lengths exactly3/4/6/8. No execution/eval or arbitrary reads.

The adapter owns filesystem discovery, caching, dirty text snapshots and update events. File content passed in files can include unsaved documents. The core resolves synchronously from its immutable snapshot. Directory fallback must be confined to configured folders, but explicit imports can resolve to any file already provided in the same workspace. Metadata/variant context execution is out of scope and documented.

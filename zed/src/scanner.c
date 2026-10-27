#include "tree_sitter/parser.h"
#include <wctype.h>
#include <string.h>

enum TokenType { HEX_COLOR, ADD_OPERATOR, MULTIPLY_OPERATOR, IDENTIFIER, RESERVED_KEYWORD, ROOT_IDENTIFIER, RAW_ROOT_IDENTIFIER, FILE_KEYWORD, EXPORT_KEYWORD, UNIT };

static bool symbol_start(int32_t c) {
  return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c == '_' || c == '-';
}
static bool symbol_body(int32_t c) { return symbol_start(c) || (c >= '0' && c <= '9'); }
static bool reserved_word(const char *word) {
  static const char *words[] = {
    "import", "use", "export", "priv", "as", "frame", "text", "boolean", "shape", "asset", "tokens", "icon",
    "board", "component", "group", "__board__", "__document__", "__file__", "__canvas__", "let", "const", "fn", "this", "self", "children", "where", "type", "trait", "super", "struct", "static", "ref", "mod", "loop", "in", "data", "async", "await", "if", "when", "then", "else", "match", "case", "not", "and", "or", "try", "catch", "rescue", "finally", "throw", "return"
  };
  for (unsigned i = 0; i < sizeof(words) / sizeof(words[0]); ++i) if (strcmp(word, words[i]) == 0) return true;
  return false;
}

void *tree_sitter_elyx_external_scanner_create(void) { return NULL; }
void tree_sitter_elyx_external_scanner_destroy(void *payload) { (void)payload; }
unsigned tree_sitter_elyx_external_scanner_serialize(void *payload, char *buffer) {
  (void)payload; (void)buffer; return 0;
}
void tree_sitter_elyx_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {
  (void)payload; (void)buffer; (void)length;
}

bool tree_sitter_elyx_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
  (void)payload;
  bool whitespace = false;
  bool recovery = valid_symbols[HEX_COLOR] && valid_symbols[ADD_OPERATOR] && valid_symbols[MULTIPLY_OPERATOR] && valid_symbols[ROOT_IDENTIFIER] && valid_symbols[RAW_ROOT_IDENTIFIER] && valid_symbols[UNIT];
  while (iswspace(lexer->lookahead)) {
    whitespace = true;
    lexer->advance(lexer, true);
  }
  if (!recovery && !whitespace && valid_symbols[UNIT] && (symbol_start(lexer->lookahead) || lexer->lookahead == '%')) {
    if (lexer->lookahead == '%') lexer->advance(lexer, false);
    else do { lexer->advance(lexer, false); } while (symbol_body(lexer->lookahead));
    lexer->mark_end(lexer);
    lexer->result_symbol = UNIT;
    return true;
  }
  if (whitespace && valid_symbols[ADD_OPERATOR] && lexer->lookahead == '-') {
    lexer->advance(lexer, false);
    lexer->mark_end(lexer);
    lexer->result_symbol = ADD_OPERATOR;
    return true;
  }
  if ((valid_symbols[IDENTIFIER] || valid_symbols[RESERVED_KEYWORD] || valid_symbols[ROOT_IDENTIFIER] || valid_symbols[RAW_ROOT_IDENTIFIER]) && symbol_start(lexer->lookahead)) {
    if (whitespace && !valid_symbols[IDENTIFIER] && !valid_symbols[RESERVED_KEYWORD]) return false;
    char word[32];
    unsigned length = 0;
    bool leading_minus = lexer->lookahead == '-';
    do {
      if (length < sizeof(word) - 1) word[length] = (char)lexer->lookahead;
      ++length;
      lexer->advance(lexer, false);
      if (leading_minus && length == 1 && lexer->lookahead >= '0' && lexer->lookahead <= '9') return false;
    } while (symbol_body(lexer->lookahead));
    word[length < sizeof(word) ? length : sizeof(word) - 1] = '\0';
    bool reserved = length < sizeof(word) && reserved_word(word);
    if (recovery && reserved) lexer->result_symbol = RESERVED_KEYWORD;
    else if (strcmp(word, "file") == 0 && valid_symbols[FILE_KEYWORD]) lexer->result_symbol = FILE_KEYWORD;
    else if (strcmp(word, "export") == 0 && valid_symbols[EXPORT_KEYWORD]) lexer->result_symbol = EXPORT_KEYWORD;
    else if (!whitespace && valid_symbols[RAW_ROOT_IDENTIFIER]) lexer->result_symbol = RAW_ROOT_IDENTIFIER;
    else if (!whitespace && !reserved && valid_symbols[ROOT_IDENTIFIER]) lexer->result_symbol = ROOT_IDENTIFIER;
    else if (reserved && valid_symbols[RESERVED_KEYWORD]) lexer->result_symbol = RESERVED_KEYWORD;
    else if (!reserved && valid_symbols[IDENTIFIER]) lexer->result_symbol = IDENTIFIER;
    else return false;
    lexer->mark_end(lexer);
    return true;
  }
  if (valid_symbols[HEX_COLOR] && lexer->lookahead == '#') {
    lexer->advance(lexer, false);
    unsigned digits = 0;
    bool valid = true;
    while ((lexer->lookahead >= '0' && lexer->lookahead <= '9') ||
           (lexer->lookahead >= 'A' && lexer->lookahead <= 'Z') ||
           (lexer->lookahead >= 'a' && lexer->lookahead <= 'z') ||
           lexer->lookahead == '_' || lexer->lookahead == '-') {
      valid = valid && iswxdigit(lexer->lookahead);
      ++digits;
      lexer->advance(lexer, false);
    }
    if (!valid || !(digits == 3 || digits == 4 || digits == 6 || digits == 8)) return false;
    lexer->mark_end(lexer);
    lexer->result_symbol = HEX_COLOR;
    return true;
  }
  // The ABNF requires whitespace before binary arithmetic operators.
  if (!whitespace) return false;
  if (valid_symbols[ADD_OPERATOR] && (lexer->lookahead == '+' || lexer->lookahead == '-')) {
    lexer->advance(lexer, false);
    lexer->mark_end(lexer);
    lexer->result_symbol = ADD_OPERATOR;
    return true;
  }
  if (valid_symbols[MULTIPLY_OPERATOR] && (lexer->lookahead == '*' || lexer->lookahead == '/')) {
    int32_t operator = lexer->lookahead;
    lexer->advance(lexer, false);
    if (operator == '/' && lexer->lookahead == '/') return false;
    lexer->mark_end(lexer);
    lexer->result_symbol = MULTIPLY_OPERATOR;
    return true;
  }
  return false;
}

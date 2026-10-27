// Derived from the Elyx ABNF (`elyx man abnf`). See ../docs/LANGUAGE.md.
const commaSep = rule => optional(seq(rule, repeat(seq(',', rule))));
const entries = rule => repeat(seq(rule, optional(',')));
module.exports = grammar({
  name: 'elyx',
  extras: $ => [/\s/, $.comment],
  externals: $ => [$.hex_color, $.add_operator, $.multiply_operator, $.identifier, $.reserved_keyword, $._root_identifier, $._raw_root_identifier, $.file_keyword, $.export_keyword, $.unit],
  conflicts: $ => [[$.symbol_path, $.raw_symbol_path]],
  rules: {
    source_file: $ => repeat(choice($.import_declaration, $.use_declaration, $.file_metadata, $.declaration)),
    import_declaration: $ => seq('import', $.string, 'as', field('alias', $.identifier)),
    use_declaration: $ => seq('use', $.string),
    file_metadata: $ => seq(repeat($.annotation), $.file_keyword, $.property_block),
    declaration: $ => seq(repeat($.annotation), optional($.access_modifier), field('name', choice($.identifier, alias($.file_keyword, $.identifier))), '=', field('body', $.typed_block)),
    access_modifier: $ => $.export_keyword,
    typed_block: $ => choice(
      seq(field('kind', $.frame_kind), $.frame_definition_block),
      seq(field('kind', $.frame_kind), ':', field('source', $.symbol_path), $.frame_instance_block),
      seq(field('kind', $.token_kind), optional(seq(':', field('source', $.symbol_path))), $.property_block),
      seq(field('kind', $.layer_kind), $.property_block),
      seq(field('kind', $.layer_kind), ':', field('source', $.symbol_path), $.instance_block)
    ),
    frame_kind: $ => choice('frame', 'boolean'),
    token_kind: $ => 'tokens',
    layer_kind: $ => choice('text', 'shape', 'asset', 'icon'),
    property_block: $ => seq('{', entries($.property), '}'),
    frame_definition_block: $ => seq('{', entries(choice($.declaration, $.property)), '}'),
    frame_instance_block: $ => seq('{', entries(choice($.declaration, $.frame_override, $.property)), '}'),
    instance_block: $ => seq('{', entries(choice($.override, $.property)), '}'),
    frame_override: $ => seq(repeat($.annotation), field('name', $.property_path), $.frame_instance_block),
    override: $ => seq(repeat($.annotation), field('name', $.property_path), $.instance_block),
    property: $ => seq(field('key', $.property_path), ':', field('value', $._expression)),
    property_path: $ => seq(choice($.identifier, $.reserved_keyword, alias($.file_keyword, $.identifier), alias($.export_keyword, $.reserved_keyword), seq('::', alias($._raw_root_identifier, $.identifier))), repeat(choice(seq(token.immediate('.'), alias(token.immediate(/[A-Za-z_-][A-Za-z0-9_-]*/), $.identifier)), seq(token.immediate('['), $.index, token.immediate(']'))))),
    index: $ => /[0-9]+/,
    symbol_path: $ => seq(choice($.identifier, seq('::', alias($._root_identifier, $.identifier))), repeat(seq(token.immediate('.'), alias(token.immediate(/[A-Za-z_-][A-Za-z0-9_-]*/), $.identifier)))),
    raw_symbol_path: $ => seq(choice($.identifier, $.reserved_keyword, seq('::', alias($._raw_root_identifier, $.identifier))), repeat(seq(token.immediate('.'), alias(token.immediate(/[A-Za-z_-][A-Za-z0-9_-]*/), $.identifier)))),
    annotation: $ => seq('@', field('name', $.identifier), optional(seq('(', commaSep(choice($.annotation_argument, $.string, $.raw_symbol_path)), ')'))),
    annotation_argument: $ => seq(field('name', choice($.identifier, $.reserved_keyword)), '=', choice($.string, $.raw_symbol_path)),
    _expression: $ => choice($.quote_expression, $.binary_expression, $.group_expression, $.call_expression, $._value),
    quote_expression: $ => prec.right(3, seq("'", $._expression)),
    group_expression: $ => seq('(', $._expression, ')'),
    binary_expression: $ => choice(
      prec.left(1, seq($._expression, field('operator', $.add_operator), $._expression)),
      prec.left(2, seq($._expression, field('operator', $.multiply_operator), $._expression))
    ),
    call_expression: $ => seq(field('function', $.identifier), token.immediate('('), commaSep(choice($.named_argument, $._expression)), ')'),
    named_argument: $ => seq(field('name', $.identifier), '=', $._expression),
    _value: $ => choice($.string, $.length, $.number, $.hex_color, $.atom, $.symbol_path, $.list, $.map),
    list: $ => seq('[', commaSep($._expression), ']'),
    map: $ => seq('{', commaSep($.map_entry), '}'),
    map_entry: $ => seq(field('key', choice($._expression, $.raw_symbol_path)), ':', field('value', $._expression)),
    atom: $ => seq('.', alias(token.immediate(/[A-Za-z_-][A-Za-z0-9_-]*/), $.identifier)),
    length: $ => seq($.number, $.unit),
    number: $ => /[+-]?[0-9]+(\.[0-9]+)?/,
    string: $ => seq('"', repeat(choice($.escape_sequence, $.string_content)), '"'),
    escape_sequence: $ => token.immediate(/\\[nrt"\\]/),
    string_content: $ => token.immediate(prec(1, /[^"\\\r\n]+/)),
    comment: $ => token(seq('//', /[^\r\n]*/))
  }
});

(comment) @comment
(string) @string
(escape_sequence) @string.escape
(number) @number
(unit) @type.builtin
(hex_color) @constant
(identifier) @variable
(atom) @constant.builtin
(atom (identifier) @constant.builtin)
[(frame_kind) (token_kind) (layer_kind)] @type.builtin
(typed_block source: (symbol_path) @type)
(typed_block source: (symbol_path (identifier) @type))
(declaration name: (identifier) @type)
(property key: (property_path) @property)
(property key: (property_path (identifier) @property))
(property key: (property_path (reserved_keyword) @property))
(map_entry key: (symbol_path) @property)
(map_entry key: (raw_symbol_path) @property)
(map_entry key: (symbol_path (identifier) @property))
(map_entry key: (raw_symbol_path (identifier) @property))
(map_entry key: (raw_symbol_path (reserved_keyword) @property))
(ERROR (reserved_keyword) @keyword)
(call_expression function: (identifier) @function)
(named_argument name: (identifier) @variable.parameter)
(annotation name: (identifier) @attribute)
(annotation_argument name: (identifier) @variable.parameter)
(annotation_argument name: (reserved_keyword) @variable.parameter)
(raw_symbol_path (reserved_keyword) @variable)
(override name: (property_path) @tag)
(frame_override name: (property_path) @tag)
(override name: (property_path (identifier) @tag))
(frame_override name: (property_path (identifier) @tag))
(override name: (property_path (reserved_keyword) @tag))
(frame_override name: (property_path (reserved_keyword) @tag))
(index) @number
["import" "use" "as"] @keyword
(access_modifier) @keyword
(file_metadata (file_keyword) @variable.special)
[(add_operator) (multiply_operator) "'"] @operator
["(" ")" "[" "]" "{" "}"] @punctuation.bracket
[":" "=" "," "."] @punctuation.delimiter
["::" "@"] @punctuation.special

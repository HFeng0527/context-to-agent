package com.contexttoagent.jetbrains

internal object Json {
    fun parse(text: String): Any? = Parser(text).parse()

    fun stringify(value: Any?): String = Writer(false).write(value)

    fun stringifyPretty(value: Any?): String = Writer(true).write(value)

    @Suppress("UNCHECKED_CAST")
    fun asObject(value: Any?): MutableMap<String, Any?>? = value as? MutableMap<String, Any?>

    @Suppress("UNCHECKED_CAST")
    fun asArray(value: Any?): MutableList<Any?>? = value as? MutableList<Any?>

    private class Parser(private val text: String) {
        private var index = 0

        fun parse(): Any? {
            skipWhitespace()
            val value = parseValue()
            skipWhitespace()
            if (index != text.length) error("Unexpected character at $index")
            return value
        }

        private fun parseValue(): Any? {
            skipWhitespace()
            if (index >= text.length) error("Unexpected end of JSON")
            return when (text[index]) {
                '{' -> parseObject()
                '[' -> parseArray()
                '"' -> parseString()
                't' -> expect("true", true)
                'f' -> expect("false", false)
                'n' -> expect("null", null)
                else -> parseNumber()
            }
        }

        private fun parseObject(): MutableMap<String, Any?> {
            expectChar('{')
            val result = linkedMapOf<String, Any?>()
            skipWhitespace()
            if (peek('}')) {
                index++
                return result
            }
            while (true) {
                skipWhitespace()
                val key = parseString()
                skipWhitespace()
                expectChar(':')
                result[key] = parseValue()
                skipWhitespace()
                if (peek('}')) {
                    index++
                    return result
                }
                expectChar(',')
            }
        }

        private fun parseArray(): MutableList<Any?> {
            expectChar('[')
            val result = mutableListOf<Any?>()
            skipWhitespace()
            if (peek(']')) {
                index++
                return result
            }
            while (true) {
                result.add(parseValue())
                skipWhitespace()
                if (peek(']')) {
                    index++
                    return result
                }
                expectChar(',')
            }
        }

        private fun parseString(): String {
            expectChar('"')
            val builder = StringBuilder()
            while (index < text.length) {
                val ch = text[index++]
                if (ch == '"') return builder.toString()
                if (ch != '\\') {
                    builder.append(ch)
                    continue
                }
                if (index >= text.length) error("Invalid escape at $index")
                when (val escaped = text[index++]) {
                    '"', '\\', '/' -> builder.append(escaped)
                    'b' -> builder.append('\b')
                    'f' -> builder.append('\u000c')
                    'n' -> builder.append('\n')
                    'r' -> builder.append('\r')
                    't' -> builder.append('\t')
                    'u' -> {
                        if (index + 4 > text.length) error("Invalid unicode escape at $index")
                        builder.append(text.substring(index, index + 4).toInt(16).toChar())
                        index += 4
                    }
                    else -> error("Invalid escape \\$escaped at $index")
                }
            }
            error("Unterminated string")
        }

        private fun parseNumber(): Number {
            val start = index
            if (peek('-')) index++
            while (index < text.length && text[index].isDigit()) index++
            if (peek('.')) {
                index++
                while (index < text.length && text[index].isDigit()) index++
            }
            if (index < text.length && (text[index] == 'e' || text[index] == 'E')) {
                index++
                if (index < text.length && (text[index] == '+' || text[index] == '-')) index++
                while (index < text.length && text[index].isDigit()) index++
            }
            if (start == index) error("Expected JSON value at $index")
            val raw = text.substring(start, index)
            return if (raw.contains('.') || raw.contains('e', true)) raw.toDouble() else raw.toLong()
        }

        private fun expect(literal: String, value: Any?): Any? {
            if (!text.startsWith(literal, index)) error("Expected $literal at $index")
            index += literal.length
            return value
        }

        private fun expectChar(ch: Char) {
            if (index >= text.length || text[index] != ch) error("Expected $ch at $index")
            index++
        }

        private fun peek(ch: Char): Boolean = index < text.length && text[index] == ch

        private fun skipWhitespace() {
            while (index < text.length && text[index].isWhitespace()) index++
        }
    }

    private class Writer(private val pretty: Boolean) {
        fun write(value: Any?): String = buildString { appendValue(value, 0) }

        private fun StringBuilder.appendValue(value: Any?, indent: Int) {
            when (value) {
                null -> append("null")
                is String -> appendString(value)
                is Boolean -> append(value)
                is Number -> append(value)
                is Map<*, *> -> appendObject(value, indent)
                is Iterable<*> -> appendArray(value, indent)
                is Array<*> -> appendArray(value.asList(), indent)
                else -> appendString(value.toString())
            }
        }

        private fun StringBuilder.appendObject(value: Map<*, *>, indent: Int) {
            append('{')
            if (value.isNotEmpty()) {
                var first = true
                for ((key, entryValue) in value) {
                    if (!first) append(',')
                    newline(indent + 1)
                    appendString(key.toString())
                    append(if (pretty) ": " else ":")
                    appendValue(entryValue, indent + 1)
                    first = false
                }
                newline(indent)
            }
            append('}')
        }

        private fun StringBuilder.appendArray(value: Iterable<*>, indent: Int) {
            val items = value.toList()
            append('[')
            if (items.isNotEmpty()) {
                items.forEachIndexed { i, item ->
                    if (i > 0) append(',')
                    newline(indent + 1)
                    appendValue(item, indent + 1)
                }
                newline(indent)
            }
            append(']')
        }

        private fun StringBuilder.newline(indent: Int) {
            if (!pretty) return
            append('\n')
            repeat(indent) { append("  ") }
        }

        private fun StringBuilder.appendString(value: String) {
            append('"')
            for (ch in value) {
                when (ch) {
                    '"' -> append("\\\"")
                    '\\' -> append("\\\\")
                    '\b' -> append("\\b")
                    '\u000c' -> append("\\f")
                    '\n' -> append("\\n")
                    '\r' -> append("\\r")
                    '\t' -> append("\\t")
                    else -> {
                        if (ch.code < 0x20) append("\\u%04x".format(ch.code)) else append(ch)
                    }
                }
            }
            append('"')
        }
    }
}

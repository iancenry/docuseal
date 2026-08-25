#!/usr/bin/env ruby
# frozen_string_literal: true

# Generates server/src/db/schema.ts (Drizzle) from db/schema.rb
# Usage: ruby scripts/generate_drizzle_schema.rb

SCHEMA_PATH = File.expand_path('../db/schema.rb', __dir__)
OUT_PATH = File.expand_path('../server/src/db/schema.ts', __dir__)

Table = Struct.new(:name, :columns, :indices, keyword_init: true)
Column = Struct.new(:name, :type, :opts, keyword_init: true)

def snake_to_camel_lower(str)
  parts = str.split('_')
  first = parts.shift
  reserved = %w[order group class type].include?(first) ? "$#{first}" : first
  [reserved, *parts.map(&:capitalize)].join
end

def singularize(word)
  w = word.dup
  w.sub!(/ies$/, 'y')
  w.sub!(/ses$/, 's')
  w.sub!(/xes$/, 'x')
  w.sub!(/ches$/, 'ch')
  w.sub!(/shes$/, 'sh')
  w.sub!(/ss$/, 'ss')
  w.sub!(/s$/, '') unless w =~ /ss$/
  w
end

def parse_scalar(str)
  case str
  when nil then nil
  when /^[0-9]+$/ then str.to_i
  when /^-?[0-9]+\.[0-9]+$/ then str.to_f
  when /\Atrue\z/ then true
  when /\Afalse\z/ then false
  when /^:(\w+)$/ then Regexp.last_match(1)
  else
    if str.start_with?('"') && str.end_with?('"') && str.length >= 2
      str[1..-2].gsub('\\"', '"')
    else
      str
    end
  end
end

def parse_opts(opt_str)
  opts = {}
  return opts if opt_str.nil? || opt_str.strip.empty?
  # split top-level commas (no nested hashes expected in this schema except none found)
  opt_str.scan(/(\w+):\s+(?:"((?:[^"\\]|\\.)*)"|(\[[^\]]*\])|([\w.]+))/).each do |key, dq, bracket, word|
    val =
      if dq
        parse_scalar(%("#{dq}"))
      elsif bracket
        bracket.scan(/"([^"]+)"/).flatten
      else
        parse_scalar(word)
      end
    opts[key.to_sym] = val
  end
  opts
end

tables = []
current = nil

File.foreach(SCHEMA_PATH) do |line|
  if (m = line.match(/create_table "([^"]+)"(.*) do \|t\|/))
    current = Table.new(name: m[1], columns: [], indices: [])
    tables << current
  elsif line.match?(/^\s*end\s*$/) && current
    current = nil
  elsif current && (m = line.match(/t\.index\s+\[([^\]]*)\](.*)/))
    cols = m[1].scan(/"([^"]+)"/).flatten
    current.indices << { columns: cols, opts: parse_opts(m[2]) }
  elsif current && (m = line.match(/t\.(\w+)\s+"([^"]+)"(?:,\s*(.+))?$/))
    type = m[1]
    next if %w[index].include?(type)
    current.columns << Column.new(name: m[2], type:, opts: parse_opts(m[3]))
  end
end

out = +"// AUTO-GENERATED from db/schema.rb by scripts/generate_drizzle_schema.rb — do not edit by hand.\n"
out << "// Rails mappings: string -> varchar({length}|255), datetime -> timestamp (no tz), array: true -> .array(),\n"
out << "// bigint pk -> serial (identity). FK constraints listed in the FK_TODO comment block at the bottom.\n\n"
out << "import {\n  pgTable,\n  text,\n  varchar,\n  integer,\n  bigint,\n  boolean,\n  timestamp,\n  date,\n  serial,\n  customType,\n  index,\n  uniqueIndex,\n} from 'drizzle-orm/pg-core';\n"
out << "import { sql } from 'drizzle-orm';\n\n"

out << <<~TS
  const tsvector = customType<{ data: string }>({
    dataType() {
      return 'tsvector';
    },
  });

TS

def emit_column(col)
  o = col.opts
  n = "\"#{col.name}\""
  base =
    case col.type
    when 'string'
      b = o[:limit] && o[:limit] != 255 ? "varchar(#{n}, { length: #{o[:limit]} })" : "varchar(#{n})"
      o[:array] ? "#{b}.array()" : b
    when 'text' then o[:array] ? "text(#{n}).array()" : "text(#{n})"
    when 'bigint' then "bigint(#{n}, { mode: 'number' })"
    when 'integer' then "integer(#{n})"
    when 'boolean' then "boolean(#{n})"
    when 'datetime' then "timestamp(#{n})"
    when 'date' then "date(#{n})"
    when 'float' then "doublePrecision(#{n})"
    when 'json', 'jsonb' then "jsonb(#{n})"
    when 'uuid' then "uuid(#{n})"
    when 'tsvector' then "tsvector(#{n})"
    else "text(#{n}) /* TODO unmapped rails type: #{col.type} */"
    end

  base += '.notNull()' if o[:null] == false

  dflt =
    case o[:default]
    when String then ".default(sql`'#{o[:default].gsub("'", "''")}'`)"
    when true, false, Integer, Float then ".default(#{o[:default]})"
    else ''
    end
  # Rails fills created_at/updated_at via ActiveRecord; replicate as DB defaults
  if dflt.empty? && %w[created_at updated_at].include?(col.name) && col.type == 'datetime'
    dflt = '.default(sql`now()`)'
  end

  "  #{snake_to_camel_lower(col.name)}: #{base}#{dflt},"
end

def emit_index(idx)
  o = idx[:opts]
  cols = idx[:columns].map { |c| snake_to_camel_lower(c) }
  builder = (o[:unique] ? 'uniqueIndex' : 'index')
  chain = +"#{builder}('#{o[:name]}')"
  if o[:using] == 'gin'
    chain << ".using('gin', #{cols.map { |c| "table.#{c}" }.join(', ')})"
  else
    chain << ".on(#{cols.map { |c| "table.#{c}" }.join(', ')})"
  end
  chain << '.where(sql`' + o[:where] + '`)' if o[:where]
  "  #{chain},"
end

tables.each do |t|
  var = snake_to_camel_lower(t.name)
  out << "export const #{var} = pgTable('#{t.name}', {\n"
  has_explicit_id = t.columns.any? { |c| c.name == 'id' }
  out << "  id: serial('id').primaryKey(),\n" unless has_explicit_id
  t.columns.each do |col|
    if col.name == 'id'
      out << "  id: serial('id').primaryKey(),\n"
      next
    end
    out << emit_column(col) << "\n"
  end
  out << '}, (table) => [' << "\n"
  out << t.indices.map { |i| emit_index(i) }.join("\n")
  out << "\n" unless t.indices.empty?
  out << "]);\n\n"
end

fks = File.readlines(SCHEMA_PATH).select { |l| l.include?('add_foreign_key') }
out << "/*\n * FK_TODO: re-add foreign keys via drizzle's references()/foreignKey() once table ordering is settled:\n"
fks.each { |l| out << ' * ' << l.strip << "\n" }
out << " */\n"

File.write(OUT_PATH, out)
puts "Wrote #{OUT_PATH}"
puts "Tables: #{tables.size}, indices: #{tables.sum { |t| t.indices.size }}, fks deferred: #{fks.size}"

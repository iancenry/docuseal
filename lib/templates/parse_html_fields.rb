# frozen_string_literal: true

module Templates
  module ParseHtmlFields
    FIELD_TAG_REGEXP = /\{\{([^}]+)\}\}/

    FIELD_TYPES = %w[
      text signature initials date image stamp
      checkbox radio select multiple
      phone cells payment file number
    ].freeze

    module_function

    def call(html)
      fields = []
      field_index = 0

      marked_html = html.gsub(FIELD_TAG_REGEXP) do
        tag_content = Regexp.last_match(1).strip
        parts = tag_content.split('|').map(&:strip)

        field_name = parts[0]
        field_type = resolve_type(parts[1])
        options = parse_options(field_type, parts[2])

        field = {
          name: field_name,
          type: field_type,
          options: options,
          index: field_index
        }

        fields << field
        field_index += 1

        build_marker_span(field)
      end

      clean_html = html.gsub(FIELD_TAG_REGEXP, '')

      { html: marked_html, clean_html: clean_html, fields: fields }
    end

    def resolve_type(raw_type)
      return 'text' if raw_type.blank?

      normalized = raw_type.downcase.strip
      FIELD_TYPES.include?(normalized) ? normalized : 'text'
    end

    def parse_options(field_type, raw_options)
      return nil unless %w[select radio multiple].include?(field_type)
      return nil if raw_options.blank?

      raw_options.split(',').map(&:strip).reject(&:blank?)
    end

    def build_marker_span(field)
      name_escaped = ERB::Util.html_escape(field[:name])
      type = field[:type]
      index = field[:index]

      style = case type
              when 'signature', 'initials', 'stamp', 'image'
                'display:inline-block;min-width:200px;min-height:50px;'
              when 'checkbox'
                'display:inline-block;min-width:18px;min-height:18px;'
              else
                'display:inline-block;min-width:120px;min-height:20px;'
              end

      %(<span data-docuseal-field="#{name_escaped}" data-field-type="#{type}" data-field-index="#{index}" style="#{style}">#{name_escaped}</span>)
    end
  end
end

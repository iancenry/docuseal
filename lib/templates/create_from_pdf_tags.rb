# frozen_string_literal: true

module Templates
  module CreateFromPdfTags
    FIELD_TAG_REGEXP = /\{\{([^}]+)\}\}/

    module_function

    def call(template, pdf_data, _params = {})
      pdf = HexaPDF::Document.new(io: StringIO.new(pdf_data))
      pages_info = pdf.pages.map { |p| { width: p.box.width, height: p.box.height } }

      tag_fields = extract_tags_with_positions(pdf_data, pages_info)

      return template if tag_fields.empty?

      cleaned_pdf_data = remove_tags_from_pdf(pdf_data, tag_fields)

      document = store_pdf_document(template, cleaned_pdf_data)
      Templates::ProcessDocument.call(document, cleaned_pdf_data)

      build_template_data(template, document, tag_fields)

      template.save!
      template
    end

    def extract_tags_with_positions(pdf_data, pages_info)
      doc = Pdfium::Document.open_bytes(pdf_data)
      fields = []

      doc.page_count.times do |page_index|
        page = doc.get_page(page_index)
        text_nodes = page.text_nodes
        page_info = pages_info[page_index]

        next if text_nodes.empty? || page_info.nil?

        full_text = text_nodes.map(&:content).join
        scan_tags_from_text_nodes(full_text, text_nodes, page_index, page_info, fields)
      ensure
        page&.close
      end

      fields
    ensure
      doc&.close
    end

    def scan_tags_from_text_nodes(full_text, text_nodes, page_index, _page_info, fields)
      char_offset = 0
      node_char_map = []

      text_nodes.each_with_index do |node, idx|
        node.content.each_char do
          node_char_map << idx
        end
      end

      full_text.scan(FIELD_TAG_REGEXP) do
        match = Regexp.last_match
        tag_content = match[1].strip
        match_start = match.begin(0)
        match_end = match.end(0) - 1

        parts = tag_content.split('|').map(&:strip)
        field_name = parts[0]
        field_type = resolve_type(parts[1])
        options = parse_options(field_type, parts[2])

        start_node_idx = node_char_map[match_start]
        end_node_idx = node_char_map[match_end]

        next unless start_node_idx && end_node_idx

        span_nodes = text_nodes[start_node_idx..end_node_idx]
        next if span_nodes.blank?

        x_min = span_nodes.map(&:x).min
        y_min = span_nodes.map(&:y).min
        x_max = span_nodes.map(&:endx).max
        y_max = span_nodes.map(&:endy).max

        fields << {
          name: field_name,
          type: field_type,
          options: options,
          page: page_index,
          x: x_min,
          y: y_min,
          w: x_max - x_min,
          h: y_max - y_min,
          tag_text: match[0]
        }
      end
    end

    def remove_tags_from_pdf(pdf_data, tag_fields)
      return pdf_data if tag_fields.empty?

      pdf = HexaPDF::Document.new(io: StringIO.new(pdf_data))

      tag_fields.group_by { |f| f[:page] }.each do |page_idx, fields|
        page = pdf.pages[page_idx]
        next unless page

        contents = page[:Contents]
        next unless contents

        stream_data = if contents.is_a?(Array)
                        contents.map { |ref| ref.stream || '' }.join(' ')
                      else
                        contents.stream || ''
                      end

        fields.each do |field|
          tag = field[:tag_text]
          stream_data = stream_data.gsub(tag, ' ' * tag.length)
        end

        if contents.is_a?(Array)
          contents.first.stream = stream_data
          contents[1..].each { |ref| ref.stream = '' }
        else
          contents.stream = stream_data
        end
      end

      io = StringIO.new
      pdf.write(io, validate: false)
      io.string
    rescue StandardError => e
      Rails.logger.warn("Failed to remove tags from PDF: #{e.message}")
      pdf_data
    end

    def store_pdf_document(template, pdf_data)
      sha256 = Base64.urlsafe_encode64(Digest::SHA256.digest(pdf_data))

      blob = ActiveStorage::Blob.create_and_upload!(
        io: StringIO.new(pdf_data),
        filename: "#{template.name.parameterize.presence || 'document'}.pdf",
        content_type: 'application/pdf',
        metadata: {
          identified: true,
          analyzed: true,
          pdf: {},
          sha256: sha256
        }
      )

      template.documents.create!(blob: blob)
    end

    def build_template_data(template, document, tag_fields)
      submitter_uuid = SecureRandom.uuid

      template.submitters = [{ 'name' => 'First Party', 'uuid' => submitter_uuid }]
      template.schema = [{ 'attachment_uuid' => document.uuid, 'name' => document.filename.base }]

      template.fields = tag_fields.map do |tf|
        field = {
          'uuid' => SecureRandom.uuid,
          'submitter_uuid' => submitter_uuid,
          'name' => tf[:name],
          'type' => tf[:type],
          'required' => !%w[checkbox stamp].include?(tf[:type])
        }

        if tf[:options]&.any?
          field['options'] = tf[:options].map { |opt| { 'value' => opt, 'uuid' => SecureRandom.uuid } }
        end

        field['areas'] = [{
          'uuid' => SecureRandom.uuid,
          'attachment_uuid' => document.uuid,
          'page' => tf[:page],
          'x' => tf[:x].clamp(0.0, 0.95).round(6),
          'y' => tf[:y].clamp(0.0, 0.95).round(6),
          'w' => [tf[:w], 0.01].max.clamp(0.01, 1.0).round(6),
          'h' => [tf[:h], 0.01].max.clamp(0.01, 1.0).round(6)
        }]

        field
      end
    end

    def resolve_type(raw_type)
      return 'text' if raw_type.blank?

      normalized = raw_type.downcase.strip
      Templates::ParseHtmlFields::FIELD_TYPES.include?(normalized) ? normalized : 'text'
    end

    def parse_options(field_type, raw_options)
      return nil unless %w[select radio multiple].include?(field_type)
      return nil if raw_options.blank?

      raw_options.split(',').map(&:strip).reject(&:blank?)
    end
  end
end

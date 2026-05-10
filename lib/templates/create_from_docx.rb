# frozen_string_literal: true

require 'open3'
require 'zip'
require 'nokogiri'
require 'net/http'

module Templates
  module CreateFromDocx
    FIELD_TAG_REGEXP = /\{\{([^}]+)\}\}/
    SOFFICE_PATHS = [
      'soffice',
      '/usr/bin/soffice',
      '/usr/bin/libreoffice',
      '/Applications/LibreOffice.app/Contents/MacOS/soffice'
    ].freeze
    GOTENBERG_URL = ENV.fetch('GOTENBERG_URL', 'http://localhost:3100').freeze
    CONVERT_TIMEOUT_SECONDS = 120

    module_function

    def call(template, docx_data, _params = {})
      tag_fields = extract_tags_from_docx(docx_data)

      pdf_data = convert_docx_to_pdf(docx_data)

      if tag_fields.any?
        pdf_data_with_positions = pdf_data
        tag_fields = detect_tag_positions(pdf_data_with_positions, tag_fields)
        pdf_data = remove_tags_from_pdf(pdf_data, tag_fields)
      end

      document = store_pdf_document(template, pdf_data)
      Templates::ProcessDocument.call(document, pdf_data)

      build_template_data(template, document, tag_fields)

      template.save!
      template
    end

    def extract_tags_from_docx(docx_data)
      fields = []
      seen_names = Set.new

      Zip::File.open_buffer(StringIO.new(docx_data)) do |zip|
        entry = zip.find_entry('word/document.xml')
        return fields unless entry

        doc_xml = entry.get_input_stream.read
        doc = Nokogiri::XML(doc_xml)
        doc.remove_namespaces!

        full_text = extract_paragraph_texts(doc)

        full_text.scan(FIELD_TAG_REGEXP) do
          tag_content = Regexp.last_match(1).strip
          parts = tag_content.split('|').map(&:strip)

          field_name = parts[0]
          next if field_name.blank?
          next if seen_names.include?(field_name)

          seen_names.add(field_name)

          field_type = resolve_type(parts[1])
          options = parse_options(field_type, parts[2])

          fields << {
            name: field_name,
            type: field_type,
            options: options,
            tag_text: Regexp.last_match(0)
          }
        end
      end

      fields
    rescue Zip::Error
      # .doc files (OLE2 binary format) are not zip archives — skip tag extraction
      fields
    end

    def extract_paragraph_texts(doc)
      paragraphs = doc.xpath('//p')

      paragraphs.map do |para|
        para.xpath('.//t').map(&:text).join
      end.join("\n")
    end

    def convert_docx_to_pdf(docx_data)
      soffice = find_soffice_binary

      if soffice
        convert_docx_to_pdf_local(docx_data, soffice)
      else
        convert_docx_to_pdf_docker(docx_data)
      end
    end

    def convert_docx_to_pdf_local(docx_data, soffice)
      Dir.mktmpdir('docuseal_docx') do |tmpdir|
        docx_path = File.join(tmpdir, 'input.docx')
        File.binwrite(docx_path, docx_data)

        cmd = [
          soffice,
          '--headless',
          '--norestore',
          '--nolockcheck',
          '--convert-to', 'pdf',
          '--outdir', tmpdir,
          docx_path
        ]

        run_conversion(cmd, tmpdir)
      end
    end

    def convert_docx_to_pdf_docker(docx_data)
      uri = URI("#{GOTENBERG_URL}/forms/libreoffice/convert")

      boundary = SecureRandom.hex(16)
      body = build_multipart_body(boundary, docx_data)

      http = Net::HTTP.new(uri.host, uri.port)
      http.open_timeout = 10
      http.read_timeout = CONVERT_TIMEOUT_SECONDS

      request = Net::HTTP::Post.new(uri.path)
      request['Content-Type'] = "multipart/form-data; boundary=#{boundary}"
      request.body = body

      response = http.request(request)

      unless response.is_a?(Net::HTTPSuccess)
        raise "Gotenberg DOCX to PDF conversion failed (HTTP #{response.code}): #{response.body.to_s.truncate(500)}"
      end

      response.body
    rescue Errno::ECONNREFUSED, Errno::ECONNRESET, Net::OpenTimeout => e
      raise "Gotenberg service not available at #{GOTENBERG_URL}. " \
            "Start it with: docker compose -f docker-compose.dev.yml up gotenberg -d (#{e.message})"
    end

    def build_multipart_body(boundary, docx_data)
      body = +""
      body << "--#{boundary}\r\n"
      body << "Content-Disposition: form-data; name=\"files\"; filename=\"input.docx\"\r\n"
      body << "Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n"
      body << "\r\n"
      body << docx_data
      body << "\r\n"
      body << "--#{boundary}--\r\n"
      body
    end

    def run_conversion(cmd, tmpdir)
      stdout = ''
      stderr = ''

      Timeout.timeout(CONVERT_TIMEOUT_SECONDS, nil, 'DOCX to PDF conversion timed out') do
        Open3.popen3(*cmd) do |_stdin, out, err, wait_thr|
          stdout_thread = Thread.new { out.read }
          stderr_thread = Thread.new { err.read }

          stdout = stdout_thread.value
          stderr = stderr_thread.value

          status = wait_thr.value

          unless status.success?
            error_msg = stderr.presence || stdout
            raise "DOCX to PDF conversion failed (exit #{status.exitstatus}): #{error_msg.to_s.truncate(500)}"
          end
        end
      end

      pdf_path = File.join(tmpdir, 'input.pdf')

      unless File.exist?(pdf_path)
        raise "DOCX to PDF conversion produced no output. Output: #{stdout.to_s.truncate(200)}"
      end

      File.binread(pdf_path)
    end

    def detect_tag_positions(pdf_data, tag_fields)
      pdf = HexaPDF::Document.new(io: StringIO.new(pdf_data))
      pages_info = pdf.pages.map { |p| { width: p.box.width, height: p.box.height } }

      doc = Pdfium::Document.open_bytes(pdf_data)
      positioned_fields = []

      tag_fields.each do |field|
        found = false

        doc.page_count.times do |page_index|
          break if found

          page = doc.get_page(page_index)
          text_nodes = page.text_nodes
          full_text = text_nodes.map(&:content).join

          tag = field[:tag_text]
          tag_start = full_text.index(tag)
          next unless tag_start

          char_offset = 0
          node_char_map = []

          text_nodes.each do |node|
            node.content.each_char do
              node_char_map << node
            end
          end

          tag_end = tag_start + tag.length - 1
          span_nodes = node_char_map[tag_start..tag_end]&.uniq

          if span_nodes.present?
            x_min = span_nodes.map(&:x).min
            y_min = span_nodes.map(&:y).min
            x_max = span_nodes.map(&:endx).max
            y_max = span_nodes.map(&:endy).max

            positioned_fields << field.merge(
              page: page_index,
              x: x_min,
              y: y_min,
              w: x_max - x_min,
              h: y_max - y_min
            )
            found = true
          end
        ensure
          page&.close
        end

        positioned_fields << field.merge(page: 0, x: 0.0, y: 0.0, w: 0.15, h: 0.02) unless found
      end

      positioned_fields
    ensure
      doc&.close
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
      Rails.logger.warn("Failed to remove tags from DOCX-generated PDF: #{e.message}")
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
          'page' => tf[:page] || 0,
          'x' => (tf[:x] || 0.0).clamp(0.0, 0.95).round(6),
          'y' => (tf[:y] || 0.0).clamp(0.0, 0.95).round(6),
          'w' => [tf[:w] || 0.15, 0.01].max.clamp(0.01, 1.0).round(6),
          'h' => [tf[:h] || 0.02, 0.01].max.clamp(0.01, 1.0).round(6)
        }]

        field
      end
    end

    def find_soffice_binary
      SOFFICE_PATHS.find { |path| system('which', path, out: File::NULL, err: File::NULL) }
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

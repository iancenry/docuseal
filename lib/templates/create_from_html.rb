# frozen_string_literal: true

require 'open3'

module Templates
  module CreateFromHtml
    RENDER_SCRIPT_PATH = Rails.root.join('lib/templates/render_html_template.js').freeze
    RENDER_TIMEOUT_SECONDS = 60

    module_function

    def call(template, html_body, params = {})
      parsed = Templates::ParseHtmlFields.call(html_body)

      wrapped_html = wrap_html(parsed[:html], params[:css])

      render_result = render_with_puppeteer(wrapped_html)

      pdf_data = Base64.decode64(render_result['pdf'])
      detected_fields = render_result['fields'] || []

      document = store_pdf_document(template, pdf_data)
      Templates::ProcessDocument.call(document, pdf_data)

      pdf = HexaPDF::Document.new(io: StringIO.new(pdf_data))
      pages = pdf.pages.map { |p| { width: p.box.width, height: p.box.height } }

      build_template_data(template, document, parsed[:fields], detected_fields, pages)

      template.save!

      template
    end

    def wrap_html(html, custom_css = nil)
      return html if html.match?(/<html[\s>]/i)

      css = custom_css.presence || ''

      <<~HTML
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Helvetica, Arial, sans-serif; font-size: 14px; margin: 40px; color: #333; }
            #{css}
          </style>
        </head>
        <body>
          #{html}
        </body>
        </html>
      HTML
    end

    def render_with_puppeteer(html)
      input_json = { html: html, format: 'A4' }.to_json

      stdout = ''
      stderr = ''

      Timeout.timeout(RENDER_TIMEOUT_SECONDS, nil, 'HTML to PDF rendering timed out') do
        Open3.popen3('node', RENDER_SCRIPT_PATH.to_s) do |stdin, out, err, wait_thr|
          stdin.write(input_json)
          stdin.close

          stdout_thread = Thread.new { out.read }
          stderr_thread = Thread.new { err.read }

          stdout = stdout_thread.value
          stderr = stderr_thread.value

          status = wait_thr.value

          unless status.success?
            error_msg = stderr.presence || stdout
            raise "HTML to PDF rendering failed (exit #{status.exitstatus}): #{error_msg.to_s.truncate(500)}"
          end
        end
      end

      JSON.parse(stdout)
    rescue JSON::ParserError => e
      raise "HTML to PDF rendering returned invalid output: #{e.message}. Stderr: #{stderr.to_s.truncate(200)}"
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

    def build_template_data(template, document, parsed_fields, detected_fields, pages)
      submitter_uuid = SecureRandom.uuid

      template.submitters = [{ 'name' => 'First Party', 'uuid' => submitter_uuid }]
      template.schema = [{ 'attachment_uuid' => document.uuid, 'name' => document.filename.base }]

      template.fields = parsed_fields.map do |pf|
        detected = detected_fields.find { |df| df['index'] == pf[:index] }

        field = {
          'uuid' => SecureRandom.uuid,
          'submitter_uuid' => submitter_uuid,
          'name' => pf[:name],
          'type' => pf[:type],
          'required' => !%w[checkbox stamp].include?(pf[:type])
        }

        if pf[:options]&.any?
          field['options'] = pf[:options].map { |opt| { 'value' => opt, 'uuid' => SecureRandom.uuid } }
        end

        area = calculate_field_area(detected, pages, document)
        field['areas'] = [area] if area

        field
      end
    end

    def calculate_field_area(detected, pages, document)
      return nil if detected.blank?
      return nil if detected['width'].to_f <= 0 || detected['height'].to_f <= 0

      page_info = pages.first
      return nil unless page_info

      pdf_w = page_info[:width].to_f
      pdf_h = page_info[:height].to_f

      # Puppeteer renders at 96 CSS DPI; PDF points are 72 DPI
      # Scale factor: 96/72 = 4/3
      scale = 96.0 / 72.0

      page_width_px = pdf_w * scale
      page_height_px = pdf_h * scale

      # Account for the body margin (40px on each side in our default CSS)
      field_x = detected['x'].to_f
      field_y = detected['y'].to_f
      field_w = detected['width'].to_f
      field_h = detected['height'].to_f

      # Determine which page the field is on
      page_index = (field_y / page_height_px).floor
      page_index = [page_index, pages.size - 1].min
      page_index = [page_index, 0].max

      y_on_page = field_y - (page_index * page_height_px)

      {
        'uuid' => SecureRandom.uuid,
        'attachment_uuid' => document.uuid,
        'page' => page_index,
        'x' => (field_x / page_width_px).clamp(0.0, 0.95).round(6),
        'y' => (y_on_page / page_height_px).clamp(0.0, 0.95).round(6),
        'w' => (field_w / page_width_px).clamp(0.01, 1.0).round(6),
        'h' => (field_h / page_height_px).clamp(0.01, 1.0).round(6)
      }
    end
  end
end

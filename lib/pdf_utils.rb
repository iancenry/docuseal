# frozen_string_literal: true

module PdfUtils
  DEFAULT_DPI = 72
  US_LETTER_W = DEFAULT_DPI * 8.5

  module_function

  def encrypted?(data, password: nil)
    HexaPDF::Document.new(io: StringIO.new(data), decryption_opts: { password: })

    false
  rescue HexaPDF::EncryptionError
    true
  end

  def decrypt(data, password)
    decrypted_io = StringIO.new

    Pdfium::Document.open_bytes(data, password) do |doc|
      doc.save(decrypted_io, flags: Pdfium::FPDF_REMOVE_SECURITY)
    end

    decrypted_io.tap(&:rewind).read
  end

  def merge(io_files)
    merged_content = StringIO.new

    Pdfium.with_instance do
      Pdfium::Document.create do |merged_pdf|
        io_files.each do |io|
          Pdfium::Document.open_io(io) { |pdf| merged_pdf.import_pages(pdf) }
        end

        merged_pdf.save(merged_content)
      end
    end

    merged_content.tap(&:rewind)
  end
end

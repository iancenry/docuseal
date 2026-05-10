# frozen_string_literal: true

class UploadSpreadsheetController < ApplicationController
  before_action do
    authorize!(:create, Submission)
  end

  def create
    file = params[:file]

    return render json: { error: 'No file uploaded' }, status: :unprocessable_content unless file

    if file.size > 10.megabytes
      return render json: { error: 'File too large. Maximum size is 10MB.' }, status: :unprocessable_content
    end

    sheets = parse_spreadsheet(file)

    render json: sheets
  rescue StandardError => e
    Rails.logger.error("Spreadsheet parse error: #{e.message}")

    render json: { error: 'Unable to parse file. Please upload a valid CSV or XLSX spreadsheet.' }, status: :unprocessable_content
  end

  private

  def parse_spreadsheet(file)
    if file.original_filename.end_with?('.csv')
      parse_csv(file)
    else
      parse_xlsx(file)
    end
  end

  def parse_csv(file)
    content = file.read.encode('UTF-8', invalid: :replace, undef: :replace, replace: '')
    rows = CSV.parse(content, liberal_parsing: true)

    [['Sheet1', rows.map { |row| row.map { |cell| cell&.strip } }]]
  end

  def parse_xlsx(file)
    workbook = RubyXL::Parser.parse(file.tempfile.path)

    workbook.worksheets.map do |worksheet|
      rows = []
      max_col = 0

      worksheet.each do |row|
        next unless row

        cells = row.cells.map { |cell| cell&.value&.to_s&.strip }
        max_col = [max_col, cells.length].max
        rows << cells
      end

      rows = rows.map { |row| row + Array.new([max_col - row.length, 0].max) }

      [worksheet.sheet_name, rows]
    end
  end
end

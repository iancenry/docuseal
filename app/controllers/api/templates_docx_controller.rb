# frozen_string_literal: true

module Api
  class TemplatesDocxController < ApiBaseController
    skip_authorization_check

    WORD_CONTENT_TYPES = [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'application/octet-stream'
    ].freeze
    WORD_EXTENSIONS = %w[.docx .doc].freeze
    MAX_FILE_SIZE = 50.megabytes

    def create
      authorize!(:create, Template)

      file = params[:file]

      if file.blank?
        return render json: { error: 'Word document file is required' }, status: :unprocessable_content
      end

      unless valid_word_file?(file)
        return render json: { error: 'File must be a DOC or DOCX document' }, status: :unprocessable_content
      end

      docx_data = file.read

      if docx_data.bytesize > MAX_FILE_SIZE
        return render json: { error: 'File exceeds 50MB limit' }, status: :unprocessable_content
      end

      template = current_account.templates.new(
        name: params[:name].presence || File.basename(file.original_filename, '.*').titleize,
        author: current_user,
        source: :api,
        external_id: params[:external_id].presence
      )

      if (folder_name = params[:folder_name].presence)
        template.folder = TemplateFolders.find_or_create_by_name(current_user, folder_name)
      end

      Templates.maybe_assign_access(template)

      template.save!

      Templates::CreateFromDocx.call(template, docx_data)

      WebhookUrls.enqueue_events(template, 'template.created')
      SearchEntries.enqueue_reindex(template)

      render json: Templates::SerializeForApi.call(template), status: :created
    rescue StandardError => e
      Rollbar.error(e) if defined?(Rollbar)

      raise if Rails.env.local?

      template&.destroy rescue nil # rubocop:disable Style/RescueModifier

      render json: { error: 'Failed to create template from Word document' }, status: :unprocessable_content
    end

    private

    def valid_word_file?(file)
      return true if WORD_CONTENT_TYPES.include?(file.content_type)
      return true if WORD_EXTENSIONS.any? { |ext| file.original_filename&.end_with?(ext) }

      false
    end
  end
end

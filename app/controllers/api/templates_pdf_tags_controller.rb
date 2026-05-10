# frozen_string_literal: true

module Api
  class TemplatesPdfTagsController < ApiBaseController
    skip_authorization_check

    PDF_CONTENT_TYPE = 'application/pdf'
    MAX_FILE_SIZE = 50.megabytes

    def create
      authorize!(:create, Template)

      file = params[:file]

      if file.blank?
        return render json: { error: 'PDF file is required' }, status: :unprocessable_content
      end

      unless file.content_type == PDF_CONTENT_TYPE
        return render json: { error: 'File must be a PDF' }, status: :unprocessable_content
      end

      pdf_data = file.read

      if pdf_data.bytesize > MAX_FILE_SIZE
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

      Templates::CreateFromPdfTags.call(template, pdf_data)

      WebhookUrls.enqueue_events(template, 'template.created')
      SearchEntries.enqueue_reindex(template)

      render json: Templates::SerializeForApi.call(template), status: :created
    rescue StandardError => e
      Rollbar.error(e) if defined?(Rollbar)

      raise if Rails.env.local?

      template&.destroy rescue nil # rubocop:disable Style/RescueModifier

      render json: { error: 'Failed to create template from PDF' }, status: :unprocessable_content
    end
  end
end

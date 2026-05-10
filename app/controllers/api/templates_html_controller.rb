# frozen_string_literal: true

module Api
  class TemplatesHtmlController < ApiBaseController
    skip_authorization_check

    def create
      authorize!(:create, Template)

      html_body = params[:html]

      if html_body.blank?
        return render json: { error: 'HTML content is required' }, status: :unprocessable_content
      end

      if html_body.bytesize > 2.megabytes
        return render json: { error: 'HTML content exceeds 2MB limit' }, status: :unprocessable_content
      end

      template = current_account.templates.new(
        name: params[:name].presence || 'Untitled',
        author: current_user,
        source: :api,
        external_id: params[:external_id].presence
      )

      if (folder_name = params[:folder_name].presence)
        template.folder = TemplateFolders.find_or_create_by_name(current_user, folder_name)
      end

      Templates.maybe_assign_access(template)

      template.save!

      Templates::CreateFromHtml.call(template, html_body, css: params[:css])

      WebhookUrls.enqueue_events(template, 'template.created')
      SearchEntries.enqueue_reindex(template)

      render json: Templates::SerializeForApi.call(template), status: :created
    rescue StandardError => e
      Rollbar.error(e) if defined?(Rollbar)

      raise if Rails.env.local?

      template&.destroy rescue nil # rubocop:disable Style/RescueModifier

      render json: { error: 'Failed to create template from HTML' }, status: :unprocessable_content
    end
  end
end

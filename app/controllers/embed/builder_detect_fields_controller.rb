# frozen_string_literal: true

module Embed
  class BuilderDetectFieldsController < BaseController
    include ActionController::Live

    before_action :load_template

    def create
      response.headers['Content-Type'] = 'text/event-stream'

      sse = SSE.new(response.stream)

      documents = @template.schema_documents.preload(:blob)
      documents = documents.where(uuid: params[:attachment_uuid]) if params[:attachment_uuid].present?

      page_number = params[:page].presence&.to_i

      documents.each do |document|
        io = StringIO.new(document.download)

        Templates::DetectFields.call(io, attachment: document, page_number:) do |(attachment_uuid, page, fields)|
          sse.write({ attachment_uuid:, page:, fields: })
        end
      end

      sse.write({ completed: true })
    ensure
      response.stream.close
    end

    private

    def load_template
      @template = @embed_account.templates.find(params[:template_id])
      enforce_token_scope!(:template_id, @template.id)
    end
  end
end

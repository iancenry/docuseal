# frozen_string_literal: true

module Embed
  class BuildersController < BaseController
    TEMPLATE_FIELDS = %i[id author_id folder_id external_id name slug
                         schema fields submitters variables_schema preferences
                         shared_link source archived_at created_at updated_at].freeze

    def show
      @template = @embed_account.templates.find(params[:template_id])

      ActiveRecord::Associations::Preloader.new(
        records: [@template],
        associations: [{ schema_documents: [:blob, { preview_images_attachments: :blob }] }]
      ).call

      @template_data =
        @template.as_json(only: TEMPLATE_FIELDS).merge(
          documents: @template.schema_documents.as_json(
            only: %i[id uuid],
            methods: %i[metadata signed_key],
            include: { preview_images: { only: %i[id], methods: %i[url metadata filename] } }
          )
        ).to_json
    end

    def create
      @template = @embed_account.templates.new(
        name: params[:name] || 'Untitled',
        author: @embed_user
      )

      if @template.save
        render json: { id: @template.id, slug: @template.slug }, status: :created
      else
        render json: { error: @template.errors.full_messages.join(', ') }, status: :unprocessable_content
      end
    end
  end
end

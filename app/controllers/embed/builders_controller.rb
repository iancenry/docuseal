# frozen_string_literal: true

module Embed
  class BuildersController < BaseController
    TEMPLATE_FIELDS = %i[id author_id folder_id external_id name slug
                         schema fields submitters variables_schema preferences
                         shared_link source archived_at created_at updated_at].freeze

    FILES_TTL = 5.minutes

    before_action :load_template, only: %i[show update documents documents_index]

    def show
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

      @token = params[:token]
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

    def update
      @template.assign_attributes(template_params)

      @template.save!

      WebhookUrls.enqueue_events(@template, 'template.updated')

      head :ok
    end

    def documents_index
      render json: @template.schema_documents.map { |d|
        ActiveStorage::Blob.proxy_path(d.blob, expires_at: FILES_TTL.from_now.to_i)
      }
    end

    def documents
      if params[:blobs].blank? && params[:files].blank?
        return render json: { error: 'File is missing' }, status: :unprocessable_content
      end

      old_fields_hash = @template.fields.hash

      new_documents, = Templates::CreateAttachments.call(@template, params, extract_fields: true)

      schema = new_documents.map do |doc|
        { attachment_uuid: doc.uuid, name: doc.filename.base }
      end

      render json: {
        schema:,
        fields: old_fields_hash == @template.fields.hash ? nil : @template.fields,
        submitters: old_fields_hash == @template.fields.hash ? nil : @template.submitters,
        documents: new_documents.as_json(
          methods: %i[metadata signed_key],
          include: {
            preview_images: { methods: %i[url metadata filename] }
          }
        )
      }
    rescue Templates::CreateAttachments::PdfEncrypted
      render json: { error: 'PDF encrypted', status: 'pdf_encrypted' }, status: :unprocessable_content
    end

    def custom_fields
      account_config =
        AccountConfig.find_or_initialize_by(account: @embed_account, key: AccountConfig::TEMPLATE_CUSTOM_FIELDS_KEY)

      account_config.update!(custom_fields_params)

      render json: account_config.value
    end

    private

    def load_template
      @template = @embed_account.templates.find(params[:template_id])
      enforce_token_scope!(:template_id, @template.id)
    end

    def template_params
      params.require(:template).permit(
        :name,
        { schema: [[:attachment_uuid, :google_drive_file_id, :name, :dynamic,
                    { conditions: [%i[field_uuid value action operation]] }]],
          submitters: [%i[name uuid is_requester linked_to_uuid invite_via_field_uuid
                          invite_by_uuid optional_invite_by_uuid email order]],
          variables_schema: {},
          fields: [[:uuid, :submitter_uuid, :name, :type,
                    :required, :readonly, :default_value,
                    :title, :description, :prefillable,
                    { preferences: {},
                      default_value: [],
                      conditions: [%i[field_uuid value action operation]],
                      options: [%i[value uuid]],
                      validation: %i[message pattern min max step],
                      areas: [%i[uuid x y w h cell_w attachment_uuid option_uuid page]] }]] }
      )
    end

    def custom_fields_params
      params.permit(
        value: [[:uuid, :name, :type,
                 :required, :readonly, :default_value,
                 :title, :description,
                 { preferences: {},
                   default_value: [],
                   options: [%i[value uuid]],
                   validation: %i[message pattern min max step],
                   areas: [%i[x y w h cell_w option_uuid]] }]]
      )
    end
  end
end

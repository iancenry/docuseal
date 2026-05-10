# frozen_string_literal: true

module Api
  class SubmissionsPdfController < ApiBaseController
    skip_authorization_check

    MAX_FILE_SIZE = 50.megabytes

    def create
      authorize!(:create, Template)
      authorize!(:create, Submission)

      validate_documents_params!

      template = build_template_from_pdf

      submissions = create_submissions_from_template(template)

      render json: build_response(template, submissions), status: :created
    rescue Submissions::CreateFromSubmitters::BaseError,
           Submitters::NormalizeValues::BaseError,
           DownloadUtils::UnableToDownload => e
      Rollbar.warning(e) if defined?(Rollbar)

      render json: { error: e.message }, status: :unprocessable_content
    rescue StandardError => e
      Rollbar.error(e) if defined?(Rollbar)

      raise if Rails.env.local?

      template&.destroy rescue nil # rubocop:disable Style/RescueModifier

      render json: { error: 'Failed to create submission from PDF' }, status: :unprocessable_content
    end

    private

    def validate_documents_params!
      documents = params[:documents]

      if documents.blank?
        raise Submissions::CreateFromSubmitters::BaseError, 'documents array is required'
      end

      unless documents.is_a?(Array)
        raise Submissions::CreateFromSubmitters::BaseError, 'documents must be an array'
      end

      documents.each_with_index do |doc, i|
        if doc[:file].blank?
          raise Submissions::CreateFromSubmitters::BaseError, "documents[#{i}].file is required"
        end
      end

      validate_submitters_present!
    end

    def validate_submitters_present!
      submitters = params[:submitters]

      if submitters.blank?
        raise Submissions::CreateFromSubmitters::BaseError, 'submitters array is required'
      end

      unless submitters.is_a?(Array)
        raise Submissions::CreateFromSubmitters::BaseError, 'submitters must be an array'
      end
    end

    def build_template_from_pdf
      documents = params[:documents]
      first_doc = documents.first

      pdf_data = resolve_file_data(first_doc[:file])

      if pdf_data.bytesize > MAX_FILE_SIZE
        raise Submissions::CreateFromSubmitters::BaseError, 'PDF file exceeds 50MB limit'
      end

      template = current_account.templates.new(
        name: params[:name].presence || first_doc[:name].presence || 'Untitled',
        author: current_user,
        source: :api,
        external_id: "submission_pdf_#{SecureRandom.uuid}"
      )

      if (folder_name = params[:folder_name].presence)
        template.folder = TemplateFolders.find_or_create_by_name(current_user, folder_name)
      end

      Templates.maybe_assign_access(template)
      template.save!

      Templates::CreateFromPdfTags.call(template, pdf_data)

      # Handle additional documents
      documents[1..].each do |doc|
        append_pdf_document(template, doc)
      end

      # Handle field coordinate overrides from params
      apply_field_overrides(template, documents)

      template.reload
    end

    def resolve_file_data(file_param)
      if file_param.is_a?(ActionDispatch::Http::UploadedFile)
        file_param.read
      elsif file_param.to_s.start_with?('http://', 'https://')
        DownloadUtils.call(file_param)
      else
        Base64.decode64(file_param)
      end
    end

    def append_pdf_document(template, doc)
      pdf_data = resolve_file_data(doc[:file])

      if pdf_data.bytesize > MAX_FILE_SIZE
        raise Submissions::CreateFromSubmitters::BaseError, 'PDF file exceeds 50MB limit'
      end

      temp_template = current_account.templates.new(
        name: doc[:name].presence || 'Additional Document',
        author: current_user,
        source: :api
      )
      temp_template.save!

      Templates::CreateFromPdfTags.call(temp_template, pdf_data)

      temp_template.documents.each do |document|
        document.update!(template: template)
      end

      template.schema = (template.schema || []) + (temp_template.schema || [])

      existing_pages = template.fields.flat_map { |f| f['areas']&.map { |a| a['page'] } }.compact.max.to_i + 1
      temp_fields = temp_template.fields.map do |field|
        field = field.deep_dup
        field['areas']&.each { |area| area['page'] = area['page'].to_i + existing_pages }
        field
      end
      template.fields = (template.fields || []) + temp_fields

      template.save!
      temp_template.destroy
    rescue StandardError
      temp_template&.destroy rescue nil # rubocop:disable Style/RescueModifier
      raise
    end

    def apply_field_overrides(template, documents)
      documents.each do |doc|
        next if doc[:fields].blank?

        doc[:fields].each do |field_param|
          next if field_param[:areas].blank?

          field_name = field_param[:name].presence || "Field #{SecureRandom.hex(4)}"
          field_type = field_param[:type].presence || 'text'
          role = field_param[:role].presence || template.submitters.first&.dig('name') || 'First Party'

          submitter = template.submitters.find { |s| s['name'].casecmp?(role) }
          submitter_uuid = submitter&.dig('uuid') || template.submitters.first&.dig('uuid')

          areas = field_param[:areas].map do |area|
            attachment_uuid = template.schema.dig(0, 'attachment_uuid')

            {
              'x' => area[:x].to_f,
              'y' => area[:y].to_f,
              'w' => area[:w].to_f,
              'h' => area[:h].to_f,
              'page' => (area[:page].to_i - 1), # API uses 1-based, internal uses 0-based
              'attachment_uuid' => attachment_uuid
            }.compact
          end

          existing = template.fields.find { |f| f['name'] == field_name }
          if existing
            existing['areas'] = areas
            existing['type'] = field_type
          else
            template.fields << {
              'uuid' => SecureRandom.uuid,
              'submitter_uuid' => submitter_uuid,
              'name' => field_name,
              'type' => field_type,
              'required' => field_param[:required] != false,
              'areas' => areas
            }
          end
        end
      end

      template.save! if documents.any? { |d| d[:fields].present? }
    end

    def create_submissions_from_template(template)
      submission_params = build_submission_params

      submissions_attrs, attachments =
        Submissions::NormalizeParamUtils.normalize_submissions_params!(submission_params, template, purpose: :api)

      submissions = Submissions.create_from_submitters(
        template: template,
        user: current_user,
        source: :api,
        submitters_order: params[:submitters_order] || params[:order] || 'preserved',
        submissions_attrs: submissions_attrs,
        params: params
      )

      submitters = submissions.flat_map(&:submitters)
      Submissions::NormalizeParamUtils.save_default_value_attachments!(attachments, submitters)

      WebhookUrls.enqueue_events(submissions, 'submission.created')
      Submissions.send_signature_requests(submissions)

      submitters.each do |submitter|
        next unless submitter.completed_at?

        ProcessSubmitterCompletionJob.perform_async('submitter_id' => submitter.id, 'send_invitation_email' => false)
      end

      SearchEntries.enqueue_reindex(submissions)

      submissions
    end

    def build_submission_params
      params[:send_email] = true unless params.key?(:send_email)
      params[:send_sms] = false unless params.key?(:send_sms)

      permitted = submissions_permitted_params

      if params.key?(:submitters)
        permitted
      else
        [permitted]
      end
    end

    def build_response(template, submissions)
      submitters_json = submissions.flat_map do |submission|
        submission.submitters.map do |s|
          Submitters::SerializeForApi.call(s, with_documents: false, with_urls: true, params: params)
        end
      end

      {
        id: submissions.first.id,
        name: submissions.first.name,
        submitters: submitters_json,
        source: 'api',
        submitters_order: submissions.first.submitters_order,
        status: submissions.first.submitters.any?(&:completed_at?) ? 'completed' : 'pending',
        schema: template.schema,
        fields: template.fields,
        expire_at: submissions.first.expire_at,
        created_at: submissions.first.created_at
      }
    end

    def submissions_permitted_params
      permitted_attrs = [
        :send_email, :send_sms, :bcc_completed, :completed_redirect_url, :reply_to, :go_to_last,
        :require_phone_2fa, :require_email_2fa, :expire_at, :name,
        {
          variables: {},
          message: %i[subject body],
          submitters: [[:send_email, :send_sms, :completed_redirect_url, :uuid, :name, :email, :role,
                        :completed, :phone, :application_key, :external_id, :reply_to, :go_to_last,
                        :require_phone_2fa, :require_email_2fa, :order, :index, :invite_by,
                        { metadata: {}, values: {}, roles: [], readonly_fields: [], message: %i[subject body],
                          fields: [:name, :uuid, :default_value, :value, :title, :description,
                                   :readonly, :required, :validation_pattern, :invalid_message,
                                   { default_value: [], value: [], preferences: {}, validation: {} }] }]]
        }
      ]

      params.permit(*permitted_attrs)
    end
  end
end

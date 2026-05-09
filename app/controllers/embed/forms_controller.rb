# frozen_string_literal: true

module Embed
  class FormsController < BaseController
    around_action :with_browser_locale
    skip_before_action :authenticate_embed_token!, only: %i[update]
    before_action :load_submitter_for_update, only: %i[update]

    def show
      @submitter = find_submitter

      return render json: { error: 'Submitter not found' }, status: :not_found unless @submitter

      submission = @submitter.submission

      return render :completed if @submitter.completed_at?

      Submissions.preload_with_pages(submission)

      @form_configs = Submitters::FormConfigs.call(@submitter, [])
      @attachments_index = build_attachments_index(submission)
    end

    def update
      if @submitter.completed_at?
        return render json: { error: 'Form has been completed already' }, status: :unprocessable_content
      end

      Submitters::SubmitValues.call(@submitter, params, request)

      head :ok
    rescue Submitters::SubmitValues::RequiredFieldError => e
      render json: { field_uuid: e.message }, status: :unprocessable_content
    rescue Submitters::SubmitValues::ValidationError => e
      render json: { error: e.message }, status: :unprocessable_content
    end

    def completed
      @submitter = find_submitter

      return render json: { error: 'Submitter not found' }, status: :not_found unless @submitter
    end

    private

    def find_submitter
      if params[:submission_id]
        submission = @embed_account.submissions.find(params[:submission_id])
        submission.submitters.find_by(email: params[:email]) || submission.submitters.first
      elsif params[:slug]
        Submitter.find_by!(slug: params[:slug]).tap do |submitter|
          unless submitter.submission.account_id == @embed_account.id
            raise ActiveRecord::RecordNotFound
          end
        end
      end
    end

    def load_submitter_for_update
      @submitter = Submitter.find_by!(slug: params[:slug])
    end

    def build_attachments_index(submission)
      ActiveStorage::Attachment
        .where(record: submission.submitters)
        .preload(:blob)
        .index_by(&:uuid)
    end

    def with_browser_locale(&)
      locale = (@embed_account&.locale if respond_to?(:authenticate_embed_token!, true)) || I18n.default_locale
      I18n.with_locale(locale, &)
    end
  end
end

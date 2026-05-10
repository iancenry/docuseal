# frozen_string_literal: true

module Api
  class EmbedTokensController < ApiBaseController
    skip_authorization_check

    def create
      token_hash = Digest::SHA256.hexdigest(request.headers['X-Auth-Token'])

      max_expire_in = 24.hours.to_i
      expire_in = [(params[:expire_in] || 1.hour).to_i, max_expire_in].min
      expire_in = 1.hour.to_i if expire_in <= 0

      payload = {
        token_hash: token_hash,
        exp: expire_in.seconds.from_now.to_i
      }

      # Scope to specific template if provided
      payload[:template_id] = params[:template_id].to_i if params[:template_id].present?

      # Scope to specific submission if provided
      payload[:submission_id] = params[:submission_id].to_i if params[:submission_id].present?

      embed_token = JsonWebToken.encode(payload)

      render json: { token: embed_token, expires_at: Time.at(payload[:exp]).iso8601 }
    end
  end
end

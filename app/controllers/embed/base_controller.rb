# frozen_string_literal: true

module Embed
  class BaseController < ActionController::Base
    layout 'embed'

    skip_before_action :verify_authenticity_token
    before_action :set_cors_headers
    before_action :authenticate_embed_token!, except: %i[preflight]
    before_action :set_active_storage_url_options, except: %i[preflight]

    def preflight
      head :no_content
    end

    private

    def authenticate_embed_token!
      token = params[:token] || request.headers['X-Embed-Token']

      if token.blank?
        return render json: { error: 'Missing embed token' }, status: :unauthorized
      end

      payload = JsonWebToken.decode(token)

      @embed_user = User.joins(:access_token).active.find_by(access_token: { sha256: payload['token_hash'] })

      unless @embed_user
        return render json: { error: 'Invalid token' }, status: :unauthorized
      end

      @embed_account = @embed_user.account
      @embed_token_payload = payload
    rescue JWT::ExpiredSignature
      render json: { error: 'Token expired' }, status: :unauthorized
    rescue JWT::DecodeError => e
      render json: { error: "Invalid token: #{e.message}" }, status: :unauthorized
    end

    def enforce_token_scope!(resource_type, resource_id)
      scoped_id = @embed_token_payload&.dig(resource_type.to_s)

      return unless scoped_id.present?

      unless scoped_id.to_i == resource_id.to_i
        render json: { error: 'Token not authorized for this resource' }, status: :forbidden
      end
    end

    def set_cors_headers
      origin = request.headers['Origin']

      if origin.present?
        headers['Access-Control-Allow-Origin'] = origin
        headers['Access-Control-Allow-Credentials'] = 'true'
      else
        headers['Access-Control-Allow-Origin'] = '*'
      end

      headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, PATCH, OPTIONS'
      headers['Access-Control-Allow-Headers'] = 'Content-Type, X-Embed-Token'
      headers['Access-Control-Max-Age'] = '3600'
      headers.delete('X-Frame-Options')
      response.set_header('Content-Security-Policy', "frame-ancestors *")
    end

    def set_active_storage_url_options
      ActiveStorage::Current.url_options = { host: request.base_url }
    end
  end
end

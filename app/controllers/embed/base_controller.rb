# frozen_string_literal: true

module Embed
  class BaseController < ActionController::Base
    layout 'embed'

    skip_before_action :verify_authenticity_token
    before_action :set_cors_headers
    before_action :authenticate_embed_token!

    private

    def authenticate_embed_token!
      token = params[:token] || request.headers['X-Embed-Token']

      if token.blank?
        return render json: { error: 'Missing embed token' }, status: :unauthorized
      end

      payload = JsonWebToken.decode(token)

      if payload['exp'] && Time.at(payload['exp']) < Time.current
        return render json: { error: 'Token expired' }, status: :unauthorized
      end

      @embed_user = User.joins(:access_token).active.find_by(access_token: { sha256: payload['token_hash'] })

      unless @embed_user
        return render json: { error: 'Invalid token' }, status: :unauthorized
      end

      @embed_account = @embed_user.account
    rescue JWT::DecodeError => e
      render json: { error: "Invalid token: #{e.message}" }, status: :unauthorized
    end

    def set_cors_headers
      headers['Access-Control-Allow-Origin'] = request.headers['Origin'] || '*'
      headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, PATCH, OPTIONS'
      headers['Access-Control-Allow-Headers'] = 'Content-Type, X-Embed-Token'
      headers['Access-Control-Allow-Credentials'] = 'true'
      headers.delete('X-Frame-Options')
      response.set_header('Content-Security-Policy', "frame-ancestors *")
    end
  end
end

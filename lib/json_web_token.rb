# frozen_string_literal: true

module JsonWebToken
  ALGORITHM = 'HS256'

  module_function

  def encode(payload)
    JWT.encode(payload, Rails.application.secret_key_base, ALGORITHM)
  end

  def decode(token)
    JWT.decode(token, Rails.application.secret_key_base, true,
               { algorithm: ALGORITHM, verify_expiration: true })[0]
  end
end

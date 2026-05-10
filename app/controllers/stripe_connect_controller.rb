# frozen_string_literal: true

class StripeConnectController < ApplicationController
  skip_before_action :verify_authenticity_token, only: :create
  skip_authorization_check

  def create
    redirect_to settings_payments_path
  end

  def callback
    redirect_to settings_payments_path
  end
end
